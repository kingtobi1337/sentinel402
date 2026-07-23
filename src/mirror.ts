type FetchLike = typeof fetch;

type MirrorAccount = {
  account: string;
  alias: string | null;
  balance: { balance: number | string; timestamp?: string };
  created_timestamp: string | null;
  deleted: boolean;
  ethereum_nonce: number;
  evm_address: string | null;
  key: { _type?: string; key?: string } | null;
  memo: string;
  pending_reward: number | string;
  receiver_sig_required: boolean;
  staked_account_id: string | null;
  staked_node_id: number | null;
};

export type MirrorTransfer = {
  account: string;
  amount: number | string;
  is_approval?: boolean;
};

export type MirrorTransaction = {
  charged_tx_fee: number | string;
  consensus_timestamp: string;
  memo_base64?: string;
  name: string;
  nonce: number;
  result: string;
  transaction_hash?: string;
  transaction_id: string;
  transfers: MirrorTransfer[];
};

type TransactionPage = {
  transactions: MirrorTransaction[];
  links: { next: string | null };
};

export class MirrorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "Sentinel402/0.1 (+https://github.com/kingtobi1337/sentinel402)" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new MirrorError(`Mirror request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new MirrorError(`Mirror returned HTTP ${response.status}`, response.status);
  try {
    return await response.json();
  } catch {
    throw new MirrorError("Mirror returned malformed JSON");
  }
}

function parseAccount(body: unknown): MirrorAccount {
  if (!isObject(body) || typeof body.account !== "string" || !isObject(body.balance)) {
    throw new MirrorError("Mirror account response has an unexpected shape");
  }
  return body as MirrorAccount;
}

function parseTransactionPage(body: unknown): TransactionPage {
  if (!isObject(body) || !Array.isArray(body.transactions) || !isObject(body.links)) {
    throw new MirrorError("Mirror transaction response has an unexpected shape");
  }
  for (const tx of body.transactions) {
    if (!isObject(tx) || typeof tx.transaction_id !== "string" || !Array.isArray(tx.transfers)) {
      throw new MirrorError("Mirror transaction row has an unexpected shape");
    }
  }
  const next = body.links.next;
  if (next !== null && typeof next !== "string") throw new MirrorError("Mirror pagination link has an unexpected shape");
  return body as TransactionPage;
}

export class MirrorClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  accountUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}`;
  }

  transactionUrl(accountId: string, windowMinutes: number): string {
    const sinceSeconds = Math.floor((this.now() - windowMinutes * 60_000) / 1_000);
    const url = new URL(`${this.baseUrl}/transactions`);
    url.searchParams.set("account.id", accountId);
    url.searchParams.set("timestamp", `gte:${sinceSeconds}`);
    url.searchParams.set("order", "desc");
    url.searchParams.set("limit", "100");
    return url.toString();
  }

  async getAccount(accountId: string): Promise<{ data: MirrorAccount; source: string }> {
    const source = this.accountUrl(accountId);
    return { data: parseAccount(await fetchJson(source, this.fetchImpl)), source };
  }

  async getTransactions(accountId: string, windowMinutes: number): Promise<{ data: MirrorTransaction[]; sources: string[] }> {
    const sources: string[] = [];
    const rows: MirrorTransaction[] = [];
    const seenPages = new Set<string>();
    let next: string | null = this.transactionUrl(accountId, windowMinutes);

    while (next) {
      const pageUrl = new URL(next, this.baseUrl).toString();
      if (seenPages.has(pageUrl)) throw new MirrorError("Mirror returned a repeated pagination link");
      seenPages.add(pageUrl);
      sources.push(pageUrl);
      const page = parseTransactionPage(await fetchJson(pageUrl, this.fetchImpl));
      rows.push(...page.transactions);
      next = page.links.next;
    }

    const unique = new Map<string, MirrorTransaction>();
    for (const row of rows) unique.set(`${row.transaction_id}:${row.nonce}`, row);
    return { data: [...unique.values()], sources };
  }
}
