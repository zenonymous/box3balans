CREATE TABLE "metal_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metal_photos" ADD CONSTRAINT "metal_photos_item_id_metal_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."metal_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metal_photos_item_idx" ON "metal_photos" USING btree ("item_id");