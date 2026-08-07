CREATE TABLE "convention_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"commit_sha" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eligible_files" integer DEFAULT 0 NOT NULL,
	"sampled_files" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"dropped_unverified" integer DEFAULT 0 NOT NULL,
	"dropped_low_adherence" integer DEFAULT 0 NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "scan_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rationale" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "matcher" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "adherence_conforming" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "adherence_violating" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_scans_repo_idx" ON "convention_scans" USING btree ("repo_id","started_at");--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_scan_id_convention_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conventions_repo_status_idx" ON "conventions" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "conventions_scan_idx" ON "conventions" USING btree ("scan_id");