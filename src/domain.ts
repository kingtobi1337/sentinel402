export type ToolId = "identity" | "flow" | "risk";
export type RunDepth = "quick" | "standard" | "deep";

export type ToolDefinition = {
  id: ToolId;
  name: string;
  tagline: string;
  description: string;
  endpoint: string;
  priceTinybar: bigint;
  evidence: string[];
};

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: "identity",
    name: "Identity Lens",
    tagline: "Who is this account?",
    description: "Account age, key type, balance, staking and lifecycle metadata.",
    endpoint: "/api/tools/identity",
    priceTinybar: 100_000n,
    evidence: ["Mirror Node account record"],
  },
  {
    id: "flow",
    name: "Flow Lens",
    tagline: "How does value move?",
    description: "Complete bounded-window transfer flow, counterparties, failures and transaction mix.",
    endpoint: "/api/tools/flow",
    priceTinybar: 200_000n,
    evidence: ["Mirror Node transaction history", "Native HBAR transfer lists"],
  },
  {
    id: "risk",
    name: "Risk Jury",
    tagline: "What deserves attention?",
    description: "Transparent deterministic signals with an inspectable score and verdict.",
    endpoint: "/api/tools/risk",
    priceTinybar: 300_000n,
    evidence: ["Identity Lens inputs", "Flow Lens inputs", "Published scoring rules"],
  },
] as const;

const BY_ID = new Map<ToolId, ToolDefinition>(TOOL_DEFINITIONS.map(tool => [tool.id, tool]));

export class InputError extends Error {
  readonly status = 400;
}

export class BudgetError extends Error {
  readonly status = 422;
}

export function getTool(id: string): ToolDefinition | undefined {
  return BY_ID.get(id as ToolId);
}

export function parseAccountId(value: unknown): string {
  if (typeof value !== "string") throw new InputError("account must be a Hedera account id");
  const trimmed = value.trim();
  if (!/^0\.0\.(?:0|[1-9][0-9]{0,19})$/.test(trimmed)) {
    throw new InputError("account must use canonical 0.0.x format");
  }
  return trimmed;
}

export function parseDepth(value: unknown): RunDepth {
  if (value === undefined || value === null || value === "") return "deep";
  if (value === "quick" || value === "standard" || value === "deep") return value;
  throw new InputError("depth must be quick, standard, or deep");
}

export function parseBudgetTinybar(value: unknown, ceiling: bigint): bigint {
  if (value === undefined || value === null || value === "") return ceiling;
  if (typeof value !== "string" && typeof value !== "number") throw new InputError("budgetTinybar must be an integer");
  const text = String(value);
  if (!/^[1-9][0-9]*$/.test(text)) throw new InputError("budgetTinybar must be a positive integer");
  const budget = BigInt(text);
  if (budget > ceiling) throw new BudgetError(`budget exceeds demo ceiling of ${ceiling} tinybar`);
  return budget;
}

export function planTools(depth: RunDepth, budgetTinybar: bigint): ToolDefinition[] {
  const ids: ToolId[] = depth === "quick" ? ["identity"] : depth === "standard" ? ["identity", "flow"] : ["identity", "flow", "risk"];
  const tools = ids.map(id => BY_ID.get(id)!);
  const total = tools.reduce((sum, tool) => sum + tool.priceTinybar, 0n);
  if (total > budgetTinybar) {
    throw new BudgetError(`selected ${depth} dossier costs ${total} tinybar but budget is ${budgetTinybar}`);
  }
  return tools;
}

export function tinybarToHbar(value: bigint): string {
  const negative = value < 0n;
  const amount = negative ? -value : value;
  const whole = amount / 100_000_000n;
  const fraction = (amount % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function hashscanTransactionUrl(transaction: string): string {
  const [account, timestamp] = transaction.split("@");
  const canonical = account && timestamp ? `${account}-${timestamp.replace(".", "-")}` : transaction;
  return `https://hashscan.io/testnet/transaction/${encodeURIComponent(canonical)}`;
}

export function publicTool(tool: ToolDefinition) {
  return {
    ...tool,
    priceTinybar: tool.priceTinybar.toString(),
    priceHbar: tinybarToHbar(tool.priceTinybar),
  };
}
