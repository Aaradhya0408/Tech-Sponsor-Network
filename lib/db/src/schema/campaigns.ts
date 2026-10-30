import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";
import { CREATOR_NICHES, CREATOR_PLATFORMS } from "./creator-profiles";

export const CAMPAIGN_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;

export const campaignsTable = pgTable(
  "tech_sponsor_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    organizerName: text("organizer_name").notNull(),
    shortDescription: text("short_description").notNull(),
    objectives: text("objectives").notNull(),
    contentRequirements: text("content_requirements").notNull(),
    rewardAmount: numeric("reward_amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    deadline: date("deadline", { mode: "string" }).notNull(),
    acceptedPlatforms: text("accepted_platforms", {
      enum: CREATOR_PLATFORMS,
    })
      .array()
      .notNull(),
    allowedCountries: text("allowed_countries").array().notNull(),
    minimumFollowers: integer("minimum_followers").notNull().default(0),
    niches: text("niches", { enum: CREATOR_NICHES }).array().notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES })
      .notNull()
      .default("DRAFT"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    statusDeadlineIndex: index("tech_sponsor_campaign_status_deadline_idx").on(
      table.status,
      table.deadline,
    ),
    positiveReward: check(
      "tech_sponsor_campaign_reward_positive",
      sql`${table.rewardAmount} > 0`,
    ),
    nonnegativeMinimumFollowers: check(
      "tech_sponsor_campaign_followers_nonnegative",
      sql`${table.minimumFollowers} >= 0`,
    ),
    validCurrency: check(
      "tech_sponsor_campaign_currency_valid",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    countrySelection: check(
      "tech_sponsor_campaign_countries_valid",
      sql`cardinality(${table.allowedCountries}) > 0 AND NOT ('Any' = ANY(${table.allowedCountries}) AND cardinality(${table.allowedCountries}) > 1)`,
    ),
  }),
);

export const insertCampaignSchema = createInsertSchema(campaignsTable);

export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type CampaignRecord = typeof campaignsTable.$inferSelect;
