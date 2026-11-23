import { and, count, desc, eq, gte, ilike, inArray, or } from "drizzle-orm";
import {
  GetCreatorCampaignParams,
  GetCreatorCampaignResponse,
  ListCreatorCampaignsResponse,
} from "@workspace/api-zod";
import { campaignApplicationsTable, campaignsTable, db } from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { CAMPAIGN_PAYMENT_RULE } from "./admin-campaigns";
import { requireRole } from "./auth";
import { escapeLike, LIST_PAGE_SIZE, paginationFor, readListQuery } from "../lib/list-query";

const router: IRouter = Router();

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function campaignResponse(
  campaign: typeof campaignsTable.$inferSelect,
  hasApplied = false,
) {
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
    hasApplied,
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
  async (req, res): Promise<void> => {
    const list = readListQuery(req, res);
    if (!list) return;
    const conditions = [
      eq(campaignsTable.status, "PUBLISHED"),
      gte(campaignsTable.deadline, currentUtcDate()),
    ];
    const search = list.search ? `%${escapeLike(list.search)}%` : null;
    const where = search
      ? and(
          ...conditions,
          or(
            ilike(campaignsTable.title, search),
            ilike(campaignsTable.organizerName, search),
            ilike(campaignsTable.shortDescription, search),
          ),
        )
      : and(...conditions);
    const [{ total }] = await db
      .select({ total: count() })
      .from(campaignsTable)
      .where(where);
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(where)
      .orderBy(desc(campaignsTable.createdAt))
      .limit(LIST_PAGE_SIZE)
      .offset(list.offset);
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const applicationRows =
      campaignIds.length > 0
        ? await db
            .select({ campaignId: campaignApplicationsTable.campaignId })
            .from(campaignApplicationsTable)
            .where(
              and(
                eq(campaignApplicationsTable.creatorId, res.locals.authUser.id),
                inArray(campaignApplicationsTable.campaignId, campaignIds),
              ),
            )
        : [];
    const appliedIds = new Set(applicationRows.map((row) => row.campaignId));

    res.json(
      ListCreatorCampaignsResponse.parse({
        campaigns: campaigns.map((campaign) =>
          campaignResponse(campaign, appliedIds.has(campaign.id)),
        ),
        pagination: paginationFor(list.page, total),
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

    const [application] = await db
      .select({ id: campaignApplicationsTable.id })
      .from(campaignApplicationsTable)
      .where(
        and(
          eq(campaignApplicationsTable.campaignId, campaign.id),
          eq(campaignApplicationsTable.creatorId, res.locals.authUser.id),
        ),
      )
      .limit(1);
    res.json(
      GetCreatorCampaignResponse.parse(
        campaignResponse(campaign, Boolean(application)),
      ),
    );
  },
);

export default router;
