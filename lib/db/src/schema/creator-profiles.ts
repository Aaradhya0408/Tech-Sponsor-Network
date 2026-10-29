import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const CREATOR_NICHES = [
  "Technology",
  "AI",
  "Developer tools",
  "Gaming",
  "Education",
  "Business",
  "Other",
] as const;

export const CREATOR_PLATFORMS = [
  "Instagram",
  "YouTube",
  "LinkedIn",
  "X",
  "TikTok",
  "GitHub",
] as const;

export const CREATOR_APPROVAL_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
] as const;

export const creatorProfilesTable = pgTable("tech_sponsor_creator_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  country: text("country").notNull().default(""),
  niche: text("niche", { enum: CREATOR_NICHES }).notNull().default("Technology"),
  proofCode: text("proof_code").notNull().unique(),
  approvalStatus: text("approval_status", {
    enum: CREATOR_APPROVAL_STATUSES,
  })
    .notNull()
    .default("PENDING_APPROVAL"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const creatorPlatformsTable = pgTable(
  "tech_sponsor_creator_platforms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: CREATOR_PLATFORMS }).notNull(),
    url: text("url").notNull(),
    followers: integer("followers").notNull(),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uniqueUserPlatform: unique("tech_sponsor_creator_platform_unique").on(
      table.userId,
      table.platform,
    ),
    nonnegativeFollowers: check(
      "tech_sponsor_creator_followers_nonnegative",
      sql`${table.followers} >= 0`,
    ),
  }),
);

export const insertCreatorProfileSchema = createInsertSchema(creatorProfilesTable);
export const insertCreatorPlatformSchema = createInsertSchema(creatorPlatformsTable);

export type InsertCreatorProfile = z.infer<typeof insertCreatorProfileSchema>;
export type CreatorProfileRecord = typeof creatorProfilesTable.$inferSelect;
export type InsertCreatorPlatform = z.infer<typeof insertCreatorPlatformSchema>;
export type CreatorPlatformRecord = typeof creatorPlatformsTable.$inferSelect;
