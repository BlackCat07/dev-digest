ALTER TABLE "ci_runs" ADD COLUMN "workflow_run_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "blockers" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_s" double precision;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_uq" ON "ci_installations" USING btree ("agent_id","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_run_uq" ON "ci_runs" USING btree ("ci_installation_id","workflow_run_id");--> statement-breakpoint
CREATE INDEX "ci_runs_installation_idx" ON "ci_runs" USING btree ("ci_installation_id");--> statement-breakpoint
CREATE INDEX "ci_runs_ran_at_idx" ON "ci_runs" USING btree ("ran_at" DESC NULLS LAST,"id" DESC NULLS LAST);