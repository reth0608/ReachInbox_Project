CREATE TYPE "public"."email_job_status" AS ENUM('scheduled', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"smtp_user" text NOT NULL,
	"smtp_pass" text NOT NULL,
	"smtp_host" text DEFAULT 'smtp.ethereal.email' NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"delay_between_emails_ms" integer NOT NULL,
	"hourly_limit" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"status" "email_job_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_time" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"bullmq_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_jobs_campaign_id_idx" ON "email_jobs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_jobs_status_scheduled_time_idx" ON "email_jobs" USING btree ("status","scheduled_time");--> statement-breakpoint
CREATE INDEX "email_jobs_status_updated_at_idx" ON "email_jobs" USING btree ("status","updated_at");