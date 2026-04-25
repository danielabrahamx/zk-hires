# ZK Hires

Zero-knowledge credential portal for confidential senior recruitment.

Candidates prove hackathon wins without revealing which certificates they hold. Employers prove company legitimacy without revealing their funding details. Both flows produce a shareable `ZKH-XXXX-XXXX` proof code verifiable by any third party — no documents exchanged.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  /candidate  →  file upload  →  POST /api/issue/candidate       │
│  /employer   →  CH# + URL    →  POST /api/issue/employer        │
│  /verify/[code]              →  GET  /api/verify/[code]         │
│  /trace/[run_id]             →  server component (SQLite read)  │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  API Routes (Next.js)                                           │
│                                                                 │
│  Researcher agent                                               │
│    candidate: certificate OCR (Claude vision) + organizer       │
│               profile lookup (web_search)                       │
│    employer:  Companies House REST + web-lookup (autobrowser)   │
│                                                                 │
│  Reviewer agent                                                 │
│    6-signal reputability scoring (0–6) per Evidence             │
│    Barcelona cite-or-drop: findings dropped if uncited          │
│    Derives HackathonWinsFinding / ReputableCompanyFinding       │
│                                                                 │
│  Issuer service                                                 │
│    EdDSA sign (BabyJubjub) + Poseidon hash                      │
│    ZK proof via Noir circuit + @aztec/bb.js                     │
│    Replay protection: nullifier stored in SQLite                │
│                                                                 │
│  SQLite (data/traces.db)                                        │
│    traces table: every agent action bookended                   │
│    credentials table: issued credentials keyed by proof_code    │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node | 22+ | |
| pnpm | latest | `npm install -g pnpm` |
| nargo | 1.0.0-beta.20 | `noirup -v 1.0.0-beta.20` (Git Bash on Windows) |
| Anthropic API key | — | Needs `web_search` server tool enabled in Anthropic Console |
| Companies House API key | free | Register at developer.company-information.service.gov.uk |

## Setup

```bash
# 1. Clone and install
git clone https://github.com/danielabrahamx/zk-hires.git
cd zk-hires
pnpm install

# 2. Copy env template and fill in values
cp .env.example .env
# Edit .env: ANTHROPIC_API_KEY, COMPANIES_HOUSE_API_KEY, ISSUER_PRIV_KEY, ISSUER_PUB_KEY

# 3. Generate issuer keypair (first time only)
npx tsx scripts/generate-issuer-key.ts
# Paste the output into .env as ISSUER_PRIV_KEY and ISSUER_PUB_KEY

# 4. Compile Noir circuit (requires nargo)
cd circuit && nargo compile && cd ..

# 5. Install Playwright browsers
npx playwright install chromium
```

## Dev commands

```bash
pnpm dev          # start Next.js dev server on :3000
pnpm build        # production build
pnpm test         # vitest unit tests (78 tests, ~4s)
pnpm test:e2e     # Playwright end-to-end tests
```

## Demo flow

### Candidate flow
1. Go to `/candidate`
2. Upload a hackathon certificate (PDF or image, max 10MB)
3. The app OCRs it with Claude vision, scores organiser reputability across 6 signals, and issues a ZK credential if score ≥ 4
4. Copy the `ZKH-XXXX-XXXX` code and share it with an employer
5. Employer visits `/verify/ZKH-XXXX-XXXX` to confirm the claim without seeing the certificate

### Employer flow
1. Go to `/employer`
2. Enter Companies House number + any supporting URL (website, news article, LinkedIn, Crunchbase)
3. The app verifies the company via the CH registry and analyses the URL for funding signals
4. A `ZKH-XXXX-XXXX` code is issued if the company is active and funding evidence meets the threshold

### Verify flow
1. Any party visits `/verify/ZKH-XXXX-XXXX`
2. Sees claim type, claim value, issued date, expiry, and issuer public key
3. No backend call needed — all data comes from the stored credential

## Env vars

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Claude API key with web_search enabled |
| `COMPANIES_HOUSE_API_KEY` | yes | — | UK Companies House REST API key |
| `COMPANIES_HOUSE_BASE_URL` | no | production endpoint | Switch to sandbox for testing |
| `ISSUER_PRIV_KEY` | yes | — | BabyJubjub scalar (64-char hex); generate with `npx tsx scripts/generate-issuer-key.ts` |
| `ISSUER_PUB_KEY` | yes | — | Derived from ISSUER_PRIV_KEY; published so verifiers can check proofs |
| `REPUTABILITY_THRESHOLD` | no | `4` | Min score (0–6) for high confidence tier |
| `FUNDING_BRACKET_THRESHOLD` | no | `500k_2m` | Minimum funding bracket for employer flow |

## ZK circuit

The Noir circuit lives at `circuit/src/main.nr`. It proves:
- The subject holds a private key whose public key the issuer signed
- The nullifier `Poseidon(subject_privkey, claim_type)` is computed correctly (replay protection)

Public inputs: `issuer_pubkey_x`, `issuer_pubkey_y`, `claim_type`, `claim_value`, `nullifier`

Compile: `cd circuit && nargo compile` → produces `circuit/target/prove_credential.json`
