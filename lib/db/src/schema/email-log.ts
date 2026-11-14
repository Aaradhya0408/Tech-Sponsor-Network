import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const EMAIL_LOG_STATUSES = ["sent", "failed", "skipped"] as const;

export const emailLogTable = pgTable(
  "email_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    toEmail: text("to_email").notNull(),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    status: text("status", { enum: EMAIL_LOG_STATUSES }).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdAtIndex: index("email_log_created_at_idx").on(table.createdAt),
    recipientCreatedAtIndex: index("email_log_recipient_created_at_idx").on(
      table.toEmail,
      table.createdAt,
    ),
    validStatus: check(
      "email_log_valid_status",
      sql`${table.status} IN ('sent', 'failed', 'skipped')`,
    ),
  }),
);
