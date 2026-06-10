# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The web face of [mutato](https://github.com/craigtrim/mutato), a Python entity-extraction library with no LLM in the loop. Three subprojects that ship together:

- `frontend/` — Vite 5 + React 18 SPA deployed to `s3://cosc-demos-069163481355/mutato/` on COSC. In-browser ontology editor + extract UI.
- `lambda/` — `mutato-extractor` Docker Lambda (Python 3.11 **x86_64**, `us-west-2`). Compiles user-edited TTL on-the-fly and runs mutato's three matching passes.
- `ontologies/` — OWL/Turtle source of truth + a build script that compiles the TTL into an MDA JSON dict consumed by both the frontend tree and the Lambda parser.

Live URL: <https://craigtrim.com/demos/mutato/>. Lambda endpoint: `https://340cnsxykj.execute-api.us-west-2.amazonaws.com/prod/mutato_extractor_post`.

## Architecture: the round-trip

Understanding one extract click is the fastest way into this codebase:

1. **Frontend** keeps a source-shape entity dict (`{ namespace, entities: { [name]: {kind, label, parent, altLabels, inflections, order?} } }`) in React state. See [frontend/ontology-model.js](frontend/ontology-model.js).
2. On Extract, the editor serializes the entity dict to TTL via `entitiesToTtl()` and POSTs `{ text, ontology_ttl }` to the Lambda (or `{ text, ontology: "lotr" }` when nothing has been edited yet).
3. **Lambda** ([lambda/lambda_function.py](lambda/lambda_function.py)) either looks up a pre-baked parser by id or compiles the inline TTL with `mutato.api.OntologyParser`. Inline parsers are hash-keyed (SHA-256 of TTL) and held in an LRU `OrderedDict` of 20 entries — repeat extracts on the same edited ontology are warm.
4. Lambda returns `{ ontology, tokens, matches, stats }`. `tokens` is the full mutato token list; `matches` is a flattened ledger built by `_summarize()`.
5. Frontend highlights spans in the input text using `start`/`end` offsets from `matches`, with color per match type (`exact`/`span`/`hierarchy`). See `MATCH_TYPE_COLORS` in [frontend/app.jsx](frontend/app.jsx).

Key invariant: mutato/spaCy normalize whitespace before computing offsets, so the frontend pre-normalizes via `normalizeWhitespace()` before sending text — otherwise highlighted spans drift by N chars for each run of N+1 whitespace.

## The ontology pipeline

The OWL file is the source of truth. The MDA JSON is a derived artifact written to **three** locations by one build:

```
ontologies/lotr-mutato.owl                  # hand-authored (skos:altLabel, :inflection)
        │  pip install -r requirements.txt
        │  python mutato-build.py
        ▼
ontologies/lotr-mutato.json                 # canonical artifact
frontend/public/data/lotr.json              # consumed by left-rail tree (fallback when no edits)
lambda/ontologies/lotr.json                 # baked into the Docker image
```

After editing the OWL: rerun `mutato-build.py`, then `lambda/update.sh`, then redeploy the frontend.

## Common commands

### Frontend
```bash
cd frontend
npm install
npm run dev                                  # local dev server (Vite)
npm run build                                # production bundle -> dist/
aws s3 sync dist/ s3://cosc-demos-069163481355/mutato/ --profile cosc_s3
```

### Lambda
```bash
cd lambda
./update.sh                                  # build linux/amd64 image, push to ECR, update function
```
The script auto-bumps the patch version above the latest ECR tag. AWS profile: `cosc_lambda`. Region: `us-west-2`. Account: `069163481355` (COSC). It creates the ECR repo, repo policy, and log group, then creates-or-updates the function. The frontend is served from the COSC CloudFront distribution; the API base lives in `frontend/public/cosc-config.js` (issue #175).

### Ontology rebuild
```bash
cd ontologies
pip install -r requirements.txt              # mutato>=1.1.1, rdflib
python mutato-build.py                       # rewrites all three JSON targets
```

## Things that will bite you

- **x86_64, not arm64.** mutato pins spaCy 3.8.2 which publishes no Linux aarch64 wheels and the slim AL2 base has no gcc. The Lambda is `linux/amd64`; do not change this in the Dockerfile or `update.sh`.
- **Cold start ~2.5–3.5s, warm <500ms.** Most of it is `MutatoAPI.__init__` loading `en_core_web_sm`. The frontend shows a "warming up..." hint after 600 ms of loading.
- **Origin allow-list is enforced server-side.** `ALLOWED_ORIGINS = {"https://craigtrim.com"}`. Requests with no `Origin` header or a non-matching one get `403`. Rejected origins receive no `Access-Control-Allow-Origin`, so browsers block the response. CLI clients can spoof Origin — this is defense in depth, not a security boundary.
- **Request limits:** text ≤ 5000 chars (413), inline TTL ≤ 400,000 chars (413). Valid pre-baked ontology ids: `lotr`, `oilgas` (1024 entities, Oil & Gas), `healthcare` (8192 entities, Urgent Care). The healthcare and oilgas ontologies are too large to round-trip as inline TTL — they exceed the 400,000-char cap, so editing them in the demo and clicking Extract will 413. Demo treats this as a known limitation; the un-edited path uses the baked `ontology` id and works fine.
- **`tokens` vs `matches`.** mutato returns rich token dicts; the Lambda projects them to a flat match ledger via `_summarize()`. Note that mutato returns canonical names lowercased — the frontend keeps a `canonToLabel` map to surface proper-case labels in tooltips and the ledger.
- **Match-type key alias.** mutato sometimes returns `spans` (plural) for span-pass matches; `MATCH_TYPE_COLORS` includes both `span` and `spans` for forward compatibility.
- **TTL ontology declaration must be prefixed, not a full IRI.** `entitiesToTtl` emits `:CustomOntology a owl:Ontology`, not `<https://…> a owl:Ontology`. Mutato's entity-discovery SPARQL substitutes the discovered name into `:#ENTITY` for the child query; that substitution only works for prefixed names. Full IRIs collapse into invalid SPARQL like `:https://…`. See the comment block above `entitiesToTtl` in [frontend/ontology-model.js](frontend/ontology-model.js).
- **No test/lint/typecheck in the frontend.** `package.json` only defines `dev`, `build`, `preview` — Vite + React, no Vitest, no ESLint, no TypeScript. If you change frontend code, verify in the browser (or with the live curl smoke test in [lambda/README.md](lambda/README.md)); do not claim a test suite passed.
- **No local Lambda harness.** The integration smoke test is the curl example in [lambda/README.md](lambda/README.md) against the live endpoint (expected: 4 matches with mixed types). There is no `pytest`, no SAM/local invoke wired up.

## RTK (token-optimized commands)

Per the user's global instructions, prefix shell commands with `rtk` (e.g. `rtk git status`, `rtk npm run build`). If RTK has a filter for the command it applies it; otherwise it passes through unchanged, so it's always safe.
