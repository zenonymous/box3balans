// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncCounts } from "./SyncCounts";

/** The counts of a connection's or wallet's last sync, shared by both pages. */
afterEach(cleanup);

const show = (r: Parameters<typeof SyncCounts>[0]["result"]) =>
  render(
    <dl>
      <SyncCounts result={r} />
    </dl>,
  );

describe("SyncCounts", () => {
  it("shows what an exchange sync imported, linked, valued and swapped", () => {
    show({ fetched: 30, inserted: 4, transfersMatched: 2, revalued: 3, swaps: 1 });
    expect(screen.getByText("Geïmporteerd").nextElementSibling!.textContent).toBe("4 nieuw van 30");
    expect(screen.getByText("Overboekingen gekoppeld").nextElementSibling!.textContent).toBe("2");
    expect(screen.getByText("Alsnog gewaardeerd").nextElementSibling!.textContent).toBe("3");
    expect(screen.getByText("Omwisselingen geboekt").nextElementSibling!.textContent).toBe("1");
  });

  it("leaves out what didn't happen; a wallet has no coin swaps", () => {
    show({ fetched: 12, inserted: 0, transfersMatched: 0 });
    expect(screen.getByText("Geïmporteerd").nextElementSibling!.textContent).toBe("0 nieuw van 12");
    expect(screen.queryByText("Alsnog gewaardeerd")).toBeNull();
    expect(screen.queryByText("Omwisselingen geboekt")).toBeNull();
  });
});
