ALTER TABLE "pr_brief" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "state" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "status" text DEFAULT 'degraded' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "error" text;