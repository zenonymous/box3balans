import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { lockPglite } from "../src/db/client.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kh-config-"));
const SECRET = "s".repeat(40);

describe("secrets from files (Docker creates them on first start)", () => {
  it("reads APP_SECRET and the database password from their files", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "app-secret"), `${SECRET}\n`);
    fs.writeFileSync(path.join(dir, "db-password"), "p@ss w$rd");
    const c = loadConfig({
      APP_SECRET_FILE: path.join(dir, "app-secret"),
      PGPASSWORD_FILE: path.join(dir, "db-password"),
    });
    expect(c.APP_SECRET).toBe(SECRET);
    expect(c.PGPASSWORD).toBe("p@ss w$rd");
  });

  it("prefers values set directly, e.g. in .env", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "app-secret"), SECRET);
    const c = loadConfig({ APP_SECRET: "e".repeat(40), APP_SECRET_FILE: path.join(dir, "app-secret") });
    expect(c.APP_SECRET).toBe("e".repeat(40));
  });

  it("explains a missing or short APP_SECRET", () => {
    expect(() => loadConfig({ APP_SECRET_FILE: "/nonexistent/app-secret" })).toThrow(/APP_SECRET: not set/);
    expect(() => loadConfig({ APP_SECRET: "short" })).toThrow(/at least 32 characters/);
  });
});

describe("PGlite lock (one process per database folder)", () => {
  const lockFile = (dir: string, content: object) => fs.writeFileSync(`${dir}.lock`, JSON.stringify(content));

  it("lets the CLI in when nothing holds the folder, and releases on close", () => {
    const dir = path.join(tmp(), "pglite");
    const unlock = lockPglite(dir, "check");
    expect(fs.existsSync(`${dir}.lock`)).toBe(true);
    unlock();
    expect(fs.existsSync(`${dir}.lock`)).toBe(false);
  });

  it("keeps the CLI out while the server holds it", () => {
    const dir = path.join(tmp(), "pglite");
    // A live process on this machine (our parent) holds it.
    lockFile(dir, { host: os.hostname(), pid: process.ppid });
    expect(() => lockPglite(dir, "check")).toThrow(/in use by the running Box3balans/);
    // Another container: can't tell whether it runs, so stay out too.
    lockFile(dir, { host: "other-container", pid: 7 });
    expect(() => lockPglite(dir, "check")).toThrow(/delete .*pglite\.lock/);
  });

  it("ignores a lock left by a crash, and the server always takes over", () => {
    const dir = path.join(tmp(), "pglite");
    lockFile(dir, { host: os.hostname(), pid: 999_999 });
    lockPglite(dir, "check")();
    lockFile(dir, { host: "old-container", pid: 1 });
    const unlock = lockPglite(dir, "take");
    expect(JSON.parse(fs.readFileSync(`${dir}.lock`, "utf8"))).toMatchObject({ pid: process.pid });
    unlock();
  });
});
