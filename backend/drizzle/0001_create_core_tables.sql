CREATE TYPE "public"."faction" AS ENUM('ai_haters', 'ai_lovers');--> statement-breakpoint
CREATE TABLE "faction_counts" (
	"faction" "faction" PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "faction_counts_count_non_negative" CHECK ("faction_counts"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"faction" "faction" NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"body" text NOT NULL,
	"user" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_display_name_not_blank" CHECK (length(trim("messages"."display_name")) > 0),
	CONSTRAINT "messages_body_not_blank" CHECK (length(trim("messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_faction_created_at_idx" ON "messages" USING btree ("faction","created_at");--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_email_unique_idx" ON "subscriptions" USING btree ("email");--> statement-breakpoint
INSERT INTO "faction_counts" ("faction", "count")
VALUES ('ai_haters', 0), ('ai_lovers', 0)
ON CONFLICT ("faction") DO NOTHING;
