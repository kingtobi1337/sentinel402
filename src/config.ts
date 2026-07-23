import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseAccountId } from "./domain.js";

export type AppConfig = {
  port: number;
  nodeEnv: string;
  hederaNetwork: "hedera:testnet";
  facilitatorUrl: string;
  payToAccount: string;
  mirrorUrl: string;
  publicBaseUrl: string;
  internalBaseUrl: string;
  demoMaxBudgetTinybar: bigint;
  demoCooldownSeconds: number;
  evidenceWindowMinutes: number;
  buyer?: {
    accountId: string;
    privateKey: string;
  };
};

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

function httpUrl(name: string, fallback: string, allowLocal: boolean): string {
  const raw = process.env[name] ?? fallback;
  const url = new URL(raw);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(allowLocal && local && url.protocol === "http:")) {
    throw new Error(`${name} must be HTTPS${allowLocal ? " or local HTTP" : ""}`);
  }
  return url.toString().replace(/\/$/, "");
}

function optionalSecret(name: string, fileName: string): string | undefined {
  const direct = process.env[name]?.trim() || undefined;
  const filePath = process.env[fileName]?.trim() || undefined;
  if (direct && filePath) throw new Error(`${name} and ${fileName} are mutually exclusive`);
  if (!filePath) return direct;
  if (!isAbsolute(filePath)) throw new Error(`${fileName} must be an absolute path`);
  const size = statSync(filePath).size;
  if (size < 1 || size > 4_096) throw new Error(`${fileName} must contain between 1 and 4096 bytes`);
  const value = readFileSync(filePath, "utf8").trim();
  if (!value) throw new Error(`${fileName} is empty`);
  return value;
}

export function loadConfig(): AppConfig {
  const port = integer("PORT", 4021, 1, 65_535);
  const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
  if (network !== "hedera:testnet") throw new Error("HEDERA_NETWORK must be hedera:testnet for this bounty build");

  const payToRaw = process.env.PAY_TO_ACCOUNT;
  if (!payToRaw) throw new Error("PAY_TO_ACCOUNT is required");
  const payToAccount = parseAccountId(payToRaw);

  const buyerAccount = process.env.HEDERA_BUYER_ACCOUNT_ID;
  const buyerKey = optionalSecret("HEDERA_BUYER_PRIVATE_KEY", "HEDERA_BUYER_INPUT_FILE");
  if ((buyerAccount && !buyerKey) || (!buyerAccount && buyerKey)) {
    throw new Error("HEDERA_BUYER_ACCOUNT_ID and a buyer private-key source must be set together");
  }

  const budgetText = process.env.DEMO_MAX_BUDGET_TINYBAR ?? "1000000";
  if (!/^[1-9][0-9]*$/.test(budgetText)) throw new Error("DEMO_MAX_BUDGET_TINYBAR must be a positive integer");

  return {
    port,
    nodeEnv: process.env.NODE_ENV ?? "development",
    hederaNetwork: network,
    facilitatorUrl: httpUrl("FACILITATOR_URL", "https://api.testnet.blocky402.com", false),
    payToAccount,
    mirrorUrl: httpUrl("HEDERA_MIRROR_URL", "https://mainnet-public.mirrornode.hedera.com/api/v1", false),
    publicBaseUrl: httpUrl("PUBLIC_BASE_URL", `http://127.0.0.1:${port}`, true),
    internalBaseUrl: httpUrl("INTERNAL_BASE_URL", `http://127.0.0.1:${port}`, true),
    demoMaxBudgetTinybar: BigInt(budgetText),
    demoCooldownSeconds: integer("DEMO_COOLDOWN_SECONDS", 30, 5, 3_600),
    evidenceWindowMinutes: integer("EVIDENCE_WINDOW_MINUTES", 60, 5, 10_080),
    ...(buyerAccount && buyerKey
      ? { buyer: { accountId: parseAccountId(buyerAccount), privateKey: buyerKey } }
      : {}),
  };
}

export function publicConfig(config: AppConfig) {
  return {
    appUrl: config.publicBaseUrl,
    network: config.hederaNetwork,
    payToAccount: config.payToAccount,
    facilitatorUrl: config.facilitatorUrl,
    evidenceNetwork: "hedera:mainnet",
    evidenceWindowMinutes: config.evidenceWindowMinutes,
    demoReady: Boolean(config.buyer),
    demoMaxBudgetTinybar: config.demoMaxBudgetTinybar.toString(),
  };
}
