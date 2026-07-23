import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { TOOL_DEFINITIONS, hashscanTransactionUrl } from "../src/domain.js";
import { createBuyerHttpClient, purchaseTool } from "../src/payment.js";
import { assertLivePaymentPreflight, type LiveHealth } from "../src/live-preflight.js";

function canonicalTransactionId(transaction: string): string {
  const [account, timestamp] = transaction.split("@");
  return account && timestamp ? `${account}-${timestamp.replace(".", "-")}` : transaction;
}

async function verifyOnMirror(transaction: string, payTo: string, amountTinybar: string) {
  const id = canonicalTransactionId(transaction);
  const url = `https://testnet.mirrornode.hedera.com/api/v1/transactions/${encodeURIComponent(id)}`;
  const deadline = Date.now() + 90_000;
  let lastStatus = 0;

  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Sentinel402/0.1" }, signal: AbortSignal.timeout(8_000) });
    lastStatus = response.status;
    if (response.ok) {
      const body = await response.json() as {
        transactions?: { result?: string; transaction_id?: string; transfers?: { account?: string; amount?: number | string }[] }[];
      };
      const rows = body.transactions ?? [];
      const success = rows.find(row => row.result === "SUCCESS");
      if (success) {
        const credited = (success.transfers ?? [])
          .filter(transfer => transfer.account === payTo)
          .reduce((sum, transfer) => sum + BigInt(String(transfer.amount ?? 0)), 0n);
        if (credited !== BigInt(amountTinybar)) {
          throw new Error(`Mirror receiver credit mismatch: expected ${amountTinybar}, got ${credited}`);
        }
        return { mirrorUrl: url, result: success.result, receiverCreditTinybar: credited.toString() };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Mirror did not confirm ${transaction} within 90s (last HTTP ${lastStatus})`);
}

const config = loadConfig();
if (!config.buyer) throw new Error("HEDERA_BUYER_ACCOUNT_ID and HEDERA_BUYER_PRIVATE_KEY are required");
const client = createBuyerHttpClient(config);
if (!client) throw new Error("buyer client initialization failed");
const serverUrl = process.env.E2E_SERVER_URL ?? config.publicBaseUrl;

const health = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
if (!health.ok) throw new Error(`resource server health returned HTTP ${health.status}`);
const healthBody = await health.json() as LiveHealth;
assertLivePaymentPreflight(healthBody, { network: config.hederaNetwork, payToAccount: config.payToAccount });

const purchases = [];
for (const tool of TOOL_DEFINITIONS) {
  const paid = await purchaseTool({ baseUrl: serverUrl, accountId: "0.0.108869", tool, client });
  const mirror = await verifyOnMirror(paid.receipt.transaction, config.payToAccount, tool.priceTinybar.toString());
  purchases.push({
    toolId: tool.id,
    priceTinybar: tool.priceTinybar.toString(),
    transaction: paid.receipt.transaction,
    hashscanUrl: hashscanTransactionUrl(paid.receipt.transaction),
    payer: paid.receipt.payer,
    network: paid.receipt.network,
    mirror,
    resultSummary: paid.result.summary,
  });
}

const artifact = {
  marker: "E2E_TESTNET_OK",
  verifiedAt: new Date().toISOString(),
  resourceServer: serverUrl,
  protocol: "x402 v2 exact Hedera",
  paymentNetwork: "hedera:testnet",
  evidenceNetwork: "hedera:mainnet",
  buyerAccount: config.buyer.accountId,
  receiverAccount: config.payToAccount,
  purchases,
};

await mkdir("artifacts/public", { recursive: true });
await writeFile("artifacts/public/testnet-e2e.json", `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ marker: artifact.marker, transactions: purchases.map(item => item.hashscanUrl) }));
