import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  CreateCreatorCampaignApplicationBody,
  CreateCreatorCampaignApplicationParams,
  CreateCreatorCampaignApplicationResponse,
  ListCreatorApplicationsResponse,
} from "@workspace/api-zod";
import {
  campaignApplicationsTable,
  campaignSubmissionsTable,
  campaignsTable,
  creatorPlatformsTable,
  creatorProfilesTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { campaignEligibilityReasons } from "../lib/campaign-eligibility";
import { notifyApplicationReceived } from "../lib/email-events";
import { requireRole } from "./auth";

const router: IRouter = Router();

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function creatorIdFrom(res: Response): string {
  return (res.locals.authUser as typeof usersTable.$inferSelect).id;
}

function utcDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function creatorApplicationResponse(
  application: typeof campaignApplicationsTable.$inferSelect,
  campaignTitle: string,
  campaignDeadline: string,
  submission: typeof campaignSubmissionsTable.$inferSelect | null,
) {
  return {
    id: application.id,
    campaignId: application.campaignId,
    campaignTitle,
    campaignDeadline,
    startedAt: application.startedAt?.toISOString() ?? null,
    submission: submission
      ? {
          id: submission.id,
          applicationId: submission.applicationId,
          attempt: submission.attempt,
          title: submission.title,
          projectUrl: submission.projectUrl,
          description: submission.description,
          coverUrl: submission.coverObjectPath
            ? `/api/creator/submissions/${submission.id}/cover`
            : null,
          status: submission.status,
          rejectionReason: submission.rejectionReason,
          submittedAt: submission.submittedAt.toISOString(),
          reviewedAt: submission.reviewedAt?.toISOString() ?? null,
          canResubmit:
            submission.status === "SUBMISSION_REJECTED" &&
            submission.attempt === 1 &&
            campaignDeadline >= utcDateToday(),
        }
      : null,
    personalMessage: application.personalMessage,
    paymentRuleAcknowledged: application.paymentRuleAcknowledged,
    rejectionReason: application.decisionReason,
    decisionNote: application.decisionNote,
    status: application.status,
    appliedAt: application.createdAt.toISOString(),
  };
}

router.get(
  "/creator/applications",
  requireRole("CREATOR"),
  async (_req, res): Promise<void> => {
    const creatorId = creatorIdFrom(res);
    const rows = await db
      .select({
        application: campaignApplicationsTable,
        campaignTitle: campaignsTable.title,
        campaignDeadline: campaignsTable.deadline,
      })
      .from(campaignApplicationsTable)
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .where(eq(campaignApplicationsTable.creatorId, creatorId))
      .orderBy(desc(campaignApplicationsTable.createdAt));
    const applicationIds = rows.map(({ application }) => application.id);
    const submissionRows =
      applicationIds.length > 0
        ? await db
            .select()
            .from(campaignSubmissionsTable)
            .where(inArray(campaignSubmissionsTable.applicationId, applicationIds))
            .orderBy(desc(campaignSubmissionsTable.attempt))
        : [];
    const latestByApplication = new Map<
      string,
      (typeof submissionRows)[number]
    >();
    for (const submission of submissionRows) {
      if (!latestByApplication.has(submission.applicationId)) {
        latestByApplication.set(submission.applicationId, submission);
      }
    }

    res.json(
      ListCreatorApplicationsResponse.parse({
        applications: rows.map(({ application, campaignTitle, campaignDeadline }) =>
          creatorApplicationResponse(
            application,
            campaignTitle,
            campaignDeadline,
            latestByApplication.get(application.id) ?? null,
          ),
        ),
      }),
    );
  },
);

router.post(
  "/creator/campaigns/:campaignId/applications",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = CreateCreatorCampaignApplicationParams.safeParse(req.params);
    const body = CreateCreatorCampaignApplicationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Check the application message and payment-rule checkbox.");
      return;
    }

    const personalMessage = body.data.personalMessage.trim();
    if (personalMessage.length < 20 || personalMessage.length > 1000) {
      error(res, 400, "Your personal message must be 20 to 1,000 characters.");
      return;
    }
    if (!body.data.paymentRuleAcknowledged) {
      error(res, 400, "You must acknowledge the fixed payment rule to apply.");
      return;
    }

    const creatorId = creatorIdFrom(res);
    const today = utcDateToday();
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, params.data.campaignId),
          eq(campaignsTable.status, "PUBLISHED"),
          gte(campaignsTable.deadline, today),
        ),
      )
      .limit(1);

    if (!campaign) {
      error(res, 404, "This campaign is no longer open for applications.");
      return;
    }

    const [existingApplication] = await db
      .select({ id: campaignApplicationsTable.id })
      .from(campaignApplicationsTable)
      .where(
        and(
          eq(campaignApplicationsTable.campaignId, campaign.id),
          eq(campaignApplicationsTable.creatorId, creatorId),
        ),
      )
      .limit(1);
    if (existingApplication) {
      error(res, 409, "You have already applied to this campaign.");
      return;
    }

    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, creatorId))
      .limit(1);
    if (!profile || profile.approvalStatus !== "APPROVED") {
      error(res, 403, "Your creator profile must be approved before you can apply.");
      return;
    }

    const platforms = await db
      .select()
      .from(creatorPlatformsTable)
      .where(eq(creatorPlatformsTable.userId, creatorId));
    const reasons = campaignEligibilityReasons(campaign, profile, platforms);
    if (reasons.length > 0) {
      error(res, 403, reasons.join(" "));
      return;
    }

    const [application] = await db
      .insert(campaignApplicationsTable)
      .values({
        campaignId: campaign.id,
        creatorId,
        personalMessage,
        paymentRuleAcknowledged: true,
        status: "UNDER_REVIEW",
        decisionReason: null,
        decisionNote: null,
        decidedBy: null,
        decidedAt: null,
      })
      .onConflictDoNothing({
        target: [
          campaignApplicationsTable.creatorId,
          campaignApplicationsTable.campaignId,
        ],
      })
      .returning();

    if (!application) {
      error(res, 409, "You have already applied to this campaign.");
      return;
    }

    res.status(201).json(
      CreateCreatorCampaignApplicationResponse.parse(
        creatorApplicationResponse(application, campaign.title, campaign.deadline, null),
      ),
    );
    const creator = res.locals.authUser as typeof usersTable.$inferSelect;
    void notifyApplicationReceived(creator.email, campaign.title).catch(() => {});
  },
);

export default router;
