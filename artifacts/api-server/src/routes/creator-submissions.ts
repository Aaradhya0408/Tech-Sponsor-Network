import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateCreatorCampaignSubmissionBody,
  CreateCreatorCampaignSubmissionParams,
  CreateCreatorCampaignSubmissionResponse,
  RequestCreatorSubmissionUploadUrlBody,
  RequestCreatorSubmissionUploadUrlParams,
  RequestCreatorSubmissionUploadUrlResponse,
  StartCreatorCampaignProjectParams,
  StartCreatorCampaignProjectResponse,
} from "@workspace/api-zod";
import {
  campaignApplicationsTable,
  campaignSubmissionsTable,
  campaignsTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createSubmissionCoverStagingUpload,
  deletePrivateObject,
  isSubmissionCoverStagingPath,
  readPrivateObject,
  removeStagingObject,
  storeVerifiedPrivateObject,
  streamPrivateObject,
} from "../lib/private-invoice-storage";
import {
  notifySubmissionReceived,
} from "../lib/email-events";
import { requireRole } from "./auth";

const router: IRouter = Router();
const MAX_FILE_SIZE = 5 * 1024 * 1024;
type UserRecord = typeof usersTable.$inferSelect;

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function creatorFrom(res: Response): UserRecord {
  return res.locals.authUser as UserRecord;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function detectedCoverType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return null;
}

async function getOwnedApplication(applicationId: string, creatorId: string) {
  const [row] = await db
    .select({
      application: campaignApplicationsTable,
      campaign: campaignsTable,
    })
    .from(campaignApplicationsTable)
    .innerJoin(
      campaignsTable,
      eq(campaignApplicationsTable.campaignId, campaignsTable.id),
    )
    .where(
      and(
        eq(campaignApplicationsTable.id, applicationId),
        eq(campaignApplicationsTable.creatorId, creatorId),
      ),
    )
    .limit(1);
  return row;
}

async function latestSubmission(applicationId: string) {
  const [submission] = await db
    .select()
    .from(campaignSubmissionsTable)
    .where(eq(campaignSubmissionsTable.applicationId, applicationId))
    .orderBy(desc(campaignSubmissionsTable.attempt))
    .limit(1);
  return submission;
}

function creatorSubmissionResponse(
  submission: typeof campaignSubmissionsTable.$inferSelect,
  campaignDeadline: string,
) {
  return {
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
      campaignDeadline >= todayUtc(),
  };
}

router.post(
  "/creator/applications/:applicationId/start",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = StartCreatorCampaignProjectParams.safeParse(req.params);
    if (!params.success) {
      error(res, 400, "Choose a valid application.");
      return;
    }

    const creator = creatorFrom(res);
    const row = await getOwnedApplication(params.data.applicationId, creator.id);
    if (!row) {
      error(res, 404, "Application not found.");
      return;
    }
    if (row.application.status !== "ACCEPTED") {
      error(res, 409, "Only an accepted application can be started.");
      return;
    }

    const startedAt = new Date();
    const [updated] = await db
      .update(campaignApplicationsTable)
      .set({ status: "IN_PROGRESS", startedAt })
      .where(
        and(
          eq(campaignApplicationsTable.id, row.application.id),
          eq(campaignApplicationsTable.creatorId, creator.id),
          eq(campaignApplicationsTable.status, "ACCEPTED"),
        ),
      )
      .returning({ id: campaignApplicationsTable.id });
    if (!updated) {
      error(res, 409, "This application changed before the project could start.");
      return;
    }

    res.json(
      StartCreatorCampaignProjectResponse.parse({
        applicationId: row.application.id,
        status: "IN_PROGRESS",
        startedAt: startedAt.toISOString(),
      }),
    );
  },
);

router.post(
  "/creator/applications/:applicationId/submission-upload-url",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = RequestCreatorSubmissionUploadUrlParams.safeParse(req.params);
    const body = RequestCreatorSubmissionUploadUrlBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Choose a JPG or PNG image no larger than 5 MB.");
      return;
    }

    const creator = creatorFrom(res);
    const row = await getOwnedApplication(params.data.applicationId, creator.id);
    if (!row) {
      error(res, 404, "Application not found.");
      return;
    }
    if (
      !["IN_PROGRESS", "SUBMISSION_REJECTED"].includes(row.application.status) ||
      row.campaign.deadline < todayUtc()
    ) {
      error(res, 403, "This project is not accepting a submission right now.");
      return;
    }
    if (
      body.data.size > MAX_FILE_SIZE ||
      !["image/jpeg", "image/png"].includes(body.data.contentType)
    ) {
      error(res, 400, "Choose a JPG or PNG image no larger than 5 MB.");
      return;
    }
    if (row.application.status === "SUBMISSION_REJECTED") {
      const prior = await latestSubmission(row.application.id);
      if (!prior || prior.status !== "SUBMISSION_REJECTED" || prior.attempt !== 1) {
        error(res, 409, "The one allowed resubmission has already been used.");
        return;
      }
    }

    try {
      const upload = await createSubmissionCoverStagingUpload(
        creator.id,
        row.application.id,
      );
      res.json(RequestCreatorSubmissionUploadUrlResponse.parse(upload));
    } catch (err) {
      req.log.error({ err }, "Unable to create private project-cover upload URL");
      error(res, 503, "Private image storage is temporarily unavailable.");
    }
  },
);

router.post(
  "/creator/applications/:applicationId/submission",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = CreateCreatorCampaignSubmissionParams.safeParse(req.params);
    const body = CreateCreatorCampaignSubmissionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Check the project title, HTTPS link, and description.");
      return;
    }

    const creator = creatorFrom(res);
    const row = await getOwnedApplication(params.data.applicationId, creator.id);
    if (!row) {
      error(res, 404, "Application not found.");
      return;
    }

    const title = sanitizeText(body.data.title, 160);
    const description = sanitizeText(body.data.description, 500);
    const projectUrl = body.data.projectUrl.trim();
    if (!title || !description || description.length > 500 || !httpsUrl(projectUrl) || projectUrl.length > 2048) {
      error(res, 400, "Enter a title, description up to 500 characters, and a valid HTTPS project link.");
      return;
    }
    if (row.campaign.deadline < todayUtc()) {
      error(res, 403, "The campaign deadline has passed, so submissions are closed.");
      return;
    }

    const prior = await latestSubmission(row.application.id);
    const attempt =
      row.application.status === "IN_PROGRESS" && !prior
        ? 1
        : row.application.status === "SUBMISSION_REJECTED" &&
            prior?.status === "SUBMISSION_REJECTED" &&
            prior.attempt === 1
          ? 2
          : 0;
    if (!attempt) {
      error(res, 409, "This application cannot be submitted again from its current state.");
      return;
    }

    const stagingPath = body.data.coverObjectPath ?? null;
    if (
      stagingPath &&
      !isSubmissionCoverStagingPath(
        stagingPath,
        creator.id,
        row.application.id,
      )
    ) {
      error(res, 400, "Upload the cover image using this project submission form.");
      return;
    }

    let coverBytes: Buffer | null = null;
    let coverContentType: "image/png" | "image/jpeg" | null = null;
    if (stagingPath) {
      try {
        const uploaded = await readPrivateObject(stagingPath);
        coverBytes = uploaded.bytes;
        coverContentType = detectedCoverType(uploaded.bytes);
        if (!coverContentType || uploaded.size > MAX_FILE_SIZE) {
          await removeStagingObject(stagingPath);
          error(res, 400, "The cover must be a real JPG or PNG image no larger than 5 MB.");
          return;
        }
      } catch (err) {
        req.log.warn({ err }, "Unable to verify private project-cover upload");
        error(res, 400, "The cover image is missing, unreadable, or larger than 5 MB.");
        return;
      }
    }

    const submissionId = randomUUID();
    let coverObjectPath: string | null = null;
    try {
      if (coverBytes && coverContentType) {
        coverObjectPath = await storeVerifiedPrivateObject(
          `submissions/${submissionId}/cover`,
          coverBytes,
          coverContentType,
        );
      }

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            application: campaignApplicationsTable,
            campaign: campaignsTable,
          })
          .from(campaignApplicationsTable)
          .innerJoin(
            campaignsTable,
            eq(campaignApplicationsTable.campaignId, campaignsTable.id),
          )
          .where(
            and(
              eq(campaignApplicationsTable.id, row.application.id),
              eq(campaignApplicationsTable.creatorId, creator.id),
            ),
          )
          .for("update")
          .limit(1);
        if (!locked) {
          return { ok: false as const, status: 404, message: "Application not found." };
        }
        if (locked.campaign.deadline < todayUtc()) {
          return { ok: false as const, status: 403, message: "The campaign deadline has passed, so submissions are closed." };
        }

        const [latest] = await tx
          .select()
          .from(campaignSubmissionsTable)
          .where(eq(campaignSubmissionsTable.applicationId, locked.application.id))
          .orderBy(desc(campaignSubmissionsTable.attempt))
          .limit(1);
        const validFirst =
          locked.application.status === "IN_PROGRESS" && !latest && attempt === 1;
        const validRetry =
          locked.application.status === "SUBMISSION_REJECTED" &&
          latest?.status === "SUBMISSION_REJECTED" &&
          latest.attempt === 1 &&
          attempt === 2;
        if (!validFirst && !validRetry) {
          return {
            ok: false as const,
            status: 409,
            message: "This application changed before the submission could be saved.",
          };
        }

        const [updated] = await tx
          .update(campaignApplicationsTable)
          .set({ status: "SUBMITTED" })
          .where(
            and(
              eq(campaignApplicationsTable.id, locked.application.id),
              eq(campaignApplicationsTable.creatorId, creator.id),
              eq(campaignApplicationsTable.status, locked.application.status),
            ),
          )
          .returning({ id: campaignApplicationsTable.id });
        if (!updated) {
          return {
            ok: false as const,
            status: 409,
            message: "This application changed before the submission could be saved.",
          };
        }

        const [submission] = await tx
          .insert(campaignSubmissionsTable)
          .values({
            id: submissionId,
            applicationId: locked.application.id,
            creatorId: creator.id,
            attempt,
            title,
            projectUrl,
            description,
            coverObjectPath,
            coverContentType,
            status: "SUBMITTED",
          })
          .returning();
        return { ok: true as const, submission, campaignTitle: locked.campaign.title, campaignDeadline: locked.campaign.deadline };
      });

      if (!result.ok) {
        if (coverObjectPath) await deletePrivateObject(coverObjectPath);
        if (stagingPath) await removeStagingObject(stagingPath);
        error(res, result.status, result.message);
        return;
      }

      if (stagingPath) await removeStagingObject(stagingPath);
      res.status(201).json(
        CreateCreatorCampaignSubmissionResponse.parse(
          creatorSubmissionResponse(result.submission, result.campaignDeadline),
        ),
      );
      void notifySubmissionReceived(
        result.submission.id,
        result.campaignTitle,
      ).catch((err) =>
        req.log.warn({ err }, "Submission-received email could not be delivered"),
      );
    } catch (err) {
      if (coverObjectPath) await deletePrivateObject(coverObjectPath);
      if (stagingPath) await removeStagingObject(stagingPath);
      req.log.error({ err }, "Unable to save creator project submission");
      error(res, 500, "The project submission could not be saved. Please try again.");
    }
  },
);

async function serveCreatorCover(
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
  const creator = creatorFrom(res);
  const [submission] = await db
    .select()
    .from(campaignSubmissionsTable)
    .where(
      and(
        eq(campaignSubmissionsTable.id, rawId),
        eq(campaignSubmissionsTable.creatorId, creator.id),
      ),
    )
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
  "/creator/submissions/:submissionId/cover",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => serveCreatorCover(req, res),
);

export default router;
