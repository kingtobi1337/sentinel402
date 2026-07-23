import { describe, expect, it } from "vitest";
import {
  BudgetError,
  hashscanTransactionUrl,
  parseAccountId,
  parseBudgetTinybar,
  parseDepth,
  planTools,
  tinybarToHbar,
} from "../src/domain.js";

describe("domain validation and policy", () => {
  it("accepts canonical Hedera account ids only", () => {
    expect(parseAccountId(" 0.0.108869 ")).toBe("0.0.108869");
    for (const value of ["0.0.01", "0.1.2", "0xabc", "0.0.-1", "not-an-id", undefined]) {
      expect(() => parseAccountId(value)).toThrow();
    }
  });

  it("selects the smallest deterministic tool bundle for each depth", () => {
    expect(planTools(parseDepth("quick"), 100_000n).map(tool => tool.id)).toEqual(["identity"]);
    expect(planTools(parseDepth("standard"), 300_000n).map(tool => tool.id)).toEqual(["identity", "flow"]);
    expect(planTools(parseDepth("deep"), 600_000n).map(tool => tool.id)).toEqual(["identity", "flow", "risk"]);
  });

  it("fails closed when the budget cannot fund the selected policy", () => {
    expect(() => planTools("deep", 599_999n)).toThrow(BudgetError);
    expect(() => parseBudgetTinybar("1000001", 1_000_000n)).toThrow(BudgetError);
    expect(parseBudgetTinybar("600000", 1_000_000n)).toBe(600_000n);
  });

  it("formats integer tinybar without floating point", () => {
    expect(tinybarToHbar(100_000n)).toBe("0.001");
    expect(tinybarToHbar(123_456_789n)).toBe("1.23456789");
    expect(tinybarToHbar(-10n)).toBe("-0.0000001");
  });

  it("creates canonical testnet HashScan links", () => {
    expect(hashscanTransactionUrl("0.0.7162784@1700000000.123456789")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.7162784-1700000000-123456789",
    );
  });
});
