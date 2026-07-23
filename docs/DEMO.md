# Sentinel402 demo script — target 3:30

Published demo: https://sentinel402.iaped.in/demo.html (final runtime: 3:50)

## 0:00–0:20 — Problem

Show the landing hero.

> APIs still sell subscriptions and API keys to humans. Autonomous agents need one fact, right now, and they need machine-verifiable proof that it was paid for.

## 0:20–0:45 — Product

Scroll to the live tool market.

> Sentinel402 is an autonomous procurement agent. It discovers three Hedera forensic specialists, applies a depth and budget policy, then buys only the evidence it needs.

Show Identity Lens, Flow Lens and Risk Jury with exact tinybar prices.

Briefly scroll through the eight-second protocol film. It previews the real flow without replacing the live payment proof: three evidence modules cross the verification gate and lock into one dossier.

## 0:45–1:05 — Protocol discovery

Open `/api/catalog`, `/llms.txt` and `/openapi.json` quickly.

> There is no signup and no API key. Another agent can discover the catalog and protocol surface directly.

## 1:05–2:20 — Live autonomous run

Use account `0.0.108869`, depth `deep`, budget `0.006 HBAR`. Click **Authorize autonomous run**.

Narrate the flight recorder:

1. Policy selects three tools for 600,000 tinybar.
2. First request receives HTTP 402.
3. Buyer signs the exact transfer server-side; key never reaches the browser.
4. Blocky402 verifies, sponsors the fee and settles on Hedera testnet.
5. Protected evidence returns only after settlement.
6. Repeat for all three tools.

Do not cut during settlement. The end-to-end wait is the proof.

## 2:20–2:55 — On-chain receipts

Open each HashScan receipt from the right-hand rail:

- Identity: https://hashscan.io/testnet/transaction/0.0.7162784-1784839766-309796545
- Flow: https://hashscan.io/testnet/transaction/0.0.7162784-1784839771-111800525
- Risk: https://hashscan.io/testnet/transaction/0.0.7162784-1784839773-705495394

Point out buyer `0.0.9706295`, receiver `0.0.9706314`, exact amounts, and `SUCCESS`.

## 2:55–3:20 — Hedera-specific value

Show architecture section.

> Hedera makes this viable because HBAR transfers have predictable low fees and deterministic finality. The facilitator fee-payer model means the merchant holds no gas key and the buyer authorizes only the exact value transfer.

## 3:20–3:30 — Close

> Sentinel402 turns HTTP 402 into an auditable market for agent labor: discover, decide, pay, prove.

Show live URL and public GitHub repo.
