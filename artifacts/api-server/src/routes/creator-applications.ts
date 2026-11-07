import { and, desc, eq, gte } from "drizzle-orm";
import {
  CreateCreatorCampaignApplicationBody,
  CreateCreatorCampaignApplicationParams,
  CreateCreatorCampaignApplicationResponse,
  ListCreatorApplicationsResponse,
} from "@workspace/api-zod";
import {
  campaignApplicationsTable,
  campaignsTable,
  creatorPlatformsTable,
  creatorProfilesTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { campaignEligibilityReasons } from "../lib/campaign-eligibility";
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
) {
  return {
    id: application.id,
    campaignId: application.campaignId,
    campaignTitle,
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
      })
      .from(campaignApplicationsTable)
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .where(eq(campaignApplicationsTable.creatorId, creatorId))
      .orderBy(desc(campaignApplicationsTable.createdAt));

    res.json(
      ListCreatorApplicationsResponse.parse({
        applications: rows.map(({ application, campaignTitle }) =>
          creatorApplicationResponse(application, campaignTitle),
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
        creatorApplicationResponse(application, campaign.title),
      ),
    );
  },
);

export default router;
