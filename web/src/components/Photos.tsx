import { useState } from "react";
import { del, post } from "../api";
import { Alert, cx } from "./ui";
import { t } from "../i18n";

const MAX_SIDE = 1600;

/**
 * Downscales a photo to at most 1600 px and re-encodes it as JPEG. Re-encoding also drops the
 * metadata (camera, GPS location) a phone puts in its photos.
 */
async function prepare(file: File): Promise<{ mime: string; data: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(t("Can't read {name}; use a JPEG, PNG or WebP photo", { name: file.name }));
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error(t("Couldn't process the photo"));
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error(t("Couldn't read the photo")));
    fr.readAsDataURL(blob);
  });
  return { mime: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export const photoUrl = (id: number) => `/api/metals/photos/${id}`;

/** Thumbnails of an item's photos with add and remove. */
export function PhotoStrip({
  itemId,
  photoIds,
  onChange,
}: {
  itemId: number;
  photoIds: number[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number | null>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(undefined);
    try {
      for (const f of [...files]) await post(`/api/metals/items/${itemId}/photos`, await prepare(f));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("Delete this photo?"))) return;
    await del(`/api/metals/photos/${id}`);
    setOpen(null);
    onChange();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photoIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(id)}
            className="size-20 overflow-hidden rounded-lg border border-line"
            aria-label={t("Open photo")}
          >
            <img src={photoUrl(id)} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
        {photoIds.length < 8 && (
          <label
            className={cx(
              "flex size-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-2 hover:bg-surface-2",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <span className="text-lg leading-none">+</span>
            {busy ? t("Adding…") : t("Photo")}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{t("Up to 8 photos. They're resized, and location data is removed.")}</p>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {open != null && (
        <div
          role="dialog"
          aria-label={t("Photo")}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={() => setOpen(null)}
        >
          <img src={photoUrl(open)} alt="" className="max-h-[80dvh] max-w-full rounded-lg object-contain" />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => void remove(open)}
              className="rounded-lg bg-surface px-3 py-1.5 text-sm text-loss"
            >
              {t("Delete photo")}
            </button>
            <button type="button" onClick={() => setOpen(null)} className="rounded-lg bg-surface px-3 py-1.5 text-sm">
              {t("Close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
