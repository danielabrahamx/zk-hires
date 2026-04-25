# ZK Hires

ZK verification portal for confidential senior recruitment. Candidates prove hackathon wins; employers prove company reputability — both via zero-knowledge proofs that reveal only the verified claim, not the underlying evidence.

## Prerequisites

- Node 22+
- pnpm
- nargo 1.0.0-beta.20
- Anthropic API key (with web_search server tool enabled)
- Companies House API key (free, register at https://developer.company-information.service.gov.uk)

## Commands

- `pnpm dev` - start the dev server
- `pnpm build` - production build
- `pnpm test` - run vitest unit tests
- `pnpm test:e2e` - run Playwright end-to-end tests

## Links

- Design spec: `C:/Users/danie/SibroxVault/wiki/specs/2026-04-25-zk-hires-design.md`
- Implementation plan: `C:/Users/danie/SibroxVault/wiki/specs/2026-04-25-zk-hires-plan.xml`
