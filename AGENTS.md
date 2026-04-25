<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# zk-hires - Architecture Context for Coding Agents

## What this is

A ZK credential system for hiring. Candidates prove hackathon wins; employers prove company legitimacy. Both proofs are ZK credentials signed by a BabyJubjub issuer keypair and verified on-chain without revealing underlying data.

This is simultaneously a hackathon submission and a live pilot with a hiring company. Scope is intentionally narrow: **one data point per portal per flow**.

## Two flows

### Candidate flow (`claim_type: "hackathon_wins"`)
1. Upload one certificate (PDF or image)
2. Claude vision OCR extracts: `organizer_name`, `event_name`, `candidate_name`, `year`
3. Organizer profile lookup enriches the Evidence with social presence data
4. Reviewer derives a `HackathonWinsFinding` with `count` and `confidence_tier`

### Employer flow (`claim_type: "reputable_company"`)
1. Companies House lookup (by company number) + Crunchbase lookup (by slug/URL) run in parallel
2. Two Evidence records emitted
3. Reviewer derives a `ReputableCompanyFinding` with `bracket_at_least` and `jurisdiction: "uk"`

## Known architectural gaps - do not paper over these

**Crunchbase is hardcoded as required in the employer flow.** `claim-derivation.ts:84` checks `source === "crunchbase"` - if absent, a Gap is returned. The original design intent is that the employer shares *any* URL (their own site, a news article, LinkedIn, Crunchbase if they have it) and the agent does due diligence on whatever is provided. The fix: replace `crunchbase.ts` with a `web-lookup.ts` source powered by autobrowser + Claude extraction; rename `crunchbaseSlugOrUrl` → `supplementaryUrl` in `ResearcherInput`; change `EvidenceSchema.source` from `"crunchbase"` to `"web_lookup"`. **Do not add new Crunchbase-specific logic.**

**Multi-win aggregation requires cross-run accumulation.** The Reviewer (`claim-derivation.ts`) CAN produce `count > 1` if passed multiple certificate Evidence records. But the Researcher still processes one certificate per run with an isolated `runId`. There is no mechanism to collect evidence across runs and pass it to the Reviewer in one batch. This needs a session/basket concept upstream.

**Issuer only processes `findings[0]`.** `issuer/index.ts:56` takes `findings[0]` and ignores the rest. If a candidate has multiple findings (e.g. from batched evidence), only the first is issued a credential.

**CH confidence tier is binary.** `companies-house.ts:80` maps `active` → `very_high`, everything else → `low`. Statuses like `dormant` or `voluntary-arrangement` should be `medium`.

**`ISSUER_PRIV_KEY` is now required.** Phase 4 (`src/issuer/`) is in-flight and `issueCredential` throws immediately if `ISSUER_PRIV_KEY` is missing or < 32 chars. Generate keypair with: `npx tsx scripts/generate-issuer-key.ts` and paste both values into `.env`.

## Key types (read these before touching the schema)

| File | Purpose |
|---|---|
| `src/types/evidence.ts` | One Evidence record per atomic source signal |
| `src/types/finding.ts` | Discriminated union: `hackathon_wins` or `reputable_company` |
| `src/types/credential.ts` | Issuer-signed payload before ZK proof gen (Phase 4) |
| `src/types/gap.ts` | Emitted by Reviewer when confidence threshold not met |
| `src/trace/store.ts` | SQLite trace event store - every external call bookended |

## Credentials in use

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude vision for certificate OCR |
| `COMPANIES_HOUSE_API_KEY` | REST key, production endpoint |
| `COMPANIES_HOUSE_BASE_URL` | `https://api.company-information.service.gov.uk` |
| `ISSUER_PRIV_KEY` / `ISSUER_PUB_KEY` | BabyJubjub keypair - **required now**. Run `npx tsx scripts/generate-issuer-key.ts` to generate. |

## Phase status (as of session 2026-04-25)

- Phase 1: Zod schemas + SQLite trace store - **complete**
- Phase 2: Researcher sources (certificate, companies-house, crunchbase, organizer-profile) - **complete**
- Phase 3: Reviewer agent (reputability-scorer, claim-derivation, cite-or-drop) - **complete**
- Phase 4: ZK proof generation (Noir circuit in `circuit/main.nr`, EdDSA + Poseidon in `src/issuer/`, key gen script) - **in progress / untracked**

## Anti-hallucination scaffolding (project-barcelona)

The security layer for agent evidence pipelines is adapted from [project-barcelona](https://github.com/carlosml23/project-barcelona). Three layers apply here:

| Layer | Barcelona pattern | Our implementation |
|---|---|---|
| **Scoring** | Every search hit scored against known fields; authority bonus for official sources | `reputability-scorer.ts` - 6 binary signals; `very_high` tier for active CH records (official registry) |
| **Verification gate** | Hard filter: only evidence with `score >= 0.5` or `high`/`very_high` confidence reaches the synthesiser | `claim-derivation.ts` - only `high`/`very_high` certs reach `deriveCandidateFinding`; CH must be `very_high` for employer flow |
| **Citation enforcement** | Post-synthesis: `enforceCitations()` checks every `evidence_id` in every finding against real verified evidence; entire finding dropped if any ID doesn't resolve | `cite-or-drop.ts:enforceCitations()` - identical pattern, implemented |

**Still to adopt from the scaffolding:**
- **Two-model split**: Barcelona uses Sonnet for synthesis and Haiku for discovery/refinement. Our certificate OCR currently uses Opus for everything - splitting would cut cost significantly
- **Firecrawl for JS-rendered pages**: Barcelona uses Firecrawl as the scraping layer for JS-heavy pages. Relevant once the `web-lookup` source replaces Crunchbase - Firecrawl handles pages autobrowser would struggle with
- **Authority weighting per source**: Barcelona applies authority bonuses per source type. We have binary `very_high`/`low` on CH status - a weighted score across source authority (official registry > company website > news > social) would improve the employer flow

## Product spec - what needs to be built

### User flows (single app, two portals)

**Candidate portal** (`/candidate`)
1. Upload a hackathon certificate (PDF or image, max 10MB)
2. App runs the full candidate flow: OCR → organizer profile → Reviewer → Issuer
3. On success: display proof code (`ZKH-XXXX-XXXX`) with a copy button and explanation
4. On gap (low confidence): show what was missing and why, invite re-upload

**Employer portal** (`/employer`)
1. Enter Companies House number + any supporting URL (their site, news article, LinkedIn, etc.)
2. App runs the full employer flow: CH lookup + web-lookup → Reviewer → Issuer
3. On success: display credential summary (company name, funding bracket, jurisdiction) + proof code
4. On gap: explain what evidence was insufficient

**Verify portal** (`/verify/[code]`)
- Public page: anyone pastes a proof code, sees the public claims (claim_type, claim_value, issuer_pubkey)
- No auth required - this is the employer-facing check to validate a candidate's code
- Shows: claim type, value, issued date, whether the credential is still valid (not expired)

### API routes to build

| Route | Method | Purpose |
|---|---|---|
| `/api/issue/candidate` | POST | Multipart form: `file` (certificate) → returns `{ proof_code, public_claims }` or `{ gap }` |
| `/api/issue/employer` | POST | JSON: `{ companyNumber, supplementaryUrl }` → returns `{ proof_code, public_claims }` or `{ gap }` |
| `/api/verify/[code]` | GET | Returns `{ public_claims, issued_at, expires_at }` or 404 |

All routes stream progress events via SSE so the UI can show live status (OCR in progress, Companies House lookup, etc.) - follow the Barcelona pattern for SSE streaming.

### Credential storage

Issued credentials must be persisted in SQLite (same `data/traces.db`, same `better-sqlite3` instance). Add a `credentials` table:

```sql
CREATE TABLE IF NOT EXISTS credentials (
  proof_code TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL,
  claim_value TEXT NOT NULL,
  proof_json TEXT NOT NULL,
  public_claims TEXT NOT NULL,
  nullifier TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)
```

The `GET /api/verify/[code]` route queries this table. No other persistence layer is needed for the MVP.

### Dev commands

```bash
pnpm dev          # start Next.js dev server on :3000
pnpm test         # vitest (or jest) - run all tests
pnpm build        # production build
npx tsx scripts/generate-issuer-key.ts  # generate ISSUER_PRIV_KEY + ISSUER_PUB_KEY
```

### Definition of "working" for the hackathon demo

1. Candidate uploads a real hackathon certificate → receives a proof code
2. Employer submits their Companies House number + website URL → receives a proof code
3. Either party navigates to `/verify/[code]` and sees the verified public claims
4. All three steps complete without errors, with the full evidence trail in SQLite

On-chain verification is out of scope for the demo. The ZK proof placeholder is acceptable.

## Phase 4 notes

- ZK proof generation falls back to `{ proof: [], publicInputs: [], placeholder: true }` if the Noir circuit bytecode isn't ready - issuance still succeeds during dev
- Nullifier replay defence is live: `Poseidon(subject_privkey, claim_type)` persisted in the same SQLite DB as traces
- Compiled circuit artifact lives at `circuit/target/prove_credential.json`
