import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const factionValues = ["ai_haters", "ai_lovers"] as const;
export const factionEnum = pgEnum("faction", factionValues);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    faction: factionEnum("faction").notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    body: text("body").notNull(),
    user: text("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    factionCreatedAtIdx: index("messages_faction_created_at_idx").on(
      table.faction,
      table.createdAt,
    ),
    createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
    displayNameNotBlank: check(
      "messages_display_name_not_blank",
      sql`length(trim(${table.displayName})) > 0`,
    ),
    bodyNotBlank: check(
      "messages_body_not_blank",
      sql`length(trim(${table.body})) > 0`,
    ),
  }),
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex("subscriptions_email_unique_idx").on(table.email),
  }),
);

export const factionCounts = pgTable(
  "faction_counts",
  {
    faction: factionEnum("faction").primaryKey(),
    count: integer("count").notNull().default(0),
  },
  (table) => ({
    countNonNegative: check(
      "faction_counts_count_non_negative",
      sql`${table.count} >= 0`,
    ),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type FactionCount = typeof factionCounts.$inferSelect;
