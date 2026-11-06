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
