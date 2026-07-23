import "dotenv/config";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { AccountCreateTransaction } from "@hiero-ledger/sdk";
import { Client, Hbar, PrivateKey } from "@x402/hedera";
import { hashscanTransactionUrl, parseAccountId } from "../src/domain.js";

const ENV_PATH = ".env";
const buyerKeyText = process.env.HEDERA_BUYER_PRIVATE_KEY;
if (!buyerKeyText) throw new Error("HEDERA_BUYER_PRIVATE_KEY is missing from .env");
const buyerKey = PrivateKey.fromStringECDSA(buyerKeyText);
const buyerEvmAddress = `0x${buyerKey.publicKey.toEvmAddress()}`;

async function resolveBuyerAccount(): Promise<string> {
  const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${buyerEvmAddress}`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Sentinel402/0.1" }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) {
    throw new Error(`Buyer is not funded yet. Submit ${buyerEvmAddress} at https://portal.hedera.com/faucet`);
  }
  if (!response.ok) throw new Error(`Testnet Mirror returned HTTP ${response.status}`);
  const body = await response.json() as { account?: string };
  return parseAccountId(body.account);
}

function upsert(lines: string[], key: string, value: string): void {
  const index = lines.findIndex(line => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

const buyerAccount = await resolveBuyerAccount();
const existingReceiver = process.env.PAY_TO_ACCOUNT;
if (existingReceiver && /^0\.0\.[1-9][0-9]*$/.test(existingReceiver)) {
  console.log(JSON.stringify({ marker: "TESTNET_BOOTSTRAP_ALREADY_READY", buyerAccount, receiverAccount: existingReceiver, buyerEvmAddress }));
  process.exit(0);
}

const receiverKey = PrivateKey.generateECDSA();
const client = Client.forTestnet().setOperator(buyerAccount, buyerKey);
let receiverAccount: string;
let creationTransaction: string;
try {
  const response = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(receiverKey.publicKey)
    .setInitialBalance(new Hbar(2))
    .execute(client);
  creationTransaction = response.transactionId.toString();
  const receipt = await response.getReceipt(client);
  if (!receipt.accountId) throw new Error("Account creation receipt omitted account id");
  receiverAccount = receipt.accountId.toString();
} finally {
  client.close();
}

const text = await readFile(ENV_PATH, "utf8");
const lines = text.trimEnd().split("\n");
upsert(lines, "HEDERA_BUYER_ACCOUNT_ID", buyerAccount);
upsert(lines, "PAY_TO_ACCOUNT", receiverAccount);
upsert(lines, "HEDERA_RECEIVER_PRIVATE_KEY", receiverKey.toStringRaw());
upsert(lines, "PUBLIC_BASE_URL", "http://127.0.0.1:4021");
upsert(lines, "INTERNAL_BASE_URL", "http://127.0.0.1:4021");
await writeFile(ENV_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });
await chmod(ENV_PATH, 0o600);

console.log(JSON.stringify({
  marker: "TESTNET_BOOTSTRAP_OK",
  buyerAccount,
  buyerEvmAddress,
  receiverAccount,
  receiverEvmAddress: `0x${receiverKey.publicKey.toEvmAddress()}`,
  creationTransaction,
  creationHashscanUrl: hashscanTransactionUrl(creationTransaction),
}));
