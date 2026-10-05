CREATE TYPE "public"."integration_provider" AS ENUM('bitvavo', 'kraken', 'coinbase', 'ibkr');--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"credentials" text NOT NULL,
	"key_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" jsonb,
	"last_sync_at" timestamp with time zone,
	"last_status" text,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "sync_ignored" (
	"account_id" integer NOT NULL,
	"source" "tx_source" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_ignored_account_id_source_external_id_pk" PRIMARY KEY("account_id","source","external_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "settle_asset_id" integer;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_ignored" ADD CONSTRAINT "sync_ignored_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settle_asset_id_assets_id_fk" FOREIGN KEY ("settle_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;