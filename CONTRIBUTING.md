# Contributing

## Crunchbase ToS caveat

`src/agents/researcher/sources/crunchbase.ts` uses Playwright to scrape public Crunchbase pages. Crunchbase ToS prohibits scraping. This is acceptable for a hackathon demo. **Before any commercial deployment**, replace it with a licensed Crunchbase Basic API subscription or an alternative data provider.

## Companies House API key

The employer flow requires a free UK Companies House API key. Register at developer.company-information.service.gov.uk. The sandbox base URL (`https://api-sandbox.company-information.service.gov.uk`) is set in `.env.example` for development; production uses the live endpoint.

## Issuer key custody

`ISSUER_PRIV_KEY` is a BabyJubjub scalar. Whoever holds it can issue credentials. For production:

- Store it in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Do not commit it to git — `.env` is gitignored
- Rotate it by generating a new keypair and publishing the new `ISSUER_PUB_KEY`; old credentials issued under the previous key become unverifiable

## Architecture notes

See `AGENTS.md` for known gaps (multi-win aggregation, CH confidence tier granularity, Issuer only processes first finding). These are documented technical debt for v2.

## Test requirements

- All unit tests must pass: `pnpm test` must exit 0
- All E2E tests must pass: `pnpm test:e2e` must exit 0
- Do not skip or stub failing tests — diagnose and fix
