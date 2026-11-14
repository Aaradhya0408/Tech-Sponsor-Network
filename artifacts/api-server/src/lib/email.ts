import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db, emailLogTable, usersTable } from "@workspace/db";

export type EmailLogStatus = "sent" | "failed" | "skipped";

export interface SendEmailInput {
  to: string;
  type: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  id: string | null;
  status: EmailLogStatus;
}

const MAX_EMAILS_PER_RECIPIENT_PER_HOUR = 10;
const EMAIL_TIMEOUT_MS = 12_000;
const DEFAULT_FROM = "onboarding@resend.dev";

function safeErrorMessage(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/\bre_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/([?&](?:token|signature)=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function createEmailLog(
  input: SendEmailInput,
  toEmail: string,
  status: EmailLogStatus,
  errorMessage: string | null,
) {
  const [entry] = await db
    .insert(emailLogTable)
    .values({
      toEmail,
      type: input.type,
      subject: input.subject.slice(0, 255),
      status,
      errorMessage: errorMessage ? safeErrorMessage(errorMessage) : null,
    })
    .returning({ id: emailLogTable.id });
  return entry;
}

async function reserveEmailAttempt(
  input: SendEmailInput,
  toEmail: string,
): Promise<{ id: string; allowed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${toEmail}, 0))`,
    );
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await tx
      .select({ attempts: count() })
      .from(emailLogTable)
      .where(
        and(
          eq(emailLogTable.toEmail, toEmail),
          gt(emailLogTable.createdAt, cutoff),
        ),
      );

    if ((recent?.attempts ?? 0) >= MAX_EMAILS_PER_RECIPIENT_PER_HOUR) {
      const [entry] = await tx
        .insert(emailLogTable)
        .values({
          toEmail,
          type: input.type,
          subject: input.subject.slice(0, 255),
          status: "skipped",
          errorMessage: "Recipient rate limit exceeded: maximum 10 emails per hour.",
        })
        .returning({ id: emailLogTable.id });
      return { id: entry.id, allowed: false };
    }

    const [entry] = await tx
      .insert(emailLogTable)
      .values({
        toEmail,
        type: input.type,
        subject: input.subject.slice(0, 255),
        status: "failed",
        errorMessage: "Delivery could not be confirmed.",
      })
      .returning({ id: emailLogTable.id });
    return { id: entry.id, allowed: true };
  });
}

async function sendThroughResend(
  input: SendEmailInput,
  toEmail: string,
): Promise<string | null> {
  const payload = {
    from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
    to: toEmail,
    subject: input.subject,
    html: input.html,
  };
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
  } as const;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const response = apiKey
    ? await fetch("https://api.resend.com/emails", {
        ...request,
        headers: {
          ...request.headers,
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "TechSponsorNetwork/1.0",
        },
      })
    : await new ReplitConnectors().proxy("resend", "/emails", request);

  if (response.ok) return null;

  const responseText = await response.text().catch(() => "");
  let detail = responseText;
  try {
    const parsed = JSON.parse(responseText) as {
      message?: unknown;
      name?: unknown;
    };
    if (typeof parsed.message === "string") detail = parsed.message;
    else if (typeof parsed.name === "string") detail = parsed.name;
  } catch {
    // The provider sometimes returns plain text for rejected requests.
  }
  return safeErrorMessage(
    `Resend rejected the email (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
  );
}

/**
 * Sends one verified user's transactional email and records every attempt.
 * Delivery failures are deliberately contained so they cannot undo the action
 * that caused the notification.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const toEmail = input.to.trim().toLowerCase();
  let reservedId: string | null = null;

  try {
    const [recipient] = await db
      .select({ emailVerified: usersTable.emailVerified })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${toEmail}`)
      .limit(1);

    if (!recipient || !recipient.emailVerified) {
      const entry = await createEmailLog(
        input,
        toEmail,
        "skipped",
        "Recipient account does not have a verified email address.",
      );
      return { id: entry.id, status: "skipped" };
    }

    const reservation = await reserveEmailAttempt(input, toEmail);
    reservedId = reservation.id;
    if (!reservation.allowed) {
      return { id: reservation.id, status: "skipped" };
    }

    let status: EmailLogStatus = "failed";
    let errorMessage: string | null = "Delivery could not be confirmed.";
    try {
      errorMessage = await sendThroughResend(input, toEmail);
      status = errorMessage ? "failed" : "sent";
    } catch (err) {
      errorMessage =
        err instanceof Error
          ? safeErrorMessage(err.message)
          : "Resend request failed.";
    }

    await db
      .update(emailLogTable)
      .set({ status, errorMessage })
      .where(eq(emailLogTable.id, reservation.id));

    return { id: reservation.id, status };
  } catch {
    if (reservedId) {
      // The attempt row is already durable; leave its failed reservation in
      // place rather than creating a duplicate record if a later write fails.
      return { id: reservedId, status: "failed" };
    }
    // A delivery/logging outage must not fail the campaign, application, or
    // payment action. The reserved row remains marked failed if one exists.
    try {
      const entry = await createEmailLog(
        input,
        toEmail,
        "failed",
        "Email service or email log is temporarily unavailable.",
      );
      return { id: entry.id, status: "failed" };
    } catch {
      return { id: null, status: "failed" };
    }
  }
}
