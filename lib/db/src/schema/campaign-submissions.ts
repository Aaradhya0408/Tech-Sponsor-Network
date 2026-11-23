import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { campaignApplicationsTable } from "./campaign-applications";
import { usersTable } from "./auth";

export const CAMPAIGN_SUBMISSION_STATUSES = [
  "SUBMITTED",
  "SUBMISSION_ACCEPTED",
  "SUBMISSION_REJECTED",
] as const;

export const campaignSubmissionsTable = pgTable(
  "tech_sponsor_campaign_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => campaignApplicationsTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    title: text("title").notNull(),
    projectUrl: text("project_url").notNull(),
    coverObjectPath: text("cover_object_path"),
    coverContentType: text("cover_content_type"),
    description: text("description").notNull(),
    status: text("status", { enum: CAMPAIGN_SUBMISSION_STATUSES })
      .notNull()
      .default("SUBMITTED"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: uuid("reviewed_by").references(() => usersTable.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    oneRowPerAttempt: unique(
      "tech_sponsor_campaign_submission_application_attempt_unique",
    ).on(table.applicationId, table.attempt),
    applicationAttemptIndex: index(
      "tech_sponsor_campaign_submission_application_attempt_idx",
    ).on(table.applicationId, table.attempt),
    statusSubmittedIndex: index(
      "tech_sponsor_campaign_submission_status_submitted_idx",
    ).on(table.status, table.submittedAt),
    creatorSubmittedIndex: index(
      "tech_sponsor_campaign_submission_creator_submitted_idx",
    ).on(table.creatorId, table.submittedAt),
    validAttempt: check(
      "tech_sponsor_campaign_submission_attempt_range",
      sql`${table.attempt} IN (1, 2)`,
    ),
    validTitle: check(
      "tech_sponsor_campaign_submission_title_length",
      sql`char_length(trim(${table.title})) BETWEEN 1 AND 160`,
    ),
    validProjectUrl: check(
      "tech_sponsor_campaign_submission_https_url",
      sql`${table.projectUrl} ~ '^https://'`,
    ),
    validDescription: check(
      "tech_sponsor_campaign_submission_description_length",
      sql`char_length(trim(${table.description})) BETWEEN 1 AND 500`,
    ),
    coverMetadataMatches: check(
      "tech_sponsor_campaign_submission_cover_metadata_matches",
      sql`(${table.coverObjectPath} IS NULL AND ${table.coverContentType} IS NULL) OR (${table.coverObjectPath} IS NOT NULL AND ${table.coverContentType} IN ('image/jpeg', 'image/png'))`,
    ),
    reviewMetadataMatches: check(
      "tech_sponsor_campaign_submission_review_metadata_matches",
      sql`(${table.status} = 'SUBMITTED' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.rejectionReason} IS NULL) OR (${table.status} = 'SUBMISSION_ACCEPTED' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.rejectionReason} IS NULL) OR (${table.status} = 'SUBMISSION_REJECTED' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND length(trim(coalesce(${table.rejectionReason}, ''))) > 0)`,
    ),
  }),
);

export const insertCampaignSubmissionSchema = createInsertSchema(
  campaignSubmissionsTable,
);
export type InsertCampaignSubmission = z.infer<
  typeof insertCampaignSubmissionSchema
>;
export type CampaignSubmissionRecord =
  typeof campaignSubmissionsTable.$inferSelect;
