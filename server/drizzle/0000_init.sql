CREATE TYPE "public"."account_kind" AS ENUM('broker', 'exchange', 'vault', 'wallet', 'bank', 'physical', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('stock', 'etf', 'crypto', 'metal', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."metal" AS ENUM('gold', 'silver', 'platinum', 'palladium');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('yahoo', 'coingecko', 'metal', 'fx', 'manual');--> statement-breakpoint
CREATE TYPE "public"."tx_source" AS ENUM('manual', 'csv', 'api', 'chain');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('buy', 'sell', 'deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'dividend', 'reward', 'fee', 'split');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"provider" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"isin" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"price_source" "price_source" NOT NULL,
	"price_ref" text,
	"unit" text DEFAULT 'unit' NOT NULL,
	"chain" text,
	"contract" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"day" date NOT NULL,
	"per_eur" numeric(38, 10) NOT NULL,
	CONSTRAINT "fx_rates_currency_day_pk" PRIMARY KEY("currency","day")
);
--> statement-breakpoint
CREATE TABLE "metal_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"metal" "metal" NOT NULL,
	"product" text NOT NULL,
	"gross_weight_g" numeric(38, 18) NOT NULL,
	"purity" numeric(10, 6) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"purchase_date" date NOT NULL,
	"purchase_price_eur" numeric(38, 10) NOT NULL,
	"spot_value_at_purchase_eur" numeric(38, 10),
	"dealer" text,
	"notes" text,
	"sold_date" date,
	"sale_price_eur" numeric(38, 10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"day" date PRIMARY KEY NOT NULL,
	"total_eur" numeric(38, 10) NOT NULL,
	"by_class" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"asset_id" integer NOT NULL,
	"day" date NOT NULL,
	"close" numeric(38, 10) NOT NULL,
	"currency" text NOT NULL,
	"close_eur" numeric(38, 10) NOT NULL,
	CONSTRAINT "price_history_asset_id_day_pk" PRIMARY KEY("asset_id","day")
);
--> statement-breakpoint
CREATE TABLE "prices_latest" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"price" numeric(38, 10) NOT NULL,
	"currency" text NOT NULL,
	"price_eur" numeric(38, 10) NOT NULL,
	"change_pct_24h" numeric(20, 8),
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"type" "tx_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"price" numeric(38, 10) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"fx_rate" numeric(38, 10) DEFAULT '1' NOT NULL,
	"fee_eur" numeric(38, 10) DEFAULT '0' NOT NULL,
	"amount" numeric(38, 10) DEFAULT '0' NOT NULL,
	"tax_withheld" numeric(38, 10) DEFAULT '0' NOT NULL,
	"transfer_group" text,
	"source" "tx_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "metal_items" ADD CONSTRAINT "metal_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices_latest" ADD CONSTRAINT "prices_latest_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_price_ref_uq" ON "assets" USING btree ("price_source","price_ref") WHERE "assets"."price_ref" is not null;--> statement-breakpoint
CREATE INDEX "transactions_asset_idx" ON "transactions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_uq" ON "transactions" USING btree ("account_id","source","external_id") WHERE "transactions"."external_id" is not null;