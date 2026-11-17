import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  ListAdminCampaignSubmissionsQueryParams,
  ListAdminCampaignSubmissionsResponse,
  UpdateAdminCampaignSubmissionDecisionBody,
  UpdateAdminCampaignSubmissionDecisionParams,
  UpdateAdminCampaignSubmissionDecisionResponse,
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
import { Router, type IRouter, type Request, type Response } from "express";
import { notifySubmissionDecision } from "../lib/email-events";
import { streamPrivateObject } from "../lib/private-invoice-storage";
import { requireRole } from "./auth";

const router: IRouter = Router();
type UserRecord = typeof usersTable.$inferSelect;

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function adminFrom(res: Response): UserRecord {
  return res.locals.authUser as UserRecord;
}

function sanitizeReason(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function adminSubmissionResponse(
  row: {
    submission: typeof campaignSubmissionsTable.$inferSelect;
    campaignId: string;
    campaignTitle: string;
    campaignDeadline: string;
    creatorName: string;
    creatorCountry: string;
    creatorNiche: (typeof creatorProfilesTable.$inferSelect)["niche"];
    reviewedByName: string | null;
  },
  latestId: string,
  platforms: Array<{
    platform: (typeof creatorPlatformsTable.$inferSelect)["platform"];
    url: string;
    followers: number;
    verified: boolean;
  }>,
) {
  const submission = row.submission;
  return {
    id: submission.id,
    applicationId: submission.applicationId,
    attempt: submission.attempt,
    title: submission.title,
    projectUrl: submission.projectUrl,
    description: submission.description,
    coverUrl: submission.coverObjectPath
      ? `/api/admin/submissions/${submission.id}/cover`
      : null,
    status: submission.status,
    rejectionReason: submission.rejectionReason,
    submittedAt: submission.submittedAt.toISOString(),
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    canResubmit:
      submission.status === "SUBMISSION_REJECTED" &&
      submission.attempt === 1 &&
      row.campaignDeadline >= new Date().toISOString().slice(0, 10),
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    creatorName: row.creatorName,
    creatorCountry: row.creatorCountry,
    creatorNiche: row.creatorNiche,
    platforms,
    isCurrent: submission.id === latestId,
    reviewedByName: row.reviewedByName,
  };
}

async function getAdminSubmission(submissionId: string) {
  const [row] = await db
    .select({
      submission: campaignSubmissionsTable,
      campaignId: campaignsTable.id,
      campaignTitle: campaignsTable.title,
      campaignDeadline: campaignsTable.deadline,
      creatorName: creatorProfilesTable.displayName,
      creatorCountry: creatorProfilesTable.country,
      creatorNiche: creatorProfilesTable.niche,
      reviewedByName: usersTable.name,
    })
    .from(campaignSubmissionsTable)
    .innerJoin(
      campaignApplicationsTable,
      eq(campaignSubmissionsTable.applicationId, campaignApplicationsTable.id),
    )
    .innerJoin(
      campaignsTable,
      eq(campaignApplicationsTable.campaignId, campaignsTable.id),
    )
    .innerJoin(
      creatorProfilesTable,
      eq(campaignSubmissionsTable.creatorId, creatorProfilesTable.userId),
    )
    .leftJoin(
      usersTable,
      eq(campaignSubmissionsTable.reviewedBy, usersTable.id),
    )
    .where(eq(campaignSubmissionsTable.id, submissionId))
    .limit(1);
  if (!row) return null;

  const [latest] = await db
    .select({ id: campaignSubmissionsTable.id })
    .from(campaignSubmissionsTable)
    .where(eq(campaignSubmissionsTable.applicationId, row.submission.applicationId))
    .orderBy(desc(campaignSubmissionsTable.attempt))
    .limit(1);
  const platforms = await db
    .select({
      platform: creatorPlatformsTable.platform,
      url: creatorPlatformsTable.url,
      followers: creatorPlatformsTable.followers,
      verified: creatorPlatformsTable.verified,
    })
    .from(creatorPlatformsTable)
    .where(eq(creatorPlatformsTable.userId, row.submission.creatorId));
  return adminSubmissionResponse(row, latest?.id ?? "", platforms);
}

router.get(
  "/admin/submissions",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const query = ListAdminCampaignSubmissionsQueryParams.safeParse(req.query);
    if (!query.success) {
      error(res, 400, "Choose a valid campaign and submission status.");
      return;
    }

    const conditions = [];
    if (query.data.campaignId) {
      conditions.push(eq(campaignsTable.id, query.data.campaignId));
    }
    if (query.data.status) {
      conditions.push(eq(campaignSubmissionsTable.status, query.data.status));
    }
    const selection = db
      .select({
        submission: campaignSubmissionsTable,
        campaignId: campaignsTable.id,
        campaignTitle: campaignsTable.title,
        campaignDeadline: campaignsTable.deadline,
        creatorName: creatorProfilesTable.displayName,
        creatorCountry: creatorProfilesTable.country,
        creatorNiche: creatorProfilesTable.niche,
        reviewedByName: usersTable.name,
      })
      .from(campaignSubmissionsTable)
      .innerJoin(
        campaignApplicationsTable,
        eq(campaignSubmissionsTable.applicationId, campaignApplicationsTable.id),
      )
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .innerJoin(
        creatorProfilesTable,
        eq(campaignSubmissionsTable.creatorId, creatorProfilesTable.userId),
      )
      .leftJoin(
        usersTable,
        eq(campaignSubmissionsTable.reviewedBy, usersTable.id),
      );
    const rows = conditions.length
      ? await selection
          .where(and(...conditions))
          .orderBy(asc(campaignsTable.title), desc(campaignSubmissionsTable.submittedAt))
      : await selection.orderBy(
          asc(campaignsTable.title),
          desc(campaignSubmissionsTable.submittedAt),
        );
    const applicationIds = [...new Set(rows.map(({ submission }) => submission.applicationId))];
    const creatorIds = [...new Set(rows.map(({ submission }) => submission.creatorId))];
    const [latestRows, platformRows] =
      applicationIds.length > 0
        ? await Promise.all([
            db
              .select({
                id: campaignSubmissionsTable.id,
                applicationId: campaignSubmissionsTable.applicationId,
              })
              .from(campaignSubmissionsTable)
              .where(inArray(campaignSubmissionsTable.applicationId, applicationIds))
              .orderBy(desc(campaignSubmissionsTable.attempt)),
            db
              .select({
                userId: creatorPlatformsTable.userId,
                platform: creatorPlatformsTable.platform,
                url: creatorPlatformsTable.url,
                followers: creatorPlatformsTable.followers,
                verified: creatorPlatformsTable.verified,
              })
              .from(creatorPlatformsTable)
              .where(inArray(creatorPlatformsTable.userId, creatorIds)),
          ])
        : [[], []];
    const latestByApplication = new Map<string, string>();
    for (const latest of latestRows) {
      if (!latestByApplication.has(latest.applicationId)) {
        latestByApplication.set(latest.applicationId, latest.id);
      }
    }
    const platformsByCreator = new Map<string, typeof platformRows>();
    for (const platform of platformRows) {
      const list = platformsByCreator.get(platform.userId) ?? [];
      list.push(platform);
      platformsByCreator.set(platform.userId, list);
    }

    res.json(
      ListAdminCampaignSubmissionsResponse.parse({
        submissions: rows.map((row) =>
          adminSubmissionResponse(
            row,
            latestByApplication.get(row.submission.applicationId) ?? "",
            platformsByCreator.get(row.submission.creatorId) ?? [],
          ),
        ),
      }),
    );
  },
);

router.patch(
  "/admin/submissions/:submissionId/decision",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateAdminCampaignSubmissionDecisionParams.safeParse(
      req.params,
    );
    const body = UpdateAdminCampaignSubmissionDecisionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Choose whether to accept or reject this project.");
      return;
    }
    const rejectionReason =
      body.data.status === "SUBMISSION_REJECTED"
        ? sanitizeReason(body.data.rejectionReason ?? "")
        : "";
    if (body.data.status === "SUBMISSION_REJECTED" && !rejectionReason) {
      error(res, 400, "Add a reason when rejecting a project submission.");
      return;
    }
    if (body.data.status === "SUBMISSION_ACCEPTED" && body.data.rejectionReason) {
      error(res, 400, "A rejection reason is only valid when rejecting.");
      return;
    }

    const admin = adminFrom(res);
    const result = await db.transaction(async (tx) => {
      const [submission] = await tx
        .select()
        .from(campaignSubmissionsTable)
        .where(eq(campaignSubmissionsTable.id, params.data.submissionId))
        .for("update")
        .limit(1);
      if (!submission) {
        return {
          ok: false as const,
          status: 404,
          message: "Project submission not found.",
        };
      }
      const [application] = await tx
        .select()
        .from(campaignApplicationsTable)
        .where(eq(campaignApplicationsTable.id, submission.applicationId))
        .for("update")
        .limit(1);
      if (!application) {
        return {
          ok: false as const,
          status: 404,
          message: "Campaign application not found.",
        };
      }
      const [latest] = await tx
        .select({ id: campaignSubmissionsTable.id })
        .from(campaignSubmissionsTable)
        .where(eq(campaignSubmissionsTable.applicationId, application.id))
        .orderBy(desc(campaignSubmissionsTable.attempt))
        .limit(1);
      if (
        submission.status !== "SUBMITTED" ||
        application.status !== "SUBMITTED" ||
        latest?.id !== submission.id
      ) {
        return {
          ok: false as const,
          status: 409,
          message: "Only the current submission awaiting review can be decided.",
        };
      }

      const reviewedAt = new Date();
      const [updatedSubmission] = await tx
        .update(campaignSubmissionsTable)
        .set({
          status: body.data.status,
          rejectionReason: body.data.status === "SUBMISSION_REJECTED" ? rejectionReason : null,
          reviewedBy: admin.id,
          reviewedAt,
        })
        .where(
          and(
            eq(campaignSubmissionsTable.id, submission.id),
            eq(campaignSubmissionsTable.status, "SUBMITTED"),
          ),
        )
        .returning();
      if (!updatedSubmission) {
        return {
          ok: false as const,
          status: 409,
          message: "Another administrator decided this submission first.",
        };
      }
      const [updatedApplication] = await tx
        .update(campaignApplicationsTable)
        .set({
          status: body.data.status,
          decidedBy: admin.id,
          decidedAt: reviewedAt,
        })
        .where(
          and(
            eq(campaignApplicationsTable.id, application.id),
            eq(campaignApplicationsTable.status, "SUBMITTED"),
          ),
        )
        .returning({ id: campaignApplicationsTable.id });
      if (!updatedApplication) {
        throw new Error("The application changed during submission review.");
      }
      return { ok: true as const, submission: updatedSubmission };
    });

    if (!result.ok) {
      error(res, result.status, result.message);
      return;
    }
    const response = await getAdminSubmission(result.submission.id);
    if (!response) {
      error(res, 404, "Project submission not found.");
      return;
    }
    res.json(UpdateAdminCampaignSubmissionDecisionResponse.parse(response));
    void notifySubmissionDecision(
      result.submission.id,
      result.submission.status as "SUBMISSION_ACCEPTED" | "SUBMISSION_REJECTED",
      result.submission.rejectionReason,
    ).catch((err) =>
      req.log.warn({ err }, "Submission-decision email could not be delivered"),
    );
  },
);

async function serveAdminCover(
  req: Request,
  res: Response,
): Promise<void> {
  const rawId = Array.isArray(req.params.submissionId)
    ? req.params.submissionId[0]
    : req.params.submissionId;
  if (!/^[0-9a-f-]{36}$/i.test(rawId)) {
    error(res, 404, "Submission cover not found.");
    return;
  }
  const [submission] = await db
    .select()
    .from(campaignSubmissionsTable)
    .where(eq(campaignSubmissionsTable.id, rawId))
    .limit(1);
  if (!submission?.coverObjectPath || !submission.coverContentType) {
    error(res, 404, "Submission cover not found.");
    return;
  }
  try {
    await streamPrivateObject(
      submission.coverObjectPath,
      res,
      submission.coverContentType,
      "project-cover",
    );
  } catch (err) {
    req.log.error({ err, submissionId: rawId }, "Unable to open private submission cover");
    if (!res.headersSent) error(res, 500, "The submission cover could not be opened.");
  }
}

router.get(
  "/admin/submissions/:submissionId/cover",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => serveAdminCover(req, res),
);

export default router;
