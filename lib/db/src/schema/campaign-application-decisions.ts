import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";
import {
  CAMPAIGN_APPLICATION_REJECTION_REASONS,
  CAMPAIGN_APPLICATION_STATUSES,
  campaignApplicationsTable,
} from "./campaign-applications";

export const campaignApplicationDecisionsTable = pgTable(
  "tech_sponsor_campaign_application_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => campaignApplicationsTable.id, { onDelete: "cascade" }),
    previousStatus: text("previous_status", {
      enum: CAMPAIGN_APPLICATION_STATUSES,
    }).notNull(),
    status: text("status", {
      enum: CAMPAIGN_APPLICATION_STATUSES,
    }).notNull(),
    rejectionReason: text("rejection_reason", {
      enum: CAMPAIGN_APPLICATION_REJECTION_REASONS,
    }),
    decisionNote: text("decision_note"),
    changeReason: text("change_reason"),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    applicationDecisionIndex: index(
      "tech_sponsor_campaign_application_decisions_application_idx",
    ).on(table.applicationId, table.decidedAt),
    rejectionReasonMatchesStatus: check(
      "tech_sponsor_campaign_application_decision_reason_matches_status",
      sql`(${table.status} = 'NOT_SELECTED' AND ${table.rejectionReason} IS NOT NULL) OR (${table.status} <> 'NOT_SELECTED' AND ${table.rejectionReason} IS NULL)`,
    ),
    otherReasonHasNote: check(
      "tech_sponsor_campaign_application_decision_other_reason_has_note",
      sql`${table.rejectionReason} <> 'OTHER' OR length(trim(coalesce(${table.decisionNote}, ''))) > 0`,
    ),
    changedDecisionHasReason: check(
      "tech_sponsor_campaign_application_decision_change_has_reason",
      sql`${table.previousStatus} = 'UNDER_REVIEW' OR length(trim(coalesce(${table.changeReason}, ''))) > 0`,
    ),
  }),
);

export const insertCampaignApplicationDecisionSchema = createInsertSchema(
  campaignApplicationDecisionsTable,
);

export type InsertCampaignApplicationDecision = z.infer<
  typeof insertCampaignApplicationDecisionSchema
>;
export type CampaignApplicationDecisionRecord =
  typeof campaignApplicationDecisionsTable.$inferSelect;
