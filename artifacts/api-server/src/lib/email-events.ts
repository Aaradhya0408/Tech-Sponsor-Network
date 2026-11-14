import { and, eq, inArray } from "drizzle-orm";
import {
  campaignApplicationsTable,
  campaignsTable,
  creatorPlatformsTable,
  creatorProfilesTable,
  db,
  invoicesTable,
  usersTable,
} from "@workspace/db";
import { campaignEligibilityReasons } from "./campaign-eligibility";
import { campaignAlertUnsubscribeToken } from "./campaign-alert-token";
import { sendEmail } from "./email";
import { appUrl, renderTransactionalEmail } from "./email-template";

const rejectionReasonLabels: Record<string, string> = {
  FOLLOWERS_BELOW_REQUIREMENT: "Followers below the requirement",
  NICHE_NOT_A_FIT: "Niche is not a fit",
  PROFILE_INCOMPLETE: "Profile is incomplete",
  APPLICATION_MESSAGE_TOO_WEAK: "Application message is too weak",
  TOO_MANY_APPLICANTS: "Too many applicants for this campaign",
  OTHER: "Other",
};

export async function notifyApplicationReceived(
  to: string,
  campaignTitle: string,
): Promise<void> {
  await sendEmail({
    to,
    type: "APPLICATION_RECEIVED",
    subject: `Application received: ${campaignTitle}`,
    html: renderTransactionalEmail({
      title: "Your application is in",
      paragraphs: [
        `Hello,`,
        `Your application for ${campaignTitle} has been received and is now under review.`,
        "Payment is made only if your submission is accepted. If your work is not accepted, no payment will be made.",
      ],
      buttonLabel: "View my applications",
      buttonUrl: appUrl("/my-campaigns"),
    }),
  });
}

export async function notifyApplicationDecision(
  applicationId: string,
  status: string,
  rejectionReason: string | null,
  decisionNote: string | null,
): Promise<void> {
  if (!["ACCEPTED", "NOT_SELECTED", "WINNER"].includes(status)) return;
  const [row] = await db
    .select({
      email: usersTable.email,
      creatorName: usersTable.name,
      campaignTitle: campaignsTable.title,
    })
    .from(campaignApplicationsTable)
    .innerJoin(usersTable, eq(campaignApplicationsTable.creatorId, usersTable.id))
    .innerJoin(campaignsTable, eq(campaignApplicationsTable.campaignId, campaignsTable.id))
    .where(eq(campaignApplicationsTable.id, applicationId))
    .limit(1);
  if (!row) return;

  if (status === "ACCEPTED") {
    await sendEmail({
      to: row.email,
      type: "APPLICATION_ACCEPTED",
      subject: `Application accepted: ${row.campaignTitle}`,
      html: renderTransactionalEmail({
        title: "Your application was accepted",
        paragraphs: [
          `Hello ${row.creatorName},`,
          `Your application for ${row.campaignTitle} has been accepted. Visit your dashboard for next steps and campaign details.`,
        ],
        buttonLabel: "Open dashboard",
        buttonUrl: appUrl("/dashboard"),
      }),
    });
    return;
  }

  if (status === "WINNER") {
    await sendEmail({
      to: row.email,
      type: "WINNER_ANNOUNCED",
      subject: `Congratulations: ${row.campaignTitle}`,
      html: renderTransactionalEmail({
        title: "Congratulations",
        paragraphs: [
          `Hello ${row.creatorName},`,
          `You have been announced as a winner for ${row.campaignTitle}. Open My Campaigns to submit your invoice.`,
        ],
        buttonLabel: "Open invoice form",
        buttonUrl: appUrl("/my-campaigns"),
      }),
    });
    return;
  }

  const reason =
    rejectionReason === "OTHER"
      ? decisionNote || "Other"
      : rejectionReason
        ? rejectionReasonLabels[rejectionReason] || rejectionReason
        : "No reason was provided.";
  const paragraphs = [
    `Hello ${row.creatorName},`,
    `Your application for ${row.campaignTitle} was not selected.`,
    `Reason: ${reason}`,
  ];
  if (decisionNote && rejectionReason !== "OTHER") {
    paragraphs.push(`Additional note: ${decisionNote}`);
  }
  await sendEmail({
    to: row.email,
    type: "APPLICATION_REJECTED",
    subject: `Application update: ${row.campaignTitle}`,
    html: renderTransactionalEmail({
      title: "An update on your application",
      paragraphs,
      buttonLabel: "Browse other campaigns",
      buttonUrl: appUrl("/campaigns"),
    }),
  });
}

export async function notifyPaymentMarkedPaid(invoiceId: string): Promise<void> {
  const [row] = await db
    .select({
      email: usersTable.email,
      creatorName: usersTable.name,
      campaignTitle: campaignsTable.title,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
    })
    .from(invoicesTable)
    .innerJoin(usersTable, eq(invoicesTable.creatorId, usersTable.id))
    .innerJoin(
      campaignApplicationsTable,
      eq(invoicesTable.applicationId, campaignApplicationsTable.id),
    )
    .innerJoin(campaignsTable, eq(campaignApplicationsTable.campaignId, campaignsTable.id))
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);
  if (!row) return;

  const amount = new Intl.NumberFormat("en", {
    style: "currency",
    currency: row.currency,
  }).format(Number(row.amount));
  await sendEmail({
    to: row.email,
    type: "PAYMENT_MARKED_PAID",
    subject: `Payment marked as paid: ${row.campaignTitle}`,
    html: renderTransactionalEmail({
      title: "Your invoice was marked as paid",
      paragraphs: [
        `Hello ${row.creatorName},`,
        `The ${amount} payment for ${row.campaignTitle} has been marked as paid.`,
        "Payment is sent via Deel.",
      ],
      buttonLabel: "View my invoice",
      buttonUrl: appUrl("/my-campaigns"),
    }),
  });
}

export async function notifyEligibleCreatorsOfCampaign(
  campaignId: string,
): Promise<void> {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  if (!campaign || campaign.status !== "PUBLISHED") return;

  const candidates = await db
    .select({
      profile: creatorProfilesTable,
      email: usersTable.email,
    })
    .from(creatorProfilesTable)
    .innerJoin(usersTable, eq(creatorProfilesTable.userId, usersTable.id))
    .where(
      and(
        eq(creatorProfilesTable.campaignAlertsEnabled, true),
        eq(creatorProfilesTable.approvalStatus, "APPROVED"),
        eq(usersTable.emailVerified, true),
      ),
    );
  const candidateIds = candidates.map(({ profile }) => profile.userId);
  if (candidateIds.length === 0) return;
  const platformRows = await db
    .select()
    .from(creatorPlatformsTable)
    .where(inArray(creatorPlatformsTable.userId, candidateIds));
  const platformsByCreator = new Map<string, typeof platformRows>();
  for (const platform of platformRows) {
    const list = platformsByCreator.get(platform.userId) ?? [];
    list.push(platform);
    platformsByCreator.set(platform.userId, list);
  }

  for (const candidate of candidates) {
    const profile = candidate.profile;
    const platforms = platformsByCreator.get(profile.userId) ?? [];
    if (campaignEligibilityReasons(campaign, profile, platforms).length > 0) {
      continue;
    }
    const token = campaignAlertUnsubscribeToken(
      profile.userId,
      profile.campaignAlertsTokenVersion,
    );
    const unsubscribeUrl = new URL(
      "/api/email/campaign-alerts/unsubscribe",
      appUrl("/"),
    );
    unsubscribeUrl.searchParams.set("userId", profile.userId);
    unsubscribeUrl.searchParams.set("token", token);

    await sendEmail({
      to: candidate.email,
      type: "NEW_CAMPAIGN_ALERT",
      subject: `A new campaign matches your profile: ${campaign.title}`,
      html: renderTransactionalEmail({
        title: "A campaign matches your profile",
        paragraphs: [
          `A new campaign, ${campaign.title}, matches your country, niche, platforms, and follower count.`,
        ],
        buttonLabel: "View campaign",
        buttonUrl: appUrl(`/campaigns/${encodeURIComponent(campaign.id)}`),
        unsubscribeUrl: unsubscribeUrl.toString(),
      }),
    });
  }
}
