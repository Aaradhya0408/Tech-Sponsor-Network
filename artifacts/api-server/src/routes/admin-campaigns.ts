import { and, desc, eq } from "drizzle-orm";
import {
  CreateAdminCampaignBody,
  CreateAdminCampaignResponse,
  ListAdminCampaignsResponse,
  UpdateAdminCampaignBody,
  UpdateAdminCampaignParams,
  UpdateAdminCampaignResponse,
  UpdateAdminCampaignStatusBody,
  UpdateAdminCampaignStatusParams,
  UpdateAdminCampaignStatusResponse,
} from "@workspace/api-zod";
import {
  CAMPAIGN_STATUSES,
  campaignsTable,
  db,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { requireRole } from "./auth";
import { notifyEligibleCreatorsOfCampaign } from "../lib/email-events";

const router: IRouter = Router();

export const CAMPAIGN_PAYMENT_RULE =
  "Payment is made only if your submission is accepted. If your work is not accepted, no payment will be made.";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const nonCountryRegionCodes = new Set([
  "AC",
  "AN",
  "CP",
  "CQ",
  "CS",
  "DD",
  "DG",
  "EA",
  "EU",
  "EZ",
  "FX",
  "IC",
  "NT",
  "QO",
  "SU",
  "TA",
  "TP",
  "UN",
  "YU",
  "ZR",
  "ZZ",
]);
const campaignInputFields = [
  "title",
  "organizerName",
  "shortDescription",
  "objectives",
  "contentRequirements",
  "rewardAmount",
  "currency",
  "deadline",
  "acceptedPlatforms",
  "allowedCountries",
  "minimumFollowers",
  "niches",
];

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function hasUnexpectedFields(body: unknown, allowedFields: readonly string[]) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  return Object.keys(body).some((key) => !allowedFields.includes(key));
}

function validCountryCode(value: string): boolean {
  if (value === "Any") return true;
  if (!/^[A-Z]{2}$/.test(value) || nonCountryRegionCodes.has(value)) {
    return false;
  }
  if (value.startsWith("X") && value !== "XK") return false;
  const name = regionNames.of(value);
  return Boolean(name && name !== value && name !== "Unknown Region");
}

function validFutureDeadline(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return false;
  }
  return value > new Date().toISOString().slice(0, 10);
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

function validateCampaignInput(
  input: {
    title: string;
    organizerName: string;
    shortDescription: string;
    objectives: string;
    contentRequirements: string;
    rewardAmount: number;
    currency?: string;
    deadline: string;
    acceptedPlatforms: string[];
    allowedCountries: string[];
    minimumFollowers: number;
    niches: string[];
  },
): string | null {
  const requiredText = [
    input.title,
    input.organizerName,
    input.shortDescription,
    input.objectives,
    input.contentRequirements,
  ];
  if (requiredText.some((value) => !value.trim())) {
    return "Campaign text fields cannot be blank.";
  }
  if (!validFutureDeadline(input.deadline)) {
    return "Choose a valid application deadline in the future.";
  }
  if (!Number.isFinite(input.rewardAmount) || input.rewardAmount <= 0) {
    return "Reward amount must be a positive number.";
  }
  if (
    Math.abs(input.rewardAmount * 100 - Math.round(input.rewardAmount * 100)) >
    0.000001
  ) {
    return "Reward amount can have no more than two decimal places.";
  }
  const countries = input.allowedCountries;
  if (
    countries.length === 0 ||
    (countries.includes("Any") && countries.length !== 1) ||
    countries.some((country) => !validCountryCode(country)) ||
    new Set(countries).size !== countries.length
  ) {
    return 'Choose valid allowed countries, or select "Any" by itself.';
  }
  if (
    input.acceptedPlatforms.length === 0 ||
    new Set(input.acceptedPlatforms).size !== input.acceptedPlatforms.length
  ) {
    return "Select at least one unique accepted platform.";
  }
  if (
    input.niches.length === 0 ||
    new Set(input.niches).size !== input.niches.length
  ) {
    return "Select at least one unique niche.";
  }
  return null;
}

function campaignValues(input: {
  title: string;
  organizerName: string;
  shortDescription: string;
  objectives: string;
  contentRequirements: string;
  rewardAmount: number;
  currency?: string;
  deadline: string;
  acceptedPlatforms: (typeof campaignsTable.$inferInsert)["acceptedPlatforms"];
  allowedCountries: string[];
  minimumFollowers: number;
  niches: (typeof campaignsTable.$inferInsert)["niches"];
}) {
  return {
    title: input.title.trim(),
    organizerName: input.organizerName.trim(),
    shortDescription: input.shortDescription.trim(),
    objectives: input.objectives.trim(),
    contentRequirements: input.contentRequirements.trim(),
    rewardAmount: input.rewardAmount.toFixed(2),
    currency: (input.currency ?? "USD").trim().toUpperCase(),
    deadline: input.deadline,
    acceptedPlatforms: input.acceptedPlatforms,
    allowedCountries: input.allowedCountries,
    minimumFollowers: input.minimumFollowers,
    niches: input.niches,
  };
}

router.get(
  "/admin/campaigns",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .orderBy(desc(campaignsTable.createdAt));

    res.json(
      ListAdminCampaignsResponse.parse({
        campaigns: campaigns.map(campaignResponse),
      }),
    );
  },
);

router.post(
  "/admin/campaigns",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    if (hasUnexpectedFields(req.body, campaignInputFields)) {
      error(res, 400, "Campaign fields include an unsupported value.");
      return;
    }
    const parsed = CreateAdminCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.issues }, "Invalid campaign input");
      error(res, 400, "Check the campaign fields and try again.");
      return;
    }
    const validationError = validateCampaignInput(parsed.data);
    if (validationError) {
      error(res, 400, validationError);
      return;
    }

    const [campaign] = await db
      .insert(campaignsTable)
      .values({
        ...campaignValues(parsed.data),
        createdBy: res.locals.authUser.id,
      })
      .returning();

    res
      .status(201)
      .json(CreateAdminCampaignResponse.parse(campaignResponse(campaign)));
  },
);

router.patch(
  "/admin/campaigns/:campaignId",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    if (hasUnexpectedFields(req.body, campaignInputFields)) {
      error(res, 400, "Campaign fields include an unsupported value.");
      return;
    }
    const params = UpdateAdminCampaignParams.safeParse(req.params);
    const parsed = UpdateAdminCampaignBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      req.log.warn(
        {
          params: params.success ? undefined : params.error.issues,
          errors: parsed.success ? undefined : parsed.error.issues,
        },
        "Invalid campaign update",
      );
      error(res, 400, "Check the campaign fields and try again.");
      return;
    }
    const validationError = validateCampaignInput(parsed.data);
    if (validationError) {
      error(res, 400, validationError);
      return;
    }

    const [campaign] = await db
      .update(campaignsTable)
      .set(campaignValues(parsed.data))
      .where(eq(campaignsTable.id, params.data.campaignId))
      .returning();
    if (!campaign) {
      error(res, 404, "Campaign not found.");
      return;
    }

    res.json(UpdateAdminCampaignResponse.parse(campaignResponse(campaign)));
  },
);

router.patch(
  "/admin/campaigns/:campaignId/status",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    if (hasUnexpectedFields(req.body, ["status"])) {
      error(res, 400, "Choose a valid campaign status.");
      return;
    }
    const params = UpdateAdminCampaignStatusParams.safeParse(req.params);
    const parsed = UpdateAdminCampaignStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      error(res, 400, "Choose a valid campaign status.");
      return;
    }

    const [current] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, params.data.campaignId))
      .limit(1);
    if (!current) {
      error(res, 404, "Campaign not found.");
      return;
    }

    const nextStatus = parsed.data.status;
    if (
      !CAMPAIGN_STATUSES.includes(nextStatus) ||
      (current.status === "CLOSED" && nextStatus !== "CLOSED")
    ) {
      error(res, 400, "A closed campaign cannot be reopened.");
      return;
    }
    if (
      nextStatus === "PUBLISHED" &&
      !validFutureDeadline(current.deadline)
    ) {
      error(res, 400, "A campaign with a past deadline cannot be published.");
      return;
    }

    const [campaign] = await db
      .update(campaignsTable)
      .set({ status: nextStatus })
      .where(
        and(
          eq(campaignsTable.id, params.data.campaignId),
          eq(campaignsTable.status, current.status),
        ),
      )
      .returning();
    if (!campaign) {
      error(res, 409, "The campaign changed. Reload and try again.");
      return;
    }

    res.json(
      UpdateAdminCampaignStatusResponse.parse(campaignResponse(campaign)),
    );
    if (nextStatus === "PUBLISHED" && current.status !== "PUBLISHED") {
      void notifyEligibleCreatorsOfCampaign(campaign.id).catch(() => {});
    }
  },
);

export default router;
