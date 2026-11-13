import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { campaignApplicationsTable } from "./campaign-applications";
import { usersTable } from "./auth";

export const INVOICE_STATUSES = ["PENDING", "PAID"] as const;

export const invoicesTable = pgTable(
  "tech_sponsor_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => campaignApplicationsTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    workUrl: text("work_url").notNull(),
    workPhotoObjectPath: text("work_photo_object_path"),
    workPhotoContentType: text("work_photo_content_type"),
    invoiceObjectPath: text("invoice_object_path").notNull(),
    invoiceContentType: text("invoice_content_type").notNull().default("application/pdf"),
    confirmed: boolean("confirmed").notNull().default(true),
    status: text("status", { enum: INVOICE_STATUSES })
      .notNull()
      .default("PENDING"),
    paidDate: date("paid_date", { mode: "string" }),
    paidNote: text("paid_note"),
    paidBy: uuid("paid_by").references(() => usersTable.id, {
      onDelete: "restrict",
    }),
    paidRecordedAt: timestamp("paid_recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    oneInvoicePerApplication: unique(
      "tech_sponsor_invoice_application_unique",
    ).on(table.applicationId),
    creatorCreatedIndex: index("tech_sponsor_invoice_creator_created_idx").on(
      table.creatorId,
      table.createdAt,
    ),
    statusCreatedIndex: index("tech_sponsor_invoice_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    positiveAmount: check(
      "tech_sponsor_invoice_amount_positive",
      sql`${table.amount} > 0`,
    ),
    validCurrency: check(
      "tech_sponsor_invoice_currency_valid",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    validDescription: check(
      "tech_sponsor_invoice_description_length",
      sql`char_length(trim(${table.description})) BETWEEN 1 AND 300`,
    ),
    confirmedByCreator: check(
      "tech_sponsor_invoice_confirmed",
      sql`${table.confirmed} = true`,
    ),
    paidMetadataMatchesStatus: check(
      "tech_sponsor_invoice_paid_metadata_matches_status",
      sql`(${table.status} = 'PENDING' AND ${table.paidDate} IS NULL AND ${table.paidBy} IS NULL AND ${table.paidRecordedAt} IS NULL) OR (${table.status} = 'PAID' AND ${table.paidDate} IS NOT NULL AND ${table.paidBy} IS NOT NULL AND ${table.paidRecordedAt} IS NOT NULL)`,
    ),
  }),
);

export const insertInvoiceSchema = createInsertSchema(invoicesTable);
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceRecord = typeof invoicesTable.$inferSelect;
