import { randomUUID } from "node:crypto";
import type { x402HTTPClient } from "@x402/core/client";
import { BudgetError, hashscanTransactionUrl, planTools, type RunDepth, type ToolId } from "./domain.js";
import { purchaseTool, type PurchaseEvent, type PurchaseReceipt } from "./payment.js";
import type { ToolResult } from "./tools.js";

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type RunEvent = {
  sequence: number;
  at: string;
  phase: "policy" | "http" | "payment" | "evidence" | "complete" | "error";
  title: string;
  detail: string;
  toolId?: ToolId;
  transaction?: string;
  hashscanUrl?: string;
};

export type RunRecord = {
  id: string;
  accountId: string;
  depth: RunDepth;
  budgetTinybar: string;
  plannedCostTinybar: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  events: RunEvent[];
  results: ToolResult[];
  receipts: (PurchaseReceipt & { toolId: ToolId; hashscanUrl: string })[];
  summary?: {
    purchasedTools: number;
    spentTinybar: string;
    verdict: string | null;
  };
  error?: string;
};

export class RunStore {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly historyLimit = 50) {}

  create(accountId: string, depth: RunDepth, budgetTinybar: bigint): RunRecord {
    const tools = planTools(depth, budgetTinybar);
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: randomUUID(),
      accountId,
      depth,
      budgetTinybar: budgetTinybar.toString(),
      plannedCostTinybar: tools.reduce((sum, tool) => sum + tool.priceTinybar, 0n).toString(),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
      results: [],
      receipts: [],
    };
    this.runs.set(run.id, run);
    this.trim();
    return structuredClone(run);
  }

  get(id: string): RunRecord | undefined {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  recent(): RunRecord[] {
    return [...this.runs.values()].reverse().map(run => structuredClone(run));
  }

  mutate(id: string, update: (run: RunRecord) => void): void {
    const run = this.runs.get(id);
    if (!run) throw new Error(`run ${id} not found`);
    update(run);
    run.updatedAt = new Date().toISOString();
  }

  private trim(): void {
    while (this.runs.size > this.historyLimit) {
      const oldest = this.runs.keys().next().value as string | undefined;
      if (!oldest) break;
      this.runs.delete(oldest);
    }
  }
}

export type PurchaseFunction = typeof purchaseTool;

export class RunEngine {
  constructor(
    private readonly store: RunStore,
    private readonly baseUrl: string,
    private readonly client: x402HTTPClient,
    private readonly purchase: PurchaseFunction = purchaseTool,
    private readonly onFinished: () => void = () => undefined,
  ) {}

  start(runId: string): void {
    queueMicrotask(() => {
      void this.execute(runId);
    });
  }

  private event(runId: string, event: Omit<RunEvent, "sequence" | "at">): void {
    this.store.mutate(runId, run => {
      run.events.push({ sequence: run.events.length + 1, at: new Date().toISOString(), ...event });
    });
  }

  private paymentEvent(runId: string, toolId: ToolId, event: PurchaseEvent): void {
    const phase = event.stage === "request" ? "http" : "payment";
    const title = event.stage === "request" ? "Tool requested" : event.stage === "challenge" ? "402 Payment Required" : event.stage === "signed" ? "Exact payment signed" : "Settlement confirmed";
    this.event(runId, {
      phase,
      title,
      detail: event.detail,
      toolId,
      ...(event.transaction
        ? { transaction: event.transaction, hashscanUrl: hashscanTransactionUrl(event.transaction) }
        : {}),
    });
  }

  private async execute(runId: string): Promise<void> {
    const initial = this.store.get(runId);
    if (!initial) return;
    try {
      const tools = planTools(initial.depth, BigInt(initial.budgetTinybar));
      this.store.mutate(runId, run => {
        run.status = "running";
      });
      this.event(runId, {
        phase: "policy",
        title: "Procurement policy approved",
        detail: `${initial.depth} dossier selected ${tools.length} tool(s) for ${initial.plannedCostTinybar} tinybar within a ${initial.budgetTinybar} tinybar budget.`,
      });

      for (const tool of tools) {
        const bought = await this.purchase({
          baseUrl: this.baseUrl,
          accountId: initial.accountId,
          tool,
          client: this.client,
          onEvent: event => this.paymentEvent(runId, tool.id, event),
        });
        this.store.mutate(runId, run => {
          run.results.push(bought.result);
          run.receipts.push({
            ...bought.receipt,
            toolId: tool.id,
            hashscanUrl: hashscanTransactionUrl(bought.receipt.transaction),
          });
        });
        this.event(runId, {
          phase: "evidence",
          title: `${tool.name} evidence accepted`,
          detail: bought.result.summary,
          toolId: tool.id,
        });
      }

      this.store.mutate(runId, run => {
        const spent = run.receipts.reduce((sum, receipt) => sum + BigInt(receipt.amountTinybar), 0n);
        const risk = run.results.find(result => result.toolId === "risk");
        const verdict = risk && typeof risk.data.verdict === "string" ? risk.data.verdict : null;
        run.summary = { purchasedTools: run.results.length, spentTinybar: spent.toString(), verdict };
        run.status = "completed";
      });
      this.event(runId, {
        phase: "complete",
        title: "Dossier complete",
        detail: "Every protected result has a confirmed Hedera testnet settlement receipt.",
      });
    } catch (error) {
      const message = error instanceof BudgetError ? error.message : error instanceof Error ? error.message : "run failed";
      this.store.mutate(runId, run => {
        run.status = "failed";
        run.error = message;
      });
      this.event(runId, { phase: "error", title: "Run stopped", detail: message });
    } finally {
      this.onFinished();
    }
  }
}

export class DemoGate {
  private lastStart: number | null = null;
  private active = false;

  constructor(private readonly cooldownSeconds: number, private readonly now: () => number = Date.now) {}

  enter(): { ok: true } | { ok: false; retryAfterSeconds: number; reason: string } {
    const current = this.now();
    if (this.active) return { ok: false, retryAfterSeconds: 1, reason: "another autonomous buyer run is active" };
    const waitMs = this.lastStart === null ? 0 : this.lastStart + this.cooldownSeconds * 1_000 - current;
    if (waitMs > 0) return { ok: false, retryAfterSeconds: Math.ceil(waitMs / 1_000), reason: "demo payment cooldown is active" };
    this.active = true;
    this.lastStart = current;
    return { ok: true };
  }

  leave(): void {
    this.active = false;
  }
}
