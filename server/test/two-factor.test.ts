import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableTwoFactor } from "../src/auth/twoFactor.js";
import { users } from "../src/db/schema.js";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, totpStep } from "../src/lib/totp.js";
import { createTestApp, TEST_PASSWORD as PASSWORD, type TestApp } from "./helpers.js";

let t: TestApp | undefined;

/** Turns two-step verification on; like a browser, the test goes on with the fresh session cookie. */
async function turnOn(app: TestApp, code: string) {
  const res = await app.api("POST", "/api/auth/2fa/enable", { password: PASSWORD, code });
  if (res.statusCode === 200) app.cookie = `pd_session=${res.cookies.find((c) => c.name === "pd_session")!.value}`;
  return res;
}
afterEach(async () => t?.close());

describe("TOTP", () => {
  // RFC 6238 appendix B (SHA-1): the 8-digit codes end in these 6 digits.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    const at = (s: number) => hotp(base32Decode(secret), totpStep(s * 1000));
    expect(at(59)).toBe("287082");
    expect(at(1111111109)).toBe("081804");
    expect(at(1111111111)).toBe("050471");
    expect(at(1234567890)).toBe("005924");
    expect(at(2000000000)).toBe("279037");
  });

  it("allows one step of clock drift, no more", () => {
    const now = 1_700_000_000_000;
    const code = (offset: number) => hotp(base32Decode(secret), totpStep(now) + offset);
    expect(matchTotp(secret, code(0), now)).toBe(totpStep(now));
    expect(matchTotp(secret, code(-1), now)).toBe(totpStep(now) - 1);
    expect(matchTotp(secret, code(1), now)).toBe(totpStep(now) + 1);
    expect(matchTotp(secret, code(2), now)).toBeNull();
    expect(matchTotp(secret, "12345", now)).toBeNull();
    expect(otpauthUri(secret, "me")).toBe(
      `otpauth://totp/Box3balans%3Ame?secret=${secret}&issuer=Box3balans&algorithm=SHA1&digits=6&period=30`,
    );
  });
});

describe("signing in with a second factor", () => {
  // Codes follow the clock in steps of 30 seconds. Hold it in the middle of one, so a slow run (CI) can't
  // pass into the next step halfway and find a code that was just right too old.
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue((totpStep() * 30 + 15) * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets up with a code, asks for it at sign-in, refuses reuse, and takes recovery codes once", async () => {
    t = await createTestApp();
    const step = totpStep();
    const codeFor = (secret: string, offset = 0) => hotp(base32Decode(secret), step + offset);
    expect((await t.api("GET", "/api/auth/2fa")).json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });

    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    expect(setup.uri).toContain("otpauth://totp/Box3balans%3Ame");
    expect(setup.qrSvg).toMatch(/^<svg/);
    expect((await t.api("POST", "/api/auth/2fa/enable", { password: PASSWORD, code: "000000" })).statusCode).toBe(400);
    const enabled = (await turnOn(t, codeFor(setup.secret, -1))).json();
    expect(enabled.recoveryCodes).toHaveLength(10);
    expect(enabled.recoveryCodes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);

    const login = (code?: string) =>
      t!.app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-requested-with": "portfolio" },
        payload: { username: "me", password: "correct horse battery", code },
      });
    const noCode = await login();
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json()).toMatchObject({ needsCode: true, error: "Enter the code from your authenticator app" });
    expect((await login("123456")).statusCode).toBe(401);
    // The code used to switch it on (step −1) can't be used again; the current one can, once.
    expect((await login(codeFor(setup.secret, -1))).statusCode).toBe(401);
    expect((await login(codeFor(setup.secret))).statusCode).toBe(200);
    expect((await login(codeFor(setup.secret))).statusCode).toBe(401);

    // A recovery code works once, typed any way.
    const recovery = enabled.recoveryCodes[3].toUpperCase().replace("-", " ");
    expect((await login(recovery)).statusCode).toBe(200);
    expect((await login(recovery)).statusCode).toBe(401);
    expect((await t.api("GET", "/api/auth/2fa")).json()).toEqual({ enabled: true, recoveryCodesLeft: 9 });

    // Turning it off takes the password and a code.
    const off = (password: string, code: string) => t!.api("POST", "/api/auth/2fa/disable", { password, code });
    expect((await off("wrong", enabled.recoveryCodes[5])).statusCode).toBe(400);
    expect((await off("correct horse battery", enabled.recoveryCodes[5])).json()).toEqual({
      enabled: false,
      recoveryCodesLeft: 0,
    });
    expect((await login()).statusCode).toBe(200);
  });

  // Security audit of 5 Nov 2026: a left-open session isn't enough to turn it on (and lock the owner
  // out with someone else's phone), and turning it on or off signs out every other session, which
  // may be the one it was turned on against.
  it("takes the password to turn on, and signs out every session when turned on or off", async () => {
    t = await createTestApp();
    const step = totpStep();
    const signIn = async (code?: string) => {
      const res = await t!.api("POST", "/api/auth/login", { username: "me", password: PASSWORD, code });
      expect(res.statusCode, res.body).toBe(200);
      return `pd_session=${res.cookies.find((c) => c.name === "pd_session")!.value}`;
    };
    const as = (cookie: string) =>
      t!.app.inject({ method: "GET", url: "/api/accounts", headers: { cookie } }).then((r) => r.statusCode);
    const other = await signIn();

    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    const code = hotp(base32Decode(setup.secret), step - 1);
    expect((await t.api("POST", "/api/auth/2fa/enable", { code })).statusCode).toBe(400);
    const wrong = await t.api("POST", "/api/auth/2fa/enable", { password: "not it", code });
    expect(wrong.json().error).toBe("That password isn't right");
    // Every session ends, this browser's too (a copy of its cookie may be why); it gets a fresh one.
    const fresh = (res: { cookies: { name: string; value: string }[] }) =>
      `pd_session=${res.cookies.find((c) => c.name === "pd_session")!.value}`;
    const before = t.cookie;
    const on = await t.api("POST", "/api/auth/2fa/enable", { password: PASSWORD, code });
    expect(on.statusCode, on.body).toBe(200);
    expect(await as(other)).toBe(401);
    expect(await as(before)).toBe(401);
    t.cookie = fresh(on);
    expect(await as(t.cookie)).toBe(200);

    const again = await signIn(hotp(base32Decode(setup.secret), step));
    const off = await t.api("POST", "/api/auth/2fa/disable", { password: PASSWORD, code: on.json().recoveryCodes[0] });
    expect(off.statusCode, off.body).toBe(200);
    expect(await as(again)).toBe(401);
    t.cookie = fresh(off);
    expect(await as(t.cookie)).toBe(200);
    // Already off: refused, as before, and nobody is signed out.
    const offAgain = await t.api("POST", "/api/auth/2fa/disable", { password: PASSWORD, code: "123456" });
    expect(offAgain.statusCode).toBe(400);
    expect(await as(t.cookie)).toBe(200);
  });

  it("stops checking codes for a while after five wrong ones", async () => {
    t = await createTestApp();
    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    const enabled = (await turnOn(t, hotp(base32Decode(setup.secret), totpStep() - 1))).json();
    const login = (code: string) =>
      t!.app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-requested-with": "portfolio" },
        payload: { username: "me", password: "correct horse battery", code },
      });
    for (const code of ["111111", "222222", "333333", "444444", "555555"])
      expect((await login(code)).statusCode).toBe(401);
    // Locked: even the right code, or a recovery code elsewhere, isn't checked now.
    const locked = await login(hotp(base32Decode(setup.secret), totpStep()));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe("Too many wrong codes. Try again in 15 minutes.");
    const renew = await t.api("POST", "/api/auth/2fa/recovery-codes", { code: enabled.recoveryCodes[0] });
    expect(renew.statusCode).toBe(429);

    const later = Date.now() + 16 * 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect((await login(hotp(base32Decode(setup.secret), totpStep(later)))).statusCode).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it("explains a key that can't be read after APP_SECRET changed", async () => {
    t = await createTestApp();
    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    await turnOn(t, hotp(base32Decode(setup.secret), totpStep()));
    await t.database.db.update(users).set({ totpSecret: "v1:AAAA" });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-requested-with": "portfolio" },
      payload: { username: "me", password: "correct horse battery", code: "123456" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("disable-2fa");
  });

  it("can be switched off from the command line when the phone is lost", async () => {
    t = await createTestApp();
    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    await turnOn(t, hotp(base32Decode(setup.secret), totpStep()));
    await disableTwoFactor(t.database.db);
    expect((await t.api("GET", "/api/auth/2fa")).json().enabled).toBe(false);
  });
});
