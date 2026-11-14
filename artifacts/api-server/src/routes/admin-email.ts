import { and, desc, eq } from "drizzle-orm";
import {
  ListAdminEmailLogResponse,
  SendAdminTestEmailResponse,
  UnsubscribeFromCampaignAlertsQueryParams,
} from "@workspace/api-zod";
import { db, creatorProfilesTable, emailLogTable } from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { isValidCampaignAlertToken } from "../lib/campaign-alert-token";
import { sendEmail } from "../lib/email";
import {
  appUrl,
  renderTransactionalEmail,
  renderUnsubscribeResult,
} from "../lib/email-template";
import { requireRole } from "./auth";

const router: IRouter = Router();

function invalidUnsubscribe(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.status(400).type("html").send(renderUnsubscribeResult(false));
}

router.get(
  "/admin/email-log",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(emailLogTable)
      .orderBy(desc(emailLogTable.createdAt))
      .limit(100);
    res.json(
      ListAdminEmailLogResponse.parse({
        emails: rows.map((row) => ({
          id: row.id,
          toEmail: row.toEmail,
          type: row.type,
          subject: row.subject,
          status: row.status,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt,
        })),
      }),
    );
  },
);

router.post(
  "/admin/email-log/test",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const admin = res.locals.authUser as {
      email: string;
      name: string;
    };
    const result = await sendEmail({
      to: admin.email,
      type: "TEST",
      subject: "Tech Sponsor Network email test",
      html: renderTransactionalEmail({
        title: "Your email setup is connected",
        paragraphs: [
          `Hello ${admin.name},`,
          "This is a test message from Tech Sponsor Network. If you can read this, transactional email delivery is working.",
        ],
        buttonLabel: "Open dashboard",
        buttonUrl: appUrl("/admin/dashboard"),
      }),
    });
    res.json(
      SendAdminTestEmailResponse.parse({
        id: result.id,
        status: result.status,
        message:
          result.status === "sent"
            ? "The test email was sent."
            : `The test email was ${result.status}. Check the email log for details.`,
      }),
    );
  },
);

router.get(
  "/email/campaign-alerts/unsubscribe",
  async (req, res): Promise<void> => {
    const parsed = UnsubscribeFromCampaignAlertsQueryParams.safeParse(
      req.query,
    );
    if (!parsed.success) {
      invalidUnsubscribe(res);
      return;
    }

    const [profile] = await db
      .select({
        userId: creatorProfilesTable.userId,
        enabled: creatorProfilesTable.campaignAlertsEnabled,
        tokenVersion: creatorProfilesTable.campaignAlertsTokenVersion,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, parsed.data.userId))
      .limit(1);
    if (
      !profile ||
      !isValidCampaignAlertToken(
        profile.userId,
        profile.tokenVersion,
        parsed.data.token,
      )
    ) {
      invalidUnsubscribe(res);
      return;
    }

    if (profile.enabled) {
      const [updated] = await db
        .update(creatorProfilesTable)
        .set({ campaignAlertsEnabled: false })
        .where(
          and(
            eq(creatorProfilesTable.userId, profile.userId),
            eq(
              creatorProfilesTable.campaignAlertsTokenVersion,
              profile.tokenVersion,
            ),
            eq(creatorProfilesTable.campaignAlertsEnabled, true),
          ),
        )
        .returning({ userId: creatorProfilesTable.userId });
      if (!updated) {
        invalidUnsubscribe(res);
        return;
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res
      .status(200)
      .type("html")
      .send(renderUnsubscribeResult(true));
  },
);

export default router;
