import { afterEach, describe, expect, it } from "vitest";
import { githubRepo, isNewer } from "../src/domain/updates.js";
import { createTestApp, defaultRoutes, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
afterEach(async () => t?.close());

describe("update check", () => {
  it("compares release versions; builds without a number can't be compared", () => {
    expect(isNewer("1.3.0", "1.2.9 (abc1234)")).toBe(true);
    expect(isNewer("1.3.0", "1.3.0 (abc1234)")).toBe(false);
    expect(isNewer("1.10.0", "1.9.3")).toBe(true);
    expect(isNewer("1.3.0", "1.3.0-rc.1 (abc)")).toBe(true);
    expect(isNewer("1.3.0-rc.2", "1.3.0")).toBe(false);
    expect(isNewer("1.3.0", "edge (abc1234)")).toBeNull();
    expect(isNewer("1.3.0", "dev")).toBeNull();
    expect(githubRepo("https://github.com/someone/kluishuis")).toBe("someone/kluishuis");
    expect(githubRepo("https://example.com/x/y")).toBeNull();
  });

  it("asks GitHub only when turned on, and forgets the answer when turned off", async () => {
    t = await createTestApp({
      ...defaultRoutes,
      "api.github.com/repos/OWNER/kluishuis/releases/latest": {
        tag_name: "v1.2.0",
        name: "Kluishuis 1.2.0",
        html_url: "https://github.com/OWNER/kluishuis/releases/tag/v1.2.0",
        published_at: "2026-10-01T10:00:00Z",
      },
    });
    const github = () => t!.fetch.calls.filter((u) => u.includes("api.github.com")).length;
    expect((await t.api("GET", "/api/updates")).json()).toMatchObject({ enabled: false, current: "dev" });
    expect((await t.api("POST", "/api/updates/check")).json().enabled).toBe(false);
    expect(github()).toBe(0);

    const on = (await t.api("PUT", "/api/updates", { enabled: true })).json();
    expect(on).toMatchObject({ enabled: true, latest: { version: "1.2.0", name: "Kluishuis 1.2.0" }, newer: null });
    expect(github()).toBe(1);

    const off = (await t.api("PUT", "/api/updates", { enabled: false })).json();
    expect(off).toEqual({ enabled: false, current: "dev" });
  });
});
