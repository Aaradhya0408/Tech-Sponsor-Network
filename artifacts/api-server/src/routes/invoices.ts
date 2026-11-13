import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CreateCreatorInvoiceBody,
  CreateCreatorInvoiceParams,
  CreateCreatorInvoiceResponse,
  GetCreatorInvoiceTermsParams,
  GetCreatorInvoiceTermsResponse,
  ListAdminInvoicesResponse,
  ListCreatorInvoicesResponse,
  MarkAdminInvoicePaidBody,
  MarkAdminInvoicePaidParams,
  MarkAdminInvoicePaidResponse,
  RequestInvoiceUploadUrlBody,
  RequestInvoiceUploadUrlParams,
  RequestInvoiceUploadUrlResponse,
} from "@workspace/api-zod";
import {
  campaignApplicationsTable,
  campaignsTable,
  db,
  invoicesTable,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createStagingUpload,
  deletePrivateObject,
  getPrivateObject,
  isCreatorStagingPath,
  readPrivateObject,
  removeStagingObject,
  storeVerifiedPrivateObject,
  streamPrivateObject,
} from "../lib/private-invoice-storage";
import { requireRole } from "./auth";

const router: IRouter = Router();
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const paidByUsers = alias(usersTable, "invoice_paid_by");
type UserRecord = typeof usersTable.$inferSelect;
type FileKind = "invoice" | "work-photo";

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function userFrom(res: Response): UserRecord {
  return res.locals.authUser as UserRecord;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function detectedImageType(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const gifHeader = bytes.toString("ascii", 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function applicationForInvoice(
  applicationId: string,
  creatorId: string,
) {
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

function invoiceBaseResponse(
  row: {
    invoice: typeof invoicesTable.$inferSelect;
    application: typeof campaignApplicationsTable.$inferSelect;
    campaign: typeof campaignsTable.$inferSelect;
    creator: Pick<UserRecord, "name" | "email">;
  },
) {
  return {
    id: row.invoice.id,
    applicationId: row.invoice.applicationId,
    campaignId: row.campaign.id,
    campaignTitle: row.campaign.title,
    creatorName: row.creator.name,
    creatorEmail: row.creator.email,
    invoiceNumber: row.invoice.invoiceNumber,
    invoiceDate: row.invoice.invoiceDate,
    amount: Number(row.invoice.amount),
    currency: row.invoice.currency,
    description: row.invoice.description,
    workUrl: row.invoice.workUrl,
    hasWorkPhoto: Boolean(row.invoice.workPhotoObjectPath),
    status: row.invoice.status,
    paidDate: row.invoice.paidDate,
    paidNote: row.invoice.paidNote,
    createdAt: row.invoice.createdAt.toISOString(),
  };
}

async function getInvoiceResponse(invoiceId: string) {
  const [row] = await db
    .select({
      invoice: invoicesTable,
      application: campaignApplicationsTable,
      campaign: campaignsTable,
      creator: usersTable,
      paidByName: paidByUsers.name,
    })
    .from(invoicesTable)
    .innerJoin(
      campaignApplicationsTable,
      eq(invoicesTable.applicationId, campaignApplicationsTable.id),
    )
    .innerJoin(
      campaignsTable,
      eq(campaignApplicationsTable.campaignId, campaignsTable.id),
    )
    .innerJoin(usersTable, eq(invoicesTable.creatorId, usersTable.id))
    .leftJoin(paidByUsers, eq(invoicesTable.paidBy, paidByUsers.id))
    .where(eq(invoicesTable.id, invoiceId))
    .limit(1);
  if (!row) return null;
  return {
    ...invoiceBaseResponse(row),
    paidByName: row.paidByName,
    paidRecordedAt: row.invoice.paidRecordedAt?.toISOString() ?? null,
  };
}

router.post(
  "/creator/applications/:applicationId/invoice-upload-url",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = RequestInvoiceUploadUrlParams.safeParse(req.params);
    const body = RequestInvoiceUploadUrlBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Check the selected file and try again.");
      return;
    }

    const creator = userFrom(res);
    const row = await applicationForInvoice(params.data.applicationId, creator.id);
    if (!row || !["ACCEPTED", "WINNER"].includes(row.application.status)) {
      error(res, 403, "An accepted or winning application is required to upload an invoice.");
      return;
    }
    const [existingInvoice] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.applicationId, row.application.id))
      .limit(1);
    if (existingInvoice) {
      error(res, 409, "An invoice has already been submitted for this application.");
      return;
    }
    if (body.data.size > MAX_FILE_SIZE) {
      error(res, 400, "Each file must be no larger than 5 MB.");
      return;
    }
    if (
      (body.data.kind === "INVOICE" && body.data.contentType !== "application/pdf") ||
      (body.data.kind === "WORK_PHOTO" &&
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          body.data.contentType,
        ))
    ) {
      error(
        res,
        400,
        body.data.kind === "INVOICE"
          ? "The invoice file must be a PDF."
          : "The work photo must be a PNG, JPEG, GIF, or WebP image.",
      );
      return;
    }

    try {
      const upload = await createStagingUpload(
        creator.id,
        row.application.id,
        body.data.kind,
      );
      res.json(RequestInvoiceUploadUrlResponse.parse(upload));
    } catch (err) {
      req.log.error({ err }, "Unable to create private invoice upload URL");
      error(res, 503, "Private file storage is temporarily unavailable.");
    }
  },
);

router.get(
  "/creator/applications/:applicationId/invoice-terms",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = GetCreatorInvoiceTermsParams.safeParse(req.params);
    if (!params.success) {
      error(res, 400, "Choose a valid application.");
      return;
    }
    const row = await applicationForInvoice(
      params.data.applicationId,
      userFrom(res).id,
    );
    if (!row || !["ACCEPTED", "WINNER"].includes(row.application.status)) {
      error(res, 403, "An accepted or winning application is required to view invoice terms.");
      return;
    }
    res.json(
      GetCreatorInvoiceTermsResponse.parse({
        rewardAmount: Number(row.campaign.rewardAmount),
        currency: row.campaign.currency,
      }),
    );
  },
);

router.post(
  "/creator/applications/:applicationId/invoice",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const params = CreateCreatorInvoiceParams.safeParse(req.params);
    const body = CreateCreatorInvoiceBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Check the invoice details and required files.");
      return;
    }

    const creator = userFrom(res);
    const row = await applicationForInvoice(params.data.applicationId, creator.id);
    if (!row || !["ACCEPTED", "WINNER"].includes(row.application.status)) {
      error(res, 403, "Only Accepted or Winner applications can submit an invoice.");
      return;
    }
    const [existingInvoice] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.applicationId, row.application.id))
      .limit(1);
    if (existingInvoice) {
      error(res, 409, "An invoice has already been submitted for this application.");
      return;
    }

    const invoiceDate = body.data.invoiceDate;
    const description = body.data.description.trim();
    const invoiceStagingPath = body.data.invoiceObjectPath;
    const photoStagingPath = body.data.workPhotoObjectPath ?? null;
    if (
      !isRealDate(invoiceDate) ||
      !description ||
      description.length > 300 ||
      !isHttpUrl(body.data.workUrl)
    ) {
      error(res, 400, "Enter a valid invoice date, work link, and description.");
      return;
    }
    if (
      !Number.isFinite(body.data.amount) ||
      body.data.amount <= 0 ||
      body.data.amount > Number(row.campaign.rewardAmount)
    ) {
      error(res, 400, "The invoice amount must be greater than zero and no more than the campaign reward.");
      return;
    }
    if (body.data.currency !== row.campaign.currency) {
      error(res, 400, `Invoice currency must match the campaign currency (${row.campaign.currency}).`);
      return;
    }
    if (
      !isCreatorStagingPath(
        invoiceStagingPath,
        creator.id,
        row.application.id,
        "invoice",
      ) ||
      (photoStagingPath &&
        !isCreatorStagingPath(
          photoStagingPath,
          creator.id,
          row.application.id,
          "work-photo",
        ))
    ) {
      error(res, 400, "Upload the invoice and optional photo using the provided form.");
      return;
    }

    let invoiceFileType = "";
    let invoiceBytes: Buffer;
    let photoBytes: Buffer | null = null;
    let photoFileType: string | null = null;
    try {
      const invoiceObject = await readPrivateObject(invoiceStagingPath);
      invoiceBytes = invoiceObject.bytes;
      if (
        invoiceBytes.length < 5 ||
        invoiceBytes.toString("ascii", 0, 5) !== "%PDF-"
      ) {
        await removeStagingObject(invoiceStagingPath);
        error(res, 400, "The invoice upload is not a valid PDF file.");
        return;
      }
      invoiceFileType = "application/pdf";

      if (photoStagingPath) {
        const photoObject = await readPrivateObject(photoStagingPath);
        photoBytes = photoObject.bytes;
        photoFileType = detectedImageType(photoBytes);
        if (!photoFileType) {
          await removeStagingObject(photoStagingPath);
          error(res, 400, "The uploaded work photo is not a supported image file.");
          return;
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Unable to verify private invoice upload");
      error(res, 400, "A required file is missing, unreadable, or larger than 5 MB.");
      return;
    }

    const invoiceId = randomUUID();
    const invoiceObjectPath = await storeVerifiedPrivateObject(
      `invoices/${invoiceId}/invoice`,
      invoiceBytes,
      invoiceFileType,
    );
    let workPhotoObjectPath: string | null = null;
    try {
      if (photoBytes && photoFileType) {
        workPhotoObjectPath = await storeVerifiedPrivateObject(
          `invoices/${invoiceId}/work-photo`,
          photoBytes,
          photoFileType,
        );
      }
      const [invoice] = await db
        .insert(invoicesTable)
        .values({
          id: invoiceId,
          applicationId: row.application.id,
          creatorId: creator.id,
          invoiceNumber: body.data.invoiceNumber.trim(),
          invoiceDate,
          amount: body.data.amount.toFixed(2),
          currency: body.data.currency,
          description,
          workUrl: body.data.workUrl,
          workPhotoObjectPath,
          workPhotoContentType: photoFileType,
          invoiceObjectPath,
          invoiceContentType: invoiceFileType,
          confirmed: body.data.confirmed,
          status: "PENDING",
        })
        .onConflictDoNothing({ target: invoicesTable.applicationId })
        .returning();

      if (!invoice) {
        await deletePrivateObject(invoiceObjectPath);
        if (workPhotoObjectPath) await deletePrivateObject(workPhotoObjectPath);
        error(res, 409, "An invoice has already been submitted for this application.");
        return;
      }

      await Promise.all([
        removeStagingObject(invoiceStagingPath),
        ...(photoStagingPath ? [removeStagingObject(photoStagingPath)] : []),
      ]);
      const responseRow = await db
        .select({
          invoice: invoicesTable,
          application: campaignApplicationsTable,
          campaign: campaignsTable,
          creator: usersTable,
        })
        .from(invoicesTable)
        .innerJoin(
          campaignApplicationsTable,
          eq(invoicesTable.applicationId, campaignApplicationsTable.id),
        )
        .innerJoin(
          campaignsTable,
          eq(campaignApplicationsTable.campaignId, campaignsTable.id),
        )
        .innerJoin(usersTable, eq(invoicesTable.creatorId, usersTable.id))
        .where(eq(invoicesTable.id, invoice.id))
        .limit(1);
      res.status(201).json(
        CreateCreatorInvoiceResponse.parse(
          responseRow[0] ? invoiceBaseResponse(responseRow[0]) : null,
        ),
      );
    } catch (err) {
      await deletePrivateObject(invoiceObjectPath);
      if (workPhotoObjectPath) await deletePrivateObject(workPhotoObjectPath);
      req.log.error({ err }, "Unable to save creator invoice");
      error(res, 500, "The invoice could not be saved. Please try again.");
    }
  },
);

router.get(
  "/creator/invoices",
  requireRole("CREATOR"),
  async (_req, res): Promise<void> => {
    const creator = userFrom(res);
    const rows = await db
      .select({
        invoice: invoicesTable,
        application: campaignApplicationsTable,
        campaign: campaignsTable,
        creator: usersTable,
      })
      .from(invoicesTable)
      .innerJoin(
        campaignApplicationsTable,
        eq(invoicesTable.applicationId, campaignApplicationsTable.id),
      )
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .innerJoin(usersTable, eq(invoicesTable.creatorId, usersTable.id))
      .where(eq(invoicesTable.creatorId, creator.id))
      .orderBy(desc(invoicesTable.createdAt));
    res.json(
      ListCreatorInvoicesResponse.parse({
        invoices: rows.map((invoice) => invoiceBaseResponse(invoice)),
      }),
    );
  },
);

router.get(
  "/admin/invoices",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        invoice: invoicesTable,
        application: campaignApplicationsTable,
        campaign: campaignsTable,
        creator: usersTable,
        paidByName: paidByUsers.name,
      })
      .from(invoicesTable)
      .innerJoin(
        campaignApplicationsTable,
        eq(invoicesTable.applicationId, campaignApplicationsTable.id),
      )
      .innerJoin(
        campaignsTable,
        eq(campaignApplicationsTable.campaignId, campaignsTable.id),
      )
      .innerJoin(usersTable, eq(invoicesTable.creatorId, usersTable.id))
      .leftJoin(paidByUsers, eq(invoicesTable.paidBy, paidByUsers.id))
      .orderBy(desc(invoicesTable.createdAt));
    res.json(
      ListAdminInvoicesResponse.parse({
        invoices: rows.map((row) => ({
          ...invoiceBaseResponse(row),
          paidByName: row.paidByName,
          paidRecordedAt: row.invoice.paidRecordedAt?.toISOString() ?? null,
        })),
      }),
    );
  },
);

router.patch(
  "/admin/invoices/:invoiceId/paid",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = MarkAdminInvoicePaidParams.safeParse(req.params);
    const body = MarkAdminInvoicePaidBody.safeParse(req.body);
    if (!params.success || !body.success || !isRealDate(body.data.paidDate)) {
      error(res, 400, "Enter a valid paid date and optional reference note.");
      return;
    }

    const admin = userFrom(res);
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, params.data.invoiceId))
        .limit(1);
      if (!invoice) {
        return { error: { status: 404, message: "Invoice not found." } };
      }
      if (invoice.status !== "PENDING") {
        return { error: { status: 409, message: "This invoice has already been marked Paid." } };
      }
      const [application] = await tx
        .select()
        .from(campaignApplicationsTable)
        .where(eq(campaignApplicationsTable.id, invoice.applicationId))
        .limit(1);
      if (!application || !["ACCEPTED", "WINNER"].includes(application.status)) {
        return { error: { status: 409, message: "The related application cannot be marked Paid." } };
      }

      const recordedAt = new Date();
      const [updatedInvoice] = await tx
        .update(invoicesTable)
        .set({
          status: "PAID",
          paidDate: body.data.paidDate,
          paidNote: body.data.note?.trim() || null,
          paidBy: admin.id,
          paidRecordedAt: recordedAt,
        })
        .where(
          and(
            eq(invoicesTable.id, invoice.id),
            eq(invoicesTable.status, "PENDING"),
            isNull(invoicesTable.paidBy),
          ),
        )
        .returning();
      if (!updatedInvoice) {
        return { error: { status: 409, message: "This invoice was updated by another administrator." } };
      }

      const [updatedApplication] = await tx
        .update(campaignApplicationsTable)
        .set({
          status: "PAID",
          decidedBy: admin.id,
          decidedAt: recordedAt,
        })
        .where(
          and(
            eq(campaignApplicationsTable.id, application.id),
            inArray(campaignApplicationsTable.status, ["ACCEPTED", "WINNER"]),
          ),
        )
        .returning({ id: campaignApplicationsTable.id });
      if (!updatedApplication) {
        throw new Error("The application status changed while recording invoice payment.");
      }
      return { error: null };
    });

    if (result.error) {
      error(res, result.error.status, result.error.message);
      return;
    }
    const response = await getInvoiceResponse(params.data.invoiceId);
    if (!response) {
      error(res, 404, "Invoice not found.");
      return;
    }
    res.json(MarkAdminInvoicePaidResponse.parse(response));
  },
);

async function serveInvoiceFile(
  req: Request,
  res: Response,
  role: "CREATOR" | "ADMIN",
): Promise<void> {
  const creator = userFrom(res);
  const invoiceId = Array.isArray(req.params.invoiceId)
    ? req.params.invoiceId[0]
    : req.params.invoiceId;
  const fileKindRaw = Array.isArray(req.params.fileKind)
    ? req.params.fileKind[0]
    : req.params.fileKind;
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId) || !["invoice", "work-photo"].includes(fileKindRaw)) {
    error(res, 404, "Invoice file not found.");
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(
      role === "CREATOR"
        ? and(
            eq(invoicesTable.id, invoiceId),
            eq(invoicesTable.creatorId, creator.id),
          )
        : eq(invoicesTable.id, invoiceId),
    )
    .limit(1);
  if (!invoice) {
    error(res, 404, "Invoice file not found.");
    return;
  }

  const fileKind = fileKindRaw as FileKind;
  const objectPath =
    fileKind === "invoice"
      ? invoice.invoiceObjectPath
      : invoice.workPhotoObjectPath;
  const contentType =
    fileKind === "invoice"
      ? invoice.invoiceContentType
      : invoice.workPhotoContentType;
  if (!objectPath || !contentType) {
    error(res, 404, "Invoice file not found.");
    return;
  }
  try {
    const file = getPrivateObject(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      error(res, 404, "Invoice file not found.");
      return;
    }
    await streamPrivateObject(
      file,
      res,
      contentType,
      fileKind === "invoice" ? `${invoice.invoiceNumber}.pdf` : "work-photo",
    );
  } catch (err) {
    req.log.error({ err, invoiceId, fileKind }, "Unable to open private invoice file");
    if (!res.headersSent) error(res, 500, "The invoice file could not be opened.");
  }
}

router.get(
  "/creator/invoices/:invoiceId/files/:fileKind",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => serveInvoiceFile(req, res, "CREATOR"),
);
router.get(
  "/admin/invoices/:invoiceId/files/:fileKind",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => serveInvoiceFile(req, res, "ADMIN"),
);

export default router;
