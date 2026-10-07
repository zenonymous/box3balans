import { afterEach, describe, expect, it, vi } from "vitest";
import { disableTwoFactor } from "../src/auth/twoFactor.js";
import { users } from "../src/db/schema.js";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, totpStep } from "../src/lib/totp.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
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
  it("sets up with a code, asks for it at sign-in, refuses reuse, and takes recovery codes once", async () => {
    t = await createTestApp();
    // One step for the whole test: codes stay valid (±1 step) even if a 30 s boundary passes.
    const step = totpStep();
    const codeFor = (secret: string, offset = 0) => hotp(base32Decode(secret), step + offset);
    expect((await t.api("GET", "/api/auth/2fa")).json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });

    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    expect(setup.uri).toContain("otpauth://totp/Box3balans%3Ame");
    expect(setup.qrSvg).toMatch(/^<svg/);
    expect((await t.api("POST", "/api/auth/2fa/enable", { code: "000000" })).statusCode).toBe(400);
    const enabled = (await t.api("POST", "/api/auth/2fa/enable", { code: codeFor(setup.secret, -1) })).json();
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

  it("stops checking codes for a while after five wrong ones", async () => {
    t = await createTestApp();
    const setup = (await t.api("POST", "/api/auth/2fa/setup")).json();
    const enabled = (
      await t.api("POST", "/api/auth/2fa/enable", { code: hotp(base32Decode(setup.secret), totpStep() - 1) })
    ).json();
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
    await t.api("POST", "/api/auth/2fa/enable", { code: hotp(base32Decode(setup.secret), totpStep()) });
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
    await t.api("POST", "/api/auth/2fa/enable", { code: hotp(base32Decode(setup.secret), totpStep()) });
    await disableTwoFactor(t.database.db);
    expect((await t.api("GET", "/api/auth/2fa")).json().enabled).toBe(false);
  });
});
