import { describe, expect, it, vi } from "vitest";
import { MirrorClient, MirrorError } from "../src/mirror.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("MirrorClient", () => {
  it("fetches every pagination page and deduplicates transaction rows", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("page=2")) {
        return response({
          transactions: [
            { transaction_id: "0.0.1-2-000000001", nonce: 0, name: "CRYPTOTRANSFER", result: "SUCCESS", charged_tx_fee: 1, consensus_timestamp: "2.1", transfers: [] },
          ],
          links: { next: null },
        });
      }
      return response({
        transactions: [
          { transaction_id: "0.0.1-1-000000001", nonce: 0, name: "CRYPTOTRANSFER", result: "SUCCESS", charged_tx_fee: 1, consensus_timestamp: "1.1", transfers: [] },
          { transaction_id: "0.0.1-1-000000001", nonce: 0, name: "CRYPTOTRANSFER", result: "SUCCESS", charged_tx_fee: 1, consensus_timestamp: "1.1", transfers: [] },
        ],
        links: { next: "/api/v1/transactions?page=2" },
      });
    });
    const client = new MirrorClient("https://mirror.test/api/v1", fetchMock as typeof fetch, () => 1_700_000_000_000);
    const result = await client.getTransactions("0.0.1", 60);
    expect(result.data.map(tx => tx.transaction_id)).toEqual(["0.0.1-1-000000001", "0.0.1-2-000000001"]);
    expect(result.sources).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated pagination links instead of looping", async () => {
    const fetchMock = vi.fn(async () => response({ transactions: [], links: { next: "/api/v1/transactions?page=repeat" } }));
    const client = new MirrorClient("https://mirror.test/api/v1", fetchMock as typeof fetch, () => 1_700_000_000_000);
    await expect(client.getTransactions("0.0.1", 60)).rejects.toThrow("repeated pagination link");
  });

  it("reports upstream status without echoing response bodies", async () => {
    const client = new MirrorClient("https://mirror.test/api/v1", vi.fn(async () => response({ secret: "do-not-echo" }, 503)) as typeof fetch);
    const error = await client.getAccount("0.0.1").catch(value => value);
    expect(error).toBeInstanceOf(MirrorError);
    expect(error.message).toBe("Mirror returned HTTP 503");
    expect(error.message).not.toContain("do-not-echo");
  });
});
