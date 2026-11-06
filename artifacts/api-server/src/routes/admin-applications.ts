import { asc, desc, eq, sql } from "drizzle-orm";
import { ListAdminCampaignApplicationsResponse } from "@workspace/api-zod";
import {
  campaignApplicationsTable,
  campaignsTable,
  creatorProfilesTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter } from "express";
import { requireRole } from "./auth";

const router: IRouter = Router();

router.get(
  "/admin/applications",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: campaignApplicationsTable.id,
        campaignId: campaignApplicationsTable.campaignId,
        campaignTitle: campaignsTable.title,
        creatorName: sql<string>`coalesce(${creatorProfilesTable.displayName}, ${usersTable.name})`,
        personalMessage: campaignApplicationsTable.personalMessage,
        paymentRuleAcknowledged: campaignApplicationsTable.paymentRuleAcknowledged,
        status: campaignApplicationsTable.status,
        appliedAt: campaignApplicationsTable.createdAt,
      })
      .from(campaignApplicationsTable)
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .innerJoin(
        usersTable,
        eq(campaignApplicationsTable.creatorId, usersTable.id),
      )
      .leftJoin(
        creatorProfilesTable,
        eq(campaignApplicationsTable.creatorId, creatorProfilesTable.userId),
      )
      .orderBy(asc(campaignsTable.title), desc(campaignApplicationsTable.createdAt));

    res.json(
      ListAdminCampaignApplicationsResponse.parse({
        applications: rows.map((application) => ({
          ...application,
          appliedAt: application.appliedAt.toISOString(),
        })),
      }),
    );
  },
);

export default router;
