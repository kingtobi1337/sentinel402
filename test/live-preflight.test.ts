import { describe, expect, it } from "vitest";
import { assertLivePaymentPreflight } from "../src/live-preflight.js";

const expected = { network: "hedera:testnet", payToAccount: "0.0.9706314" };

describe("live payment preflight", () => {
  it("accepts only the exact configured live surface", () => {
    expect(() => assertLivePaymentPreflight({ ...expected, demoReady: true }, expected)).not.toThrow();
  });

  it("blocks a stale receiver before any payment can be created", () => {
    expect(() => assertLivePaymentPreflight({ network: "hedera:testnet", payToAccount: "0.0.1234", demoReady: true }, expected)).toThrow(
      "resource server receiver mismatch",
    );
  });

  it("blocks a server without its autonomous buyer", () => {
    expect(() => assertLivePaymentPreflight({ ...expected, demoReady: false }, expected)).toThrow(
      "resource server buyer is not ready",
    );
  });
});
