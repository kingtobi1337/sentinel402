# Sentinel402

> Autonomous agents buy evidence, not subscriptions.

Sentinel402 is a Hedera-native x402 procurement agent for pay-per-result account forensics. It discovers narrowly priced tools, chooses the smallest evidence bundle that satisfies a goal and budget, pays every selected tool on Hedera testnet, and returns a machine-readable dossier with one HashScan receipt per purchased result.

[![CI](https://github.com/kingtobi1337/sentinel402/actions/workflows/ci.yml/badge.svg)](https://github.com/kingtobi1337/sentinel402/actions/workflows/ci.yml)

- **Live app:** https://sentinel402.iaped.in
- **Agent discovery:** https://sentinel402.iaped.in/llms.txt
- **OpenAPI:** https://sentinel402.iaped.in/openapi.json
- **Tool catalog:** https://sentinel402.iaped.in/api/catalog

## The idea

Most paid API demos put one endpoint behind a checkout. Sentinel402 demonstrates something harder: an autonomous buyer discovers a market of specialist tools, applies a deterministic procurement policy, makes multiple independent x402 purchases, and aggregates the paid outputs into one auditable decision.

The browser never receives a private key. The resource server never holds the facilitator key. Every protected result is buffered until Blocky402 verifies and settles the exact Hedera transfer.

## Real Hedera testnet proof

The canonical live E2E purchased all three tools through x402 v2 `exact` HBAR payments:

| Tool | Price | Transaction | Mirror result |
|---|---:|---|---|
| Identity Lens | 100,000 tinybar | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1784837688-343089555) | `SUCCESS`, receiver +100,000 |
| Flow Lens | 200,000 tinybar | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1784837695-405790134) | `SUCCESS`, receiver +200,000 |
| Risk Jury | 300,000 tinybar | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1784837698-470813065) | `SUCCESS`, receiver +300,000 |

Machine-readable evidence: [`artifacts/public/testnet-e2e.json`](artifacts/public/testnet-e2e.json).

Testnet participants:

- Autonomous buyer: [`0.0.9706295`](https://hashscan.io/testnet/account/0.0.9706295)
- Resource receiver: [`0.0.9706314`](https://hashscan.io/testnet/account/0.0.9706314)
- Blocky402 fee payer: [`0.0.7162784`](https://hashscan.io/testnet/account/0.0.7162784)

## Payment flight recorder

The UI visualizes the complete lifecycle of every purchase:

```text
catalog discovery
  -> budget policy
  -> GET paid tool
  -> HTTP 402 + PAYMENT-REQUIRED
  -> exact HBAR transfer signed server-side
  -> PAYMENT-SIGNATURE retry
  -> facilitator /verify
  -> facilitator /settle
  -> Hedera testnet SUCCESS
  -> HTTP 200 evidence
  -> HashScan receipt
```

A failed verification, settlement, evidence fetch, receiver mismatch, stale runtime, or budget check stops the run. Protected evidence is never accepted without a confirmed settlement receipt.

## Tool market

| Tool | Endpoint | Price | Output |
|---|---|---:|---|
| Identity Lens | `GET /api/tools/identity?account=0.0.x` | 100,000 tinybar | Account lifecycle, balance, key type and staking metadata |
| Flow Lens | `GET /api/tools/flow?account=0.0.x` | 200,000 tinybar | Complete paginated transaction window, native flow and counterparties |
| Risk Jury | `GET /api/tools/risk?account=0.0.x` | 300,000 tinybar | Published deterministic signals, score and verdict |

Tool evidence comes from Hedera mainnet Mirror Node, read-only. Payments settle separately on Hedera testnet as required by the bounty.

## Autonomous policies

| Depth | Purchased tools | Total |
|---|---|---:|
| `quick` | Identity | 100,000 tinybar |
| `standard` | Identity + Flow | 300,000 tinybar |
| `deep` | Identity + Flow + Risk | 600,000 tinybar |

The caller also supplies a hard budget. The policy fails before payment when the selected bundle exceeds that budget.

## Architecture

```text
Browser
  -> Sentinel API
      -> catalog + budget policy
      -> server-side x402 buyer
          -> paid tool route
              -> 402 challenge
          -> exact signed retry
              -> Blocky402 verify + settle
                  -> Hedera testnet
              -> paid evidence response
      -> payment flight recorder + HashScan receipts

Hedera mainnet Mirror Node -> deterministic evidence tools
```

Detailed design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## API

Free endpoints:

```text
GET  /api/health
GET  /api/catalog
GET  /api/runs/recent
POST /api/runs
GET  /api/runs/:id
GET  /llms.txt
GET  /openapi.json
```

Protected x402 endpoints:

```text
GET /api/tools/identity?account=0.0.x
GET /api/tools/flow?account=0.0.x
GET /api/tools/risk?account=0.0.x
```

Start an autonomous deep dossier:

```bash
curl -sS https://sentinel402.iaped.in/api/runs \
  -H 'content-type: application/json' \
  -d '{"account":"0.0.108869","depth":"deep","budgetTinybar":"600000"}'
```

Poll the URL in the `Location` response header until the run reaches `completed` or `failed`.

## Local setup

Requirements: Node.js 22, npm, a funded ECDSA Hedera testnet buyer account, and a separate receiver account.

```bash
git clone https://github.com/kingtobi1337/sentinel402.git
cd sentinel402
npm ci
cp .env.example .env
# Fill only server-side values in .env
npm run check
npm start
```

The `.env` file is ignored by Git and must remain mode `0600`.

Required runtime values:

```dotenv
HEDERA_NETWORK=hedera:testnet
FACILITATOR_URL=https://api.testnet.blocky402.com
PAY_TO_ACCOUNT=0.0.xxxx
HEDERA_BUYER_ACCOUNT_ID=0.0.yyyy
# Local development only:
HEDERA_BUYER_PRIVATE_KEY=...
# Production alternative; mutually exclusive with direct env:
# HEDERA_BUYER_PRIVATE_KEY_FILE=/run/secrets/sentinel402-buyer-key
PUBLIC_BASE_URL=http://127.0.0.1:4021
INTERNAL_BASE_URL=http://127.0.0.1:4021
```

## Verification

Offline gate:

```bash
npm run check
npm run e2e:mock
npm run secret:scan
npm audit --audit-level=high
```

Credentialed testnet gate against a running server:

```bash
npm run e2e:testnet
```

The live gate refuses to sign if `/api/health` reports the wrong network, wrong receiver, or an unavailable buyer. Successful runs write a secret-free artifact to `artifacts/public/testnet-e2e.json`.

## Security model

- Exact integer tinybar math; no floating-point payment amounts.
- Canonical Hedera account validation before payment middleware.
- Settlement-before-release through the official x402 Hono middleware.
- Browser receives neither private keys nor partially signed transactions.
- Receiver, network and buyer readiness are checked before live E2E signing.
- Mirror pagination rejects repeated links instead of looping.
- External reads have bounded timeouts and fail closed.
- Global demo cooldown and immutable maximum budget limit faucet drain.
- Commit-surface secret scanner checks tracked and non-ignored files.
- Docker runtime uses an unprivileged `sentinel` user.

## Technology

- [`@x402/core`](https://www.npmjs.com/package/@x402/core) 2.19.0
- [`@x402/hedera`](https://www.npmjs.com/package/@x402/hedera) 2.19.0
- [`@x402/hono`](https://www.npmjs.com/package/@x402/hono) 2.19.0
- [Hono](https://hono.dev/)
- [Hiero JavaScript SDK](https://github.com/hiero-ledger/hiero-sdk-js)
- [Blocky402 testnet facilitator](https://api.testnet.blocky402.com/supported)
- Hedera mainnet/testnet Mirror Node APIs

## Bounty

Built for the [Hedera x402 Bounty](https://hedera.com/x402-bounty/). The official Hedera x402 specification and implementation guide is available at [docs.hedera.com/solutions/ai/x402](https://docs.hedera.com/solutions/ai/x402).

## License

MIT
