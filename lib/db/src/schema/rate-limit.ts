import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const rateLimitBucketsTable = pgTable(
  "tech_sponsor_rate_limit_buckets",
  {
    bucketKey: text("bucket_key").primaryKey(),
    attempts: integer("attempts").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresAtIndex: index("tech_sponsor_rate_limit_expiry_idx").on(
      table.expiresAt,
    ),
    positiveAttempts: check(
      "tech_sponsor_rate_limit_attempts_positive",
      sql`${table.attempts} > 0`,
    ),
  }),
);
