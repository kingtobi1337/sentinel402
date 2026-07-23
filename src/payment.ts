import { paymentMiddleware } from "@x402/hono";
import { HTTPFacilitatorClient, x402ResourceServer, type RoutesConfig } from "@x402/core/server";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme as ExactHederaClientScheme } from "@x402/hedera/exact/client";
import { ExactHederaScheme as ExactHederaServerScheme } from "@x402/hedera/exact/server";
import type { MiddlewareHandler } from "hono";
import type { AppConfig } from "./config.js";
import { TOOL_DEFINITIONS, type ToolDefinition } from "./domain.js";
import type { ToolResult } from "./tools.js";

export type PurchaseStage = "request" | "challenge" | "signed" | "settled";
export type PurchaseEvent = { stage: PurchaseStage; detail: string; transaction?: string; payer?: string };
export type PurchaseReceipt = {
  transaction: string;
  payer: string | null;
  network: string;
  amountTinybar: string;
};

export type PurchaseResult = {
  result: ToolResult;
  receipt: PurchaseReceipt;
};

type FetchLike = typeof fetch;

function paymentRoutes(config: AppConfig): RoutesConfig {
  return Object.fromEntries(
    TOOL_DEFINITIONS.map(tool => [
      `GET ${tool.endpoint}`,
      {
        accepts: {
          scheme: "exact",
          network: config.hederaNetwork,
          payTo: config.payToAccount,
          price: { asset: "0.0.0", amount: tool.priceTinybar.toString() },
          maxTimeoutSeconds: 180,
        },
        description: `${tool.name}: ${tool.description}`,
        mimeType: "application/json",
      },
    ]),
  ) as RoutesConfig;
}

export function createToolPaymentMiddleware(config: AppConfig): MiddlewareHandler {
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register("hedera:*", new ExactHederaServerScheme());
  return paymentMiddleware(paymentRoutes(config), server, undefined, undefined, true);
}

export function createBuyerHttpClient(config: AppConfig): x402HTTPClient | null {
  if (!config.buyer) return null;
  const signer = createClientHederaSigner(
    config.buyer.accountId,
    PrivateKey.fromStringECDSA(config.buyer.privateKey),
    { network: config.hederaNetwork },
  );
  const client = new x402Client().register("hedera:*", new ExactHederaClientScheme(signer));
  return new x402HTTPClient(client);
}

async function request(url: string, init: RequestInit | undefined, fetchImpl: FetchLike, timeoutMs: number): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`paid request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

type SuccessfulSettlement = Record<string, unknown> & {
  success: true;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
};

function isSuccessfulSettlement(value: unknown): value is SuccessfulSettlement {
  return isRecord(value) && value.success === true && typeof value.transaction === "string" && typeof value.network === "string";
}

function parseToolResult(value: unknown, expectedTool: ToolDefinition): ToolResult {
  if (!isRecord(value) || value.toolId !== expectedTool.id || typeof value.summary !== "string" || !Array.isArray(value.evidence)) {
    throw new Error(`${expectedTool.name} returned an invalid result`);
  }
  return value as ToolResult;
}

export async function purchaseTool(args: {
  baseUrl: string;
  accountId: string;
  tool: ToolDefinition;
  client: x402HTTPClient;
  fetchImpl?: FetchLike;
  onEvent?: (event: PurchaseEvent) => void;
}): Promise<PurchaseResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = new URL(args.tool.endpoint, args.baseUrl);
  url.searchParams.set("account", args.accountId);
  args.onEvent?.({ stage: "request", detail: `GET ${args.tool.endpoint}` });

  const first = await request(url.toString(), undefined, fetchImpl, 15_000);
  if (first.status !== 402) {
    throw new Error(`${args.tool.name} expected HTTP 402 but received ${first.status}`);
  }
  const challengeBody = await first.clone().json().catch(() => undefined);
  const paymentRequired = args.client.getPaymentRequiredResponse(name => first.headers.get(name), challengeBody);
  const accepted = paymentRequired.accepts.find(entry => entry.scheme === "exact" && entry.network === "hedera:testnet");
  if (!accepted || accepted.amount !== args.tool.priceTinybar.toString() || accepted.asset !== "0.0.0") {
    throw new Error(`${args.tool.name} advertised unexpected payment requirements`);
  }
  args.onEvent?.({ stage: "challenge", detail: `HTTP 402 · ${accepted.amount} tinybar requested` });

  const payload = await args.client.createPaymentPayload(paymentRequired);
  const headers = args.client.encodePaymentSignatureHeader(payload);
  args.onEvent?.({ stage: "signed", detail: "Buyer authorized the exact transfer; private key stayed server-side" });

  const paid = await request(url.toString(), { headers }, fetchImpl, 90_000);
  const processed = await args.client.processResponse(paid);
  if (processed.paymentStatus !== "settled" || !isSuccessfulSettlement(processed.header)) {
    const headerRecord = asRecord(processed.header);
    const reason = typeof headerRecord?.["errorReason"] === "string" ? headerRecord["errorReason"] : `HTTP ${processed.status}`;
    throw new Error(`${args.tool.name} settlement failed: ${reason}`);
  }
  const settlement = processed.header;
  const transaction = settlement.transaction;
  if (transaction.length === 0) throw new Error(`${args.tool.name} settlement omitted transaction id`);
  const payer = typeof settlement.payer === "string" ? settlement.payer : null;
  args.onEvent?.({
    stage: "settled",
    detail: `Hedera testnet settlement confirmed: ${transaction}`,
    transaction,
    ...(payer ? { payer } : {}),
  });

  return {
    result: parseToolResult(processed.body, args.tool),
    receipt: {
      transaction,
      payer,
      network: settlement.network,
      amountTinybar: typeof settlement.amount === "string" ? settlement.amount : args.tool.priceTinybar.toString(),
    },
  };
}
