CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"summary" text NOT NULL,
	"source_name" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_external_id_not_blank" CHECK (length(trim("news_items"."external_id")) > 0),
	CONSTRAINT "news_items_title_not_blank" CHECK (length(trim("news_items"."title")) > 0),
	CONSTRAINT "news_items_url_not_blank" CHECK (length(trim("news_items"."url")) > 0),
	CONSTRAINT "news_items_summary_not_blank" CHECK (length(trim("news_items"."summary")) > 0),
	CONSTRAINT "news_items_source_name_not_blank" CHECK (length(trim("news_items"."source_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_external_id_unique_idx" ON "news_items" USING btree ("external_id");
--> statement-breakpoint
CREATE INDEX "news_items_published_at_id_idx" ON "news_items" USING btree ("published_at" DESC, "id" DESC);
