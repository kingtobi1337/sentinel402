import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { serve } from "@hono/node-server";
import { PrivateKey } from "@x402/hedera";
import type { AppConfig } from "../src/config.js";
import { TOOL_DEFINITIONS } from "../src/domain.js";
import { MirrorClient } from "../src/mirror.js";
import { createApp } from "../src/app.js";
import { createBuyerHttpClient, purchaseTool } from "../src/payment.js";

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  response.end(data);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a TCP port");
  return address.port;
}

const calls = { supported: 0, verify: 0, settle: 0 };
const facilitator = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && path === "/supported") {
    calls.supported += 1;
    return sendJson(response, 200, {
      kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.9001" } }],
      extensions: [],
      signers: {},
    });
  }
  if (request.method === "POST" && path === "/verify") {
    calls.verify += 1;
    const body = await readJson(request);
    if (!body.paymentPayload || !body.paymentRequirements) return sendJson(response, 400, { error: "malformed" });
    return sendJson(response, 200, { isValid: true, payer: "0.0.8001" });
  }
  if (request.method === "POST" && path === "/settle") {
    calls.settle += 1;
    const body = await readJson(request);
    const requirements = body.paymentRequirements as { amount?: string; network?: string } | undefined;
    return sendJson(response, 200, {
      success: true,
      transaction: "0.0.9001@1700000000.123456789",
      network: requirements?.network ?? "hedera:testnet",
      payer: "0.0.8001",
      amount: requirements?.amount ?? "100000",
    });
  }
  return sendJson(response, 404, { error: "not_found" });
});

const facilitatorPort = await listen(facilitator);
const buyerKey = PrivateKey.generateECDSA();
const config: AppConfig = {
  port: 0,
  nodeEnv: "test",
  hederaNetwork: "hedera:testnet",
  facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`,
  payToAccount: "0.0.7001",
  mirrorUrl: "https://mirror.mock/api/v1",
  publicBaseUrl: "http://127.0.0.1",
  internalBaseUrl: "http://127.0.0.1",
  demoMaxBudgetTinybar: 1_000_000n,
  demoCooldownSeconds: 5,
  evidenceWindowMinutes: 60,
  buyer: { accountId: "0.0.8001", privateKey: buyerKey.toStringRaw() },
};

const mirrorFetch: typeof fetch = async input => {
  const url = String(input);
  const body = url.includes("/accounts/")
    ? {
        account: "0.0.42",
        alias: null,
        balance: { balance: 123_456_789, timestamp: "1700000000.0" },
        created_timestamp: "1600000000.0",
        deleted: false,
        ethereum_nonce: 0,
        evm_address: "0x000000000000000000000000000000000000002a",
        key: { _type: "ECDSA_SECP256K1", key: "public" },
        memo: "",
        pending_reward: 0,
        receiver_sig_required: false,
        staked_account_id: null,
        staked_node_id: null,
      }
    : { transactions: [], links: { next: null } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

const mirror = new MirrorClient(config.mirrorUrl, mirrorFetch, () => 1_700_000_000_000);
const { app } = createApp(config, { mirror });
const appServer = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
await once(appServer, "listening");
const address = appServer.address();
if (!address || typeof address === "string") throw new Error("app did not expose a TCP port");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const invalid = await fetch(`${baseUrl}/api/tools/identity?account=invalid`);
  if (invalid.status !== 400) throw new Error(`invalid input returned ${invalid.status}, expected 400`);
  if (invalid.headers.has("payment-required")) throw new Error("invalid input incorrectly requested payment");

  const client = createBuyerHttpClient(config);
  if (!client) throw new Error("buyer client was not created");
  const purchase = await purchaseTool({
    baseUrl,
    accountId: "0.0.42",
    tool: TOOL_DEFINITIONS[0]!,
    client,
  });

  if (purchase.result.toolId !== "identity") throw new Error("paid tool result mismatch");
  if (purchase.receipt.transaction !== "0.0.9001@1700000000.123456789") throw new Error("settlement receipt mismatch");
  if (calls.verify !== 1 || calls.settle !== 1) throw new Error(`unexpected facilitator calls: ${JSON.stringify(calls)}`);

  console.log(JSON.stringify({
    marker: "E2E_MOCK_OK",
    protocol: "x402-v2 exact Hedera",
    firstResponse: 402,
    paidResponse: 200,
    transaction: purchase.receipt.transaction,
    calls,
  }));
} finally {
  appServer.close();
  facilitator.close();
}
