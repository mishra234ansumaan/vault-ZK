# Contributing to VaultZK Engine

Thanks for helping make over-sharing obsolete.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Before opening a PR run:

```bash
node scripts/test-zk.mjs        # real Groth16 prove/verify
npx next typegen && npx tsc --noEmit
npm run build
```

## Guidelines

* TypeScript strict, no `any`, no inline styles (Tailwind utilities; SVG attributes for dynamic geometry).
* Never add network calls that carry documents, proofs, keys or attributes. The privacy claim is the product.
* Every async path needs error handling and a loading state; every control needs an accessible name and a visible focus state.
* Changing a circuit? Re-run `scripts/setup-zk.mjs`, commit the new `public/zk/*` artifacts and update `docs/ZK-CIRCUITS.md` + the constraint counts in `src/lib/zk.ts`.
* Adding a Gemma tool? Update `TOOL_MANIFEST`, zod schemas, `SKILL.md` and `docs/GEMMA.md`.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:` …). Small focused PRs are easiest to review.

By contributing you agree that your contributions are licensed under the MIT License.
