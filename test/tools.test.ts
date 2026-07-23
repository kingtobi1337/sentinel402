import { describe, expect, it, vi } from "vitest";
import { MirrorClient } from "../src/mirror.js";
import { createToolExecutors } from "../src/tools.js";

const account = {
  account: "0.0.42",
  alias: null,
  balance: { balance: 123_456_789, timestamp: "1700000000.0" },
  created_timestamp: "1699395200.0",
  deleted: false,
  ethereum_nonce: 4,
  evm_address: "0x000000000000000000000000000000000000002a",
  key: { _type: "ECDSA_SECP256K1", key: "public" },
  memo: "",
  pending_reward: 0,
  receiver_sig_required: false,
  staked_account_id: null,
  staked_node_id: 3,
};

const transactions = [
  {
    transaction_id: "0.0.42-1-1",
    nonce: 0,
    name: "CRYPTOTRANSFER",
    result: "SUCCESS",
    charged_tx_fee: 10,
    consensus_timestamp: "1700000001.0",
    transfers: [
      { account: "0.0.42", amount: -1000 },
      { account: "0.0.99", amount: 1000 },
    ],
  },
  {
    transaction_id: "0.0.42-2-1",
    nonce: 0,
    name: "CONTRACTCALL",
    result: "FAIL_INVALID",
    charged_tx_fee: 20,
    consensus_timestamp: "1700000002.0",
    transfers: [
      { account: "0.0.42", amount: 500 },
      { account: "0.0.88", amount: -500 },
    ],
  },
];

function fetchMock(input: string | URL | Request) {
  const url = String(input);
  const body = url.includes("/accounts/") ? account : { transactions, links: { next: null } };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

describe("forensic tools", () => {
  const now = () => 1_700_000_000_000;
  const tools = createToolExecutors(new MirrorClient("https://mirror.test/api/v1", fetchMock as typeof fetch, now), 60, now);

  it("returns exact identity values with source evidence", async () => {
    const result = await tools.identity("0.0.42");
    expect(result.data.balanceHbar).toBe("1.23456789");
    expect(result.data.keyType).toBe("ECDSA_SECP256K1");
    expect(result.evidence[0]?.url).toContain("/accounts/0.0.42");
  });

  it("derives complete flow metrics from native transfer lists", async () => {
    const result = await tools.flow("0.0.42");
    expect(result.data).toMatchObject({ transactionCount: 2, successCount: 1, failureCount: 1, incomingTinybar: "500", outgoingTinybar: "1000", netTinybar: "-500" });
    expect(result.data.counterparties).toEqual([
      { account: "0.0.99", appearances: 1, incomingTinybar: "0", outgoingTinybar: "1000", totalTinybar: "1000" },
      { account: "0.0.88", appearances: 1, incomingTinybar: "500", outgoingTinybar: "0", totalTinybar: "500" },
    ]);
  });

  it("returns every deterministic risk signal and an inspectable score", async () => {
    const result = await tools.risk("0.0.42");
    expect(result.data.score).toBe(35);
    expect(result.data.verdict).toBe("guarded");
    expect(result.data.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "new", triggered: true, points: 10 }),
      expect.objectContaining({ id: "high-failure-ratio", triggered: true, points: 25 }),
    ]));
  });
});
