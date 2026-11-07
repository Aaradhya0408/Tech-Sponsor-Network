import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  ListAdminCampaignApplicationsResponse,
  UpdateAdminCampaignApplicationDecisionBody,
  UpdateAdminCampaignApplicationDecisionParams,
  UpdateAdminCampaignApplicationDecisionResponse,
} from "@workspace/api-zod";
import {
  CAMPAIGN_APPLICATION_REJECTION_REASONS,
  CAMPAIGN_APPLICATION_STATUSES,
  campaignApplicationDecisionsTable,
  campaignApplicationsTable,
  campaignsTable,
  creatorPlatformsTable,
  creatorProfilesTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { requireRole } from "./auth";

const router: IRouter = Router();
type UserRecord = typeof usersTable.$inferSelect;

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function adminUserFrom(res: Response): UserRecord {
  return res.locals.authUser as UserRecord;
}

router.get(
  "/admin/applications",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        application: campaignApplicationsTable,
        campaignTitle: campaignsTable.title,
        creatorName: creatorProfilesTable.displayName,
        creatorCountry: creatorProfilesTable.country,
        creatorNiche: creatorProfilesTable.niche,
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
      .innerJoin(
        creatorProfilesTable,
        eq(campaignApplicationsTable.creatorId, creatorProfilesTable.userId),
      )
      .orderBy(asc(campaignsTable.title), desc(campaignApplicationsTable.createdAt));

    const applicationIds = rows.map(({ application }) => application.id);
    const creatorIds = [...new Set(rows.map(({ application }) => application.creatorId))];
    const [decisionRows, platformRows] =
      applicationIds.length > 0
        ? await Promise.all([
            db
              .select({
                decision: campaignApplicationDecisionsTable,
                decidedByName: usersTable.name,
              })
              .from(campaignApplicationDecisionsTable)
              .innerJoin(
                usersTable,
                eq(campaignApplicationDecisionsTable.decidedBy, usersTable.id),
              )
              .where(
                inArray(
                  campaignApplicationDecisionsTable.applicationId,
                  applicationIds,
                ),
              )
              .orderBy(asc(campaignApplicationDecisionsTable.decidedAt)),
            db
              .select()
              .from(creatorPlatformsTable)
              .where(inArray(creatorPlatformsTable.userId, creatorIds)),
          ])
        : [[], []];

    const decisionsByApplication = new Map<
      string,
      Array<{
        id: string;
        previousStatus: (typeof CAMPAIGN_APPLICATION_STATUSES)[number];
        status: (typeof CAMPAIGN_APPLICATION_STATUSES)[number];
        rejectionReason:
          | (typeof CAMPAIGN_APPLICATION_REJECTION_REASONS)[number]
          | null;
        note: string | null;
        changeReason: string | null;
        decidedByName: string;
        decidedAt: Date;
      }>
    >();
    for (const { decision, decidedByName } of decisionRows) {
      const history = decisionsByApplication.get(decision.applicationId) ?? [];
      history.push({
        id: decision.id,
        previousStatus: decision.previousStatus,
        status: decision.status,
        rejectionReason: decision.rejectionReason,
        note: decision.decisionNote,
        changeReason: decision.changeReason,
        decidedByName,
        decidedAt: decision.decidedAt,
      });
      decisionsByApplication.set(decision.applicationId, history);
    }

    const platformsByCreator = new Map<
      string,
      Array<{
        platform: (typeof creatorPlatformsTable.$inferSelect)["platform"];
        url: string;
        followers: number;
        verified: boolean;
      }>
    >();
    for (const platform of platformRows) {
      const profilePlatforms = platformsByCreator.get(platform.userId) ?? [];
      profilePlatforms.push({
        platform: platform.platform,
        url: platform.url,
        followers: platform.followers,
        verified: platform.verified,
      });
      platformsByCreator.set(platform.userId, profilePlatforms);
    }

    res.json(
      ListAdminCampaignApplicationsResponse.parse({
        applications: rows.map(
          ({
            application,
            campaignTitle,
            creatorName,
            creatorCountry,
            creatorNiche,
          }) => {
            const history = decisionsByApplication.get(application.id) ?? [];
            const latestDecision = history.at(-1);
            return {
              id: application.id,
              campaignId: application.campaignId,
              campaignTitle,
              creatorName,
              creatorCountry,
              creatorNiche,
              platforms: platformsByCreator.get(application.creatorId) ?? [],
              personalMessage: application.personalMessage,
              paymentRuleAcknowledged: application.paymentRuleAcknowledged,
              rejectionReason: application.decisionReason,
              decisionNote: application.decisionNote,
              decidedByName: latestDecision?.decidedByName ?? null,
              decidedAt: application.decidedAt?.toISOString() ?? null,
              decisionHistory: history.map((decision) => ({
                ...decision,
                decidedAt: decision.decidedAt.toISOString(),
              })),
              status: application.status,
              appliedAt: application.createdAt.toISOString(),
            };
          },
        ),
      }),
    );
  },
);

router.patch(
  "/admin/applications/:applicationId/decision",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateAdminCampaignApplicationDecisionParams.safeParse(
      req.params,
    );
    const body = UpdateAdminCampaignApplicationDecisionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Choose a valid application decision.");
      return;
    }

    const { status } = body.data;
    const note = body.data.note?.trim() ?? "";
    const changeReason = body.data.changeReason?.trim() ?? "";
    const rejectionReason = body.data.rejectionReason ?? null;

    if (status === "NOT_SELECTED") {
      if (!rejectionReason) {
        error(res, 400, "Choose a reason when rejecting an application.");
        return;
      }
      if (rejectionReason === "OTHER" && !note) {
        error(res, 400, "Add a short note when the rejection reason is Other.");
        return;
      }
    } else if (rejectionReason) {
      error(res, 400, "A rejection reason is only valid when rejecting.");
      return;
    }

    const admin = adminUserFrom(res);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(campaignApplicationsTable)
        .where(eq(campaignApplicationsTable.id, params.data.applicationId))
        .limit(1);

      if (!current) {
        return {
          ok: false as const,
          error: { status: 404, message: "Application not found." },
        };
      }

      if (
        current.status === "PAID" ||
        current.status === status ||
        (status === "WINNER" && current.status !== "ACCEPTED") ||
        (current.status === "UNDER_REVIEW" && status === "WINNER")
      ) {
        return {
          ok: false as const,
          error: {
            status: 409,
            message:
              status === "WINNER"
                ? "Only an Accepted application can become a Winner."
                : "This application cannot be moved from its current status.",
          },
        };
      }

      const isDecisionChange = current.status !== "UNDER_REVIEW";
      if (isDecisionChange && !changeReason) {
        return {
          ok: false as const,
          error: {
            status: 400,
            message: "A reason is required when changing an existing decision.",
          },
        };
      }

      const decidedAt = new Date();
      const [updated] = await tx
        .update(campaignApplicationsTable)
        .set({
          status,
          decisionReason: status === "NOT_SELECTED" ? rejectionReason : null,
          decisionNote: note || null,
          decidedBy: admin.id,
          decidedAt,
        })
        .where(
          and(
            eq(campaignApplicationsTable.id, current.id),
            eq(campaignApplicationsTable.status, current.status),
          ),
        )
        .returning();

      if (!updated) {
        return {
          ok: false as const,
          error: {
            status: 409,
            message: "Another administrator updated this application first.",
          },
        };
      }

      await tx.insert(campaignApplicationDecisionsTable).values({
        applicationId: current.id,
        previousStatus: current.status,
        status,
        rejectionReason: status === "NOT_SELECTED" ? rejectionReason : null,
        decisionNote: note || null,
        changeReason: isDecisionChange ? changeReason : null,
        decidedBy: admin.id,
        decidedAt,
      });

      return { ok: true as const, updated };
    });

    if (!result.ok) {
      error(res, result.error.status, result.error.message);
      return;
    }

    res.json(
      UpdateAdminCampaignApplicationDecisionResponse.parse({
        id: result.updated.id,
        status: result.updated.status,
        rejectionReason: result.updated.decisionReason,
        note: result.updated.decisionNote,
        decidedByName: admin.name,
        decidedAt: result.updated.decidedAt,
      }),
    );
  },
);

export default router;
