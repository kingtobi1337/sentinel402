# Sentinel402 — Product & Architecture

## Product thesis
Autonomous agents should buy evidence, not subscriptions. Sentinel402 is a machine-to-machine procurement agent for Hedera forensics: it discovers narrowly priced tools, selects only the evidence required for a goal and budget, pays each tool through x402 on Hedera testnet, then returns a cited dossier with one HashScan receipt per purchased result.

## Competition demo
1. A user asks for a forensic dossier on a Hedera account.
2. Sentinel discovers three independent paid tools and their exact tinybar prices.
3. Its policy engine selects the smallest sufficient bundle within budget.
4. Each tool first returns HTTP 402.
5. The agent signs the payment without exposing its private key to the UI.
6. Blocky402 verifies and settles the transfer on Hedera testnet.
7. The same request returns HTTP 200 only after settlement.
8. The UI renders the evidence, policy decision, timing waterfall and HashScan links.

## Tool market
- **Identity Lens** — account metadata and balance snapshot.
- **Flow Lens** — bounded recent transfer and counterparty analysis.
- **Risk Jury** — transparent deterministic risk signals and verdict.

All tools analyze public Hedera mainnet data read-only. Payment rails are Hedera testnet as required by the bounty.

## Runtime architecture
```text
Browser -> Sentinel API -> Agent Run Queue
                         -> Catalog + Budget Policy
                         -> x402 Client (server-side delegated signer)
                              -> Paid Tool Route
                                   -> HTTP 402 PaymentRequirements
                              -> signed retry
                                   -> Blocky402 /verify + /settle
                                   -> Hedera testnet transfer
                                   -> HTTP 200 evidence
                         -> Receipt Store -> Browser polling UI
Mainnet Mirror Node ---------------------------------> evidence providers
```

## Security boundaries
- Browser never receives a private key or a partially signed transaction.
- Resource routes have no Hedera key; they only know the receiver account ID.
- The buyer key exists only in server-side environment variables.
- Blocky402 sponsors fees and submits the buyer-authorized transfer.
- Demo runs are globally and per-client rate limited and have an immutable tinybar budget cap.
- No protected result is created until settlement succeeds.

## API surface
- `GET /api/health`
- `GET /api/catalog`
- `GET /api/runs/recent`
- `POST /api/runs`
- `GET /api/runs/:id`
- `GET /api/tools/identity?account=0.0.x` (x402 protected)
- `GET /api/tools/flow?account=0.0.x` (x402 protected)
- `GET /api/tools/risk?account=0.0.x` (x402 protected)
- `GET /llms.txt`
- `GET /openapi.json`

## Deployment
One hardened Docker image, one Hono process, static frontend served from the same origin. Coolify deploys the GitHub repository with the Dockerfile and injects server-only environment variables.

## Explicit scope cuts
- HBAR only for the bounty build; HTS/USDC remains protocol-compatible but is not part of the demo.
- No wallet-connect UI; this is an autonomous machine buyer, not a checkout page.
- No database; bounded in-memory run history is sufficient for the live demo. Restart persistence is documented as a production upgrade.
- No LLM dependency; evidence and risk scoring are deterministic, inspectable and reproducible.
