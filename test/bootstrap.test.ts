import { describe, expect, it } from "vitest";
import { PrivateKey } from "@x402/hedera";

// The payment package must expose one working Hedera SDK instance after security overrides.
describe("dependency baseline", () => {
  it("creates an ECDSA key through the official x402 Hedera re-export", () => {
    const key = PrivateKey.generateECDSA();
    expect(key.publicKey.toEvmAddress()).toMatch(/^[0-9a-f]{40}$/i);
  });
});
