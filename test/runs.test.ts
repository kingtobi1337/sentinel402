import { describe, expect, it, vi } from "vitest";
import type { x402HTTPClient } from "@x402/core/client";
import { TOOL_DEFINITIONS } from "../src/domain.js";
import { DemoGate, RunEngine, RunStore, type PurchaseFunction } from "../src/runs.js";

async function terminalRun(store: RunStore, id: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = store.get(id);
    if (run?.status === "completed" || run?.status === "failed") return run;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("run did not finish");
}

describe("autonomous run engine", () => {
  it("purchases the policy-selected tools and records receipts", async () => {
    let tx = 0;
    const purchase = vi.fn(async args => {
      args.onEvent?.({ stage: "request", detail: "GET" });
      args.onEvent?.({ stage: "challenge", detail: "402" });
      args.onEvent?.({ stage: "signed", detail: "signed" });
      tx += 1;
      const transaction = `0.0.7162784@170000000${tx}.000000001`;
      args.onEvent?.({ stage: "settled", detail: "settled", transaction });
      return {
        result: {
          toolId: args.tool.id,
          generatedAt: new Date(0).toISOString(),
          subject: args.accountId,
          summary: `${args.tool.name} ok`,
          data: args.tool.id === "risk" ? { verdict: "low" } : {},
          evidence: [],
          methodology: [],
        },
        receipt: { transaction, payer: "0.0.1", network: "hedera:testnet", amountTinybar: args.tool.priceTinybar.toString() },
      };
    }) as PurchaseFunction;
    const store = new RunStore();
    const finished = vi.fn();
    const engine = new RunEngine(store, "http://127.0.0.1:4021", {} as x402HTTPClient, purchase, finished);
    const run = store.create("0.0.42", "deep", 600_000n);
    engine.start(run.id);
    const completed = await terminalRun(store, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.results.map(result => result.toolId)).toEqual(TOOL_DEFINITIONS.map(tool => tool.id));
    expect(completed.receipts).toHaveLength(3);
    expect(completed.summary).toEqual({ purchasedTools: 3, spentTinybar: "600000", verdict: "low" });
    expect(completed.events.filter(event => event.title === "402 Payment Required")).toHaveLength(3);
    expect(finished).toHaveBeenCalledOnce();
  });

  it("stops after a failed purchase and never marks the run complete", async () => {
    const purchase = vi.fn(async () => {
      throw new Error("settlement failed");
    }) as PurchaseFunction;
    const store = new RunStore();
    const engine = new RunEngine(store, "http://127.0.0.1:4021", {} as x402HTTPClient, purchase);
    const run = store.create("0.0.42", "standard", 300_000n);
    engine.start(run.id);
    const failed = await terminalRun(store, run.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("settlement failed");
    expect(failed.results).toHaveLength(0);
  });
});

describe("demo gate", () => {
  it("enforces one active run and a cooldown", () => {
    let now = 1_000;
    const gate = new DemoGate(30, () => now);
    expect(gate.enter()).toEqual({ ok: true });
    expect(gate.enter()).toMatchObject({ ok: false, reason: "another autonomous buyer run is active" });
    gate.leave();
    expect(gate.enter()).toMatchObject({ ok: false, retryAfterSeconds: 30 });
    now += 30_000;
    expect(gate.enter()).toEqual({ ok: true });
  });
});
