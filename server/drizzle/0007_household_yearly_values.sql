CREATE TYPE "public"."account_owner" AS ENUM('self', 'partner', 'joint', 'child');--> statement-breakpoint
CREATE TYPE "public"."account_tracking" AS ENUM('transactions', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."child_custody" AS ENUM('together', 'self', 'self_half', 'partner');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('self', 'partner', 'child');--> statement-breakpoint
ALTER TYPE "public"."account_kind" ADD VALUE 'property';--> statement-breakpoint
ALTER TYPE "public"."account_kind" ADD VALUE 'receivable';--> statement-breakpoint
ALTER TYPE "public"."account_kind" ADD VALUE 'debt';--> statement-breakpoint
ALTER TYPE "public"."account_kind" ADD VALUE 'insurance';--> statement-breakpoint
CREATE TABLE "account_years" (
	"account_id" integer NOT NULL,
	"year" integer NOT NULL,
	"value_eur" numeric(38, 10),
	"in_eur" numeric(38, 10) DEFAULT '0' NOT NULL,
	"out_eur" numeric(38, 10) DEFAULT '0' NOT NULL,
	"income_eur" numeric(38, 10) DEFAULT '0' NOT NULL,
	"costs_eur" numeric(38, 10) DEFAULT '0' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_years_account_id_year_pk" PRIMARY KEY("account_id","year")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "person_role" NOT NULL,
	"birth_date" date,
	"custody" "child_custody" DEFAULT 'together' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "tracking" "account_tracking" DEFAULT 'transactions' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner" "account_owner" DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner_child_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "joint_self_pct" numeric(5, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "foreign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_years" ADD CONSTRAINT "account_years_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persons_one_self_partner_uq" ON "persons" USING btree ("role") WHERE "persons"."role" in ('self', 'partner');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_child_id_persons_id_fk" FOREIGN KEY ("owner_child_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;