import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { usersTable } from "./auth";

export const CAMPAIGN_APPLICATION_STATUSES = [
  "UNDER_REVIEW",
  "ACCEPTED",
  "NOT_SELECTED",
  "WINNER",
  "PAID",
] as const;

export const CAMPAIGN_APPLICATION_REJECTION_REASONS = [
  "FOLLOWERS_BELOW_REQUIREMENT",
  "NICHE_NOT_A_FIT",
  "PROFILE_INCOMPLETE",
  "APPLICATION_MESSAGE_TOO_WEAK",
  "TOO_MANY_APPLICANTS",
  "OTHER",
] as const;

export const campaignApplicationsTable = pgTable(
  "tech_sponsor_campaign_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    personalMessage: text("personal_message").notNull(),
    paymentRuleAcknowledged: boolean("payment_rule_acknowledged")
      .notNull()
      .default(false),
    status: text("status", {
      enum: CAMPAIGN_APPLICATION_STATUSES,
    })
      .notNull()
      .default("UNDER_REVIEW"),
    decisionReason: text("decision_reason", {
      enum: CAMPAIGN_APPLICATION_REJECTION_REASONS,
    }),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => usersTable.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueCreatorCampaign: unique(
      "tech_sponsor_campaign_application_creator_campaign_unique",
    ).on(table.creatorId, table.campaignId),
    creatorCreatedIndex: index(
      "tech_sponsor_campaign_application_creator_created_idx",
    ).on(table.creatorId, table.createdAt),
    campaignCreatedIndex: index(
      "tech_sponsor_campaign_application_campaign_created_idx",
    ).on(table.campaignId, table.createdAt),
    validMessageLength: check(
      "tech_sponsor_campaign_application_message_length",
      sql`char_length(${table.personalMessage}) >= 20 AND char_length(${table.personalMessage}) <= 1000`,
    ),
    paymentRuleAccepted: check(
      "tech_sponsor_campaign_application_payment_rule_acknowledged",
      sql`${table.paymentRuleAcknowledged} = true`,
    ),
    decisionReasonMatchesStatus: check(
      "tech_sponsor_campaign_application_reason_matches_status",
      sql`(${table.status} = 'NOT_SELECTED' AND ${table.decisionReason} IS NOT NULL) OR (${table.status} <> 'NOT_SELECTED' AND ${table.decisionReason} IS NULL)`,
    ),
    otherDecisionHasNote: check(
      "tech_sponsor_campaign_application_other_reason_has_note",
      sql`${table.decisionReason} <> 'OTHER' OR length(trim(coalesce(${table.decisionNote}, ''))) > 0`,
    ),
    decisionMetadataMatchesStatus: check(
      "tech_sponsor_campaign_application_decision_metadata_matches_status",
      sql`(${table.status} = 'UNDER_REVIEW' AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL) OR (${table.status} <> 'UNDER_REVIEW' AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
  }),
);

export const insertCampaignApplicationSchema = createInsertSchema(
  campaignApplicationsTable,
);

export type InsertCampaignApplication = z.infer<
  typeof insertCampaignApplicationSchema
>;
export type CampaignApplicationRecord =
  typeof campaignApplicationsTable.$inferSelect;
