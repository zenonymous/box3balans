// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPage } from "../test/pages";
import { PhotoStrip } from "./Photos";

/** Photos of a metal item: resized and re-encoded in the browser before upload, then shown and deleted. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sent = (api: ReturnType<typeof showPage>, method: string, url: string) =>
  api.requests.filter((r) => r.method === method && r.url === url).map((r) => r.body);

const pick = (files: File[]) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });

describe("PhotoStrip", () => {
  it("scales a large photo to 1600 px, re-encodes it as JPEG and uploads it", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close }));
    const drawn: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (_b: unknown, ...xywh: number[]) => drawn.push(xywh),
    } as unknown as RenderingContext);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb, type) =>
      cb(new Blob(["jpeg bytes"], { type: type! })),
    );
    const onChange = vi.fn();
    const api = showPage("/metals", "metals", <PhotoStrip itemId={4} photoIds={[]} onChange={onChange} />);
    pick([new File(["raw"], "munt.heic", { type: "image/heic" })]);
    await waitFor(() => expect(sent(api, "POST", "/api/metals/items/4/photos")).toHaveLength(1));
    expect(drawn).toEqual([[0, 0, 1600, 1200]]);
    expect(close).toHaveBeenCalled();
    expect(sent(api, "POST", "/api/metals/items/4/photos")[0]).toEqual({
      mime: "image/jpeg",
      data: btoa("jpeg bytes"),
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("says which file it can't read", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("unsupported")));
    const api = showPage("/metals", "metals", <PhotoStrip itemId={4} photoIds={[]} onChange={() => {}} />);
    pick([new File(["?"], "scan.tiff", { type: "image/tiff" })]);
    expect(await screen.findByText("Kan scan.tiff niet lezen; gebruik een JPEG-, PNG- of WebP-foto")).toBeTruthy();
    expect(sent(api, "POST", "/api/metals/items/4/photos")).toEqual([]);
  });

  it("opens a photo large and deletes it after you confirm; with 8 photos there's no add button", async () => {
    vi.stubGlobal("confirm", () => true);
    const onChange = vi.fn();
    const ids = [11, 12, 13, 14, 15, 16, 17, 18];
    const api = showPage("/metals", "metals", <PhotoStrip itemId={4} photoIds={ids} onChange={onChange} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: "Foto openen" }))[1]!);
    const dialog = screen.getByRole("dialog", { name: "Foto" });
    expect(dialog.querySelector("img")!.getAttribute("src")).toBe("/api/metals/photos/12");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Foto openen" })[1]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Foto verwijderen" }));
    await waitFor(() =>
      expect(api.requests.some((r) => r.method === "DELETE" && r.url === "/api/metals/photos/12")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onChange).toHaveBeenCalled();
  });
});
