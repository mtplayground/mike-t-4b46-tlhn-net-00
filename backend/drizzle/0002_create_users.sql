CREATE TABLE "users" (
	"sub" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean,
	"name" text,
	"picture_url" text,
	"faction" "faction" NOT NULL,
	"pseudonym" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_sub_not_blank" CHECK (length(trim("users"."sub")) > 0),
	CONSTRAINT "users_pseudonym_not_blank" CHECK (length(trim("users"."pseudonym")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_pseudonym_unique_idx" ON "users" USING btree ("pseudonym");--> statement-breakpoint
CREATE INDEX "users_faction_idx" ON "users" USING btree ("faction");
