import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { BITCOIN, addressFor, isValidAddress, parseExtendedKey, utxoAdapter } from "../src/wallets/bitcoin.js";

// The well-known BIP39 test mnemonic; addresses below are the published BIP44/49/84/86 vectors.
const seed = mnemonicToSeedSync(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
);
const root = HDKey.fromMasterSeed(seed);
const b58c = createBase58check(sha256);
const withVersion = (xpub: string, hex: string) =>
  b58c.encode(concatBytes(hexToBytes(hex), b58c.decode(xpub).slice(4)));
const account = (purpose: number) => root.derive(`m/${purpose}'/0'/0'`).publicExtendedKey;

describe("Bitcoin extended keys", () => {
  it("matches the BIP84 zpub test vector", () => {
    const zpub = withVersion(account(84), "04b24746");
    expect(zpub).toBe(
      "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
    );
    const { hd, impliedType } = parseExtendedKey(BITCOIN, zpub);
    expect(impliedType).toBe("p2wpkh");
    expect(addressFor(BITCOIN, hd.deriveChild(0).deriveChild(0).publicKey!, "p2wpkh")).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(addressFor(BITCOIN, hd.deriveChild(0).deriveChild(1).publicKey!, "p2wpkh")).toBe(
      "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
    );
    expect(addressFor(BITCOIN, hd.deriveChild(1).deriveChild(0).publicKey!, "p2wpkh")).toBe(
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
    );
  });

  it("derives BIP44 legacy, BIP49 nested segwit and BIP86 taproot addresses", () => {
    const legacy = parseExtendedKey(BITCOIN, account(44));
    expect(legacy.impliedType).toBe("p2pkh");
    expect(addressFor(BITCOIN, legacy.hd.deriveChild(0).deriveChild(0).publicKey!, "p2pkh")).toBe(
      "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
    );

    const nested = parseExtendedKey(BITCOIN, withVersion(account(49), "049d7cb2"));
    expect(nested.impliedType).toBe("p2sh-p2wpkh");
    expect(addressFor(BITCOIN, nested.hd.deriveChild(0).deriveChild(0).publicKey!, "p2sh-p2wpkh")).toBe(
      "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
    );

    const taproot = parseExtendedKey(BITCOIN, account(86));
    expect(addressFor(BITCOIN, taproot.hd.deriveChild(0).deriveChild(0).publicKey!, "p2tr")).toBe(
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    );
  });

  it("rejects private keys and garbage", () => {
    expect(() => parseExtendedKey(BITCOIN, root.derive("m/84'/0'/0'").privateExtendedKey)).toThrow();
    expect(() => parseExtendedKey(BITCOIN, "xpub123")).toThrow();
  });

  it("validates addresses of every type", () => {
    for (const a of [
      "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
      "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    ]) {
      expect(isValidAddress(BITCOIN, a)).toBe(true);
    }
    expect(isValidAddress(BITCOIN, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv")).toBe(false); // bad checksum
    expect(isValidAddress(BITCOIN, "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabB")).toBe(false);
    expect(isValidAddress(BITCOIN, "ltc1qg82tjrp5dctqgfmw5s7pa35t9tmrr2p0l6sxyr")).toBe(false);
  });

  it("normalises bech32 to lower case and keeps xpubs as given", () => {
    const btc = utxoAdapter(BITCOIN);
    expect(btc.normalise(" BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU ")).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(btc.normalise(account(44))).toBe(account(44));
    expect(() => btc.normalise("hello")).toThrow(/Not a valid Bitcoin address/);
  });
});
