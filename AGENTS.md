# Sentinel402 — Agent Instructions

## Mission
Build a competition-grade Hedera x402 application. The product must demonstrate a real `402 -> signed Hedera transfer -> facilitator settlement -> 200` flow on Hedera testnet and surface HashScan proof.

## Hard rules
- TypeScript, ESM, Node.js 22.
- English code, tests, UI, and public documentation.
- Pin security-sensitive payment dependencies exactly.
- Never commit `.env`, private keys, payer credentials, or raw signed payment payloads.
- Payment settlement must succeed before protected data is returned.
- All amounts are integer tinybars. No floating-point payment math.
- Mainnet is read-only evidence; all bounty payments settle on Hedera testnet.
- Validate account/token/transaction identifiers before network requests.
- Bound every external request with a timeout.
- No generic catch-and-ignore around payment or evidence collection.
- Add or update tests for every non-trivial behavior.

## Required gate
```bash
npm run check
npm run e2e:mock
npm run secret:scan
```

Real testnet E2E is a separate, credentialed gate:
```bash
npm run e2e:testnet
```
