# Smoke tests

Ten atomic Playwright tests against the deployed demo at <https://d1417qhlp96qo6.cloudfront.net/mutato/>. Each test asserts one invariant. No shared state, no fixtures.

## Setup (one-time)

```bash
cd smoke
npm install
npx playwright install chromium
```

## Run

```bash
npm test                          # all 10, headless
npm run test:headed               # watch in a real browser
npm run test:debug                # step through interactively
npx playwright test 04-extract    # run one by filename match
```

Override the target URL:

```bash
SMOKE_URL=https://staging.example.com/mutato/ npm test
```

## Tests

| # | File | Proves |
|---|---|---|
| 1 | `01-page-renders` | Site is up, JS bundle loaded, React mounted. |
| 2 | `02-tree-populated` | `/data/lotr.json` fetched + parsed + rendered. |
| 3 | `03-default-sample-present` | Default sample seeded into textarea. |
| 4 | `04-extract-returns-matches` | Lambda reachable, CORS passes, ledger renders. |
| 5 | `05-spans-highlighted` | `HighlightedText` offset wiring intact. |
| 6 | `06-ontology-selector-swaps-tree` | Ontology switch repaints tree end-to-end. |
| 7 | `07-reset-disabled-unedited` | Edit-tracking baseline starts correct. |
| 8 | `08-char-counter-updates` | Textarea ↔ state binding live. |
| 9 | `09-tree-search-filters` | Search filter wired to virtualized tree. |
| 10 | `10-tree-expand-collapse` | Open/closed state toggles render. |

## Run from repo root

```bash
./scripts/deploy.sh                 # build + sync + smoke
./scripts/deploy.sh --smoke-only    # just smoke the current live site
./scripts/deploy.sh --no-smoke      # build + sync, skip smoke
```

## Conventions

- **Selectors are text/role-based.** No `data-testid` exists in the app — adding testids is a deliberate deferred decision; do not add them reactively to fix one flaky test.
- **Cold-start budget**: Test #4 uses a 20s timeout (default Lambda cold start is 2.5–3.5s + buffer).
- **413 trap**: Test #6 only switches the selector to `oilgas`; it does **not** click Extract, because the oilgas TTL exceeds the Lambda's 400 KB inline-TTL cap.

## On failure

Playwright writes a trace to `test-results/<test>/trace.zip` (configured via `trace: 'retain-on-failure'`). Open it:

```bash
npx playwright show-trace test-results/<test>/trace.zip
```
