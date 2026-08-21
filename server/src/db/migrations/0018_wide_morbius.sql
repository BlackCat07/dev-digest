ALTER TABLE "onboarding" ADD COLUMN "state" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "status" text DEFAULT 'degraded' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "indexed_sha" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "files_indexed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "files_skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "error" text;