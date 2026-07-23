import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

const managed = [
  "PAY_TO_ACCOUNT",
  "HEDERA_BUYER_ACCOUNT_ID",
  "HEDERA_BUYER_PRIVATE_KEY",
  "HEDERA_BUYER_CREDENTIAL_FILE",
  "PUBLIC_BASE_URL",
  "INTERNAL_BASE_URL",
];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "sentinel402-config-"));
  for (const name of managed) vi.stubEnv(name, "");
  vi.stubEnv("PAY_TO_ACCOUNT", "0.0.7001");
  vi.stubEnv("PUBLIC_BASE_URL", "http://127.0.0.1:4021");
  vi.stubEnv("INTERNAL_BASE_URL", "http://127.0.0.1:4021");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("buyer secret loading", () => {
  it("loads the private key from an absolute runtime secret file", () => {
    const path = join(directory, "buyer-key");
    writeFileSync(path, "test-private-key\n");
    vi.stubEnv("HEDERA_BUYER_ACCOUNT_ID", "0.0.8001");
    vi.stubEnv("HEDERA_BUYER_CREDENTIAL_FILE", path);
    expect(loadConfig().buyer).toEqual({ accountId: "0.0.8001", privateKey: "test-private-key" });
  });

  it("rejects simultaneous direct and file secret sources", () => {
    const path = join(directory, "buyer-key");
    writeFileSync(path, "file-key");
    vi.stubEnv("HEDERA_BUYER_ACCOUNT_ID", "0.0.8001");
    vi.stubEnv("HEDERA_BUYER_PRIVATE_KEY", "direct-key");
    vi.stubEnv("HEDERA_BUYER_CREDENTIAL_FILE", path);
    expect(() => loadConfig()).toThrow("mutually exclusive");
  });

  it("rejects relative secret paths and oversized files", () => {
    vi.stubEnv("HEDERA_BUYER_ACCOUNT_ID", "0.0.8001");
    vi.stubEnv("HEDERA_BUYER_CREDENTIAL_FILE", "relative-key");
    expect(() => loadConfig()).toThrow("must be an absolute path");

    const oversized = join(directory, "oversized");
    writeFileSync(oversized, "x".repeat(4_097));
    vi.stubEnv("HEDERA_BUYER_CREDENTIAL_FILE", oversized);
    expect(() => loadConfig()).toThrow("between 1 and 4096 bytes");
  });
});
