import { and, desc, eq, gte } from "drizzle-orm";
import {
  GetCreatorCampaignParams,
  GetCreatorCampaignResponse,
  ListCreatorCampaignsResponse,
} from "@workspace/api-zod";
import { campaignsTable, db } from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { CAMPAIGN_PAYMENT_RULE } from "./admin-campaigns";
import { requireRole } from "./auth";

const router: IRouter = Router();

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function campaignResponse(campaign: typeof campaignsTable.$inferSelect) {
  return {
    id: campaign.id,
    title: campaign.title,
    organizerName: campaign.organizerName,
    shortDescription: campaign.shortDescription,
    objectives: campaign.objectives,
    contentRequirements: campaign.contentRequirements,
    rewardAmount: Number(campaign.rewardAmount),
    currency: campaign.currency,
    deadline: campaign.deadline,
    acceptedPlatforms: campaign.acceptedPlatforms,
    allowedCountries: campaign.allowedCountries,
    minimumFollowers: campaign.minimumFollowers,
    niches: campaign.niches,
    status: campaign.status,
    paymentRule: CAMPAIGN_PAYMENT_RULE,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

router.get(
  "/creator/campaigns",
  requireRole("CREATOR"),
  async (_req, res): Promise<void> => {
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.status, "PUBLISHED"),
          gte(campaignsTable.deadline, currentUtcDate()),
        ),
      )
      .orderBy(desc(campaignsTable.createdAt));

    res.json(
      ListCreatorCampaignsResponse.parse({
        campaigns: campaigns.map(campaignResponse),
      }),
    );
  },
);

router.get(
  "/creator/campaigns/:campaignId",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = GetCreatorCampaignParams.safeParse(req.params);
    if (!params.success) {
      error(res, 400, "Campaign identifier is invalid.");
      return;
    }

    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, params.data.campaignId),
          eq(campaignsTable.status, "PUBLISHED"),
          gte(campaignsTable.deadline, currentUtcDate()),
        ),
      )
      .limit(1);

    if (!campaign) {
      error(res, 404, "Campaign not found.");
      return;
    }

    res.json(GetCreatorCampaignResponse.parse(campaignResponse(campaign)));
  },
);

export default router;
