CREATE TABLE "token_contracts" (
	"chain" text NOT NULL,
	"contract" text NOT NULL,
	"asset_id" integer,
	"symbol" text,
	"name" text,
	"listed" boolean NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_contracts_chain_contract_pk" PRIMARY KEY("chain","contract")
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"script_type" text,
	"include_unlisted" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" jsonb,
	"last_sync_at" timestamp with time zone,
	"last_status" text,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_contracts" ADD CONSTRAINT "token_contracts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_uq" ON "wallet_addresses" USING btree ("account_id","chain","address");