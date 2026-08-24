CREATE TABLE "eval_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_version" integer NOT NULL,
	"system_prompt_snapshot" text NOT NULL,
	"model_snapshot" text NOT NULL,
	"status" text NOT NULL,
	"label" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cases_covered" integer,
	"cases_passed" integer,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"true_positives" integer,
	"false_negatives" integer,
	"false_positives" integer,
	"cost_usd" double precision,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "not_run_reason" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "expected_count" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "actual_count" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "kept_count" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "dropped_count" integer;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_batches_agent_started_idx" ON "eval_batches" USING btree ("agent_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "eval_batches_workspace_started_idx" ON "eval_batches" USING btree ("workspace_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("workspace_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "eval_cases_source_finding_idx" ON "eval_cases" USING btree ("source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_cases_owner_name_idx" ON "eval_cases" USING btree ("owner_id","name","id");--> statement-breakpoint
CREATE INDEX "eval_runs_batch_idx" ON "eval_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "eval_runs_case_ran_idx" ON "eval_runs" USING btree ("case_id","ran_at" DESC NULLS LAST);