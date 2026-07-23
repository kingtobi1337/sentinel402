import { tinybarToHbar, type ToolId } from "./domain.js";
import { MirrorClient, type MirrorTransaction } from "./mirror.js";

export type ToolResult = {
  toolId: ToolId;
  generatedAt: string;
  subject: string;
  summary: string;
  data: Record<string, unknown>;
  evidence: { label: string; url: string }[];
  methodology: string[];
};

function bigint(value: string | number | undefined): bigint {
  if (value === undefined) return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function ageDays(timestamp: string | null, now: number): number | null {
  if (!timestamp) return null;
  const milliseconds = Number(timestamp.split(".")[0]) * 1_000;
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.floor((now - milliseconds) / 86_400_000));
}

function flowMetrics(accountId: string, transactions: MirrorTransaction[]) {
  let incoming = 0n;
  let outgoing = 0n;
  let fees = 0n;
  const counterparties = new Map<string, { incomingTinybar: bigint; outgoingTinybar: bigint; appearances: number }>();
  const typeCounts: Record<string, number> = {};
  const resultCounts: Record<string, number> = {};

  for (const tx of transactions) {
    typeCounts[tx.name] = (typeCounts[tx.name] ?? 0) + 1;
    resultCounts[tx.result] = (resultCounts[tx.result] ?? 0) + 1;
    fees += bigint(tx.charged_tx_fee);
    for (const transfer of tx.transfers) {
      const amount = bigint(transfer.amount);
      if (transfer.account === accountId) {
        if (amount > 0n) incoming += amount;
        if (amount < 0n) outgoing += -amount;
        continue;
      }
      const current = counterparties.get(transfer.account) ?? { incomingTinybar: 0n, outgoingTinybar: 0n, appearances: 0 };
      current.appearances += 1;
      if (amount > 0n) current.outgoingTinybar += amount;
      if (amount < 0n) current.incomingTinybar += -amount;
      counterparties.set(transfer.account, current);
    }
  }

  const counterpartyRows = [...counterparties.entries()]
    .map(([account, values]) => ({
      account,
      appearances: values.appearances,
      incomingTinybar: values.incomingTinybar.toString(),
      outgoingTinybar: values.outgoingTinybar.toString(),
      totalTinybar: (values.incomingTinybar + values.outgoingTinybar).toString(),
    }))
    .sort((a, b) => {
      const left = BigInt(a.totalTinybar);
      const right = BigInt(b.totalTinybar);
      return left === right ? a.account.localeCompare(b.account) : left > right ? -1 : 1;
    });

  return {
    transactionCount: transactions.length,
    successCount: resultCounts.SUCCESS ?? 0,
    failureCount: transactions.length - (resultCounts.SUCCESS ?? 0),
    incomingTinybar: incoming,
    outgoingTinybar: outgoing,
    netTinybar: incoming - outgoing,
    chargedFeeTinybar: fees,
    typeCounts,
    resultCounts,
    counterparties: counterpartyRows,
  };
}

export function createToolExecutors(mirror: MirrorClient, windowMinutes: number, now: () => number = Date.now) {
  const identity = async (accountId: string): Promise<ToolResult> => {
    const { data: account, source } = await mirror.getAccount(accountId);
    const balance = bigint(account.balance.balance);
    const accountAgeDays = ageDays(account.created_timestamp, now());
    return {
      toolId: "identity",
      generatedAt: new Date(now()).toISOString(),
      subject: accountId,
      summary: `${accountId} is ${account.deleted ? "deleted" : "active"} with ${tinybarToHbar(balance)} HBAR.`,
      data: {
        accountId,
        active: !account.deleted,
        balanceTinybar: balance.toString(),
        balanceHbar: tinybarToHbar(balance),
        accountAgeDays,
        createdTimestamp: account.created_timestamp,
        keyType: account.key?._type ?? null,
        evmAddress: account.evm_address,
        ethereumNonce: account.ethereum_nonce,
        receiverSignatureRequired: account.receiver_sig_required,
        stakedAccountId: account.staked_account_id,
        stakedNodeId: account.staked_node_id,
        pendingRewardTinybar: String(account.pending_reward ?? 0),
      },
      evidence: [{ label: "Hedera mainnet account record", url: source }],
      methodology: ["Direct Mirror Node account lookup", "Exact integer tinybar conversion", "No aggregator or off-chain identity database"],
    };
  };

  const flow = async (accountId: string): Promise<ToolResult> => {
    const { data: transactions, sources } = await mirror.getTransactions(accountId, windowMinutes);
    const metrics = flowMetrics(accountId, transactions);
    return {
      toolId: "flow",
      generatedAt: new Date(now()).toISOString(),
      subject: accountId,
      summary: `${metrics.transactionCount} transactions in ${windowMinutes} minutes; net ${tinybarToHbar(metrics.netTinybar)} HBAR.`,
      data: {
        windowMinutes,
        transactionCount: metrics.transactionCount,
        successCount: metrics.successCount,
        failureCount: metrics.failureCount,
        incomingTinybar: metrics.incomingTinybar.toString(),
        outgoingTinybar: metrics.outgoingTinybar.toString(),
        netTinybar: metrics.netTinybar.toString(),
        chargedFeeTinybar: metrics.chargedFeeTinybar.toString(),
        typeCounts: metrics.typeCounts,
        resultCounts: metrics.resultCounts,
        counterparties: metrics.counterparties,
      },
      evidence: sources.map((url, index) => ({ label: `Hedera mainnet transaction page ${index + 1}`, url })),
      methodology: ["All Mirror Node pages inside the configured time window", "Deduplicated by transaction id and nonce", "Counterparties ranked by absolute native-HBAR flow"],
    };
  };

  const risk = async (accountId: string): Promise<ToolResult> => {
    const [{ data: account, source: accountSource }, { data: transactions, sources }] = await Promise.all([
      mirror.getAccount(accountId),
      mirror.getTransactions(accountId, windowMinutes),
    ]);
    const metrics = flowMetrics(accountId, transactions);
    const accountAgeDays = ageDays(account.created_timestamp, now());
    const signals: { id: string; points: number; triggered: boolean; reason: string }[] = [
      { id: "deleted", points: 100, triggered: account.deleted, reason: "Account is deleted" },
      { id: "very-new", points: 25, triggered: accountAgeDays !== null && accountAgeDays < 7, reason: "Account is younger than 7 days" },
      { id: "new", points: 10, triggered: accountAgeDays !== null && accountAgeDays >= 7 && accountAgeDays < 30, reason: "Account is younger than 30 days" },
      { id: "high-failure-ratio", points: 25, triggered: metrics.transactionCount > 0 && metrics.failureCount * 4 > metrics.transactionCount, reason: "More than 25% of recent transactions failed" },
      { id: "receiver-signature", points: 5, triggered: account.receiver_sig_required, reason: "Receiver signature is required" },
      { id: "unknown-key", points: 15, triggered: !account.key?._type, reason: "No standard account key is exposed" },
    ];
    const score = Math.min(100, signals.filter(signal => signal.triggered).reduce((sum, signal) => sum + signal.points, 0));
    const verdict = score >= 75 ? "critical" : score >= 40 ? "high" : score >= 20 ? "guarded" : "low";
    return {
      toolId: "risk",
      generatedAt: new Date(now()).toISOString(),
      subject: accountId,
      summary: `Deterministic risk verdict: ${verdict.toUpperCase()} (${score}/100).`,
      data: {
        score,
        verdict,
        accountAgeDays,
        transactionCount: metrics.transactionCount,
        failureCount: metrics.failureCount,
        signals,
        disclaimer: "Heuristic evidence triage, not financial advice or proof of malicious control.",
      },
      evidence: [
        { label: "Hedera mainnet account record", url: accountSource },
        ...sources.map((url, index) => ({ label: `Hedera mainnet transaction page ${index + 1}`, url })),
      ],
      methodology: ["Published additive signal weights", "No hidden model or LLM judgment", "Score is capped at 100 and every triggered signal is returned"],
    };
  };

  return { identity, flow, risk };
}

export type ToolExecutors = ReturnType<typeof createToolExecutors>;
