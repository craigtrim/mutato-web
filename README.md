# mutato-web

Web frontend, Lambda backend, and ontology source for the live ontology-driven entity-extraction demo at **https://craigtrim.com/demos/mutato/**.

The matching engine is [mutato](https://github.com/craigtrim/mutato), a Python library for ontology-driven NLP with no LLM in the loop. This repo contains everything that runs around it on the web side.

## Layout

```
mutato-web/
├── frontend/         Vite 5 + React 18 demo with in-browser ontology editor
├── lambda/           AWS Lambda (Python 3.11 x86_64) that compiles user-edited
│                     TTL on-the-fly and runs mutato over arbitrary input text
└── ontologies/       LOTR-Mutato OWL source + Python build script that compiles
                      the TTL into the MDA JSON consumed by both frontend and lambda
```

## Frontend

Three-pane editor: ontology tree (with drag-and-drop reorder, right-click context menu, edge-sensor auto-scroll, Esc-cancel) on the left, free-form text input in the middle, provenance ledger on the right. The user can edit the ontology in the browser (add/remove classes and instances, edit alt labels and inflections, reparent via drag, reorder siblings), then click Extract to see entity matches in real time. Each click serializes the edited entity dict to TTL and sends it to the Lambda for live compilation and matching.

```bash
cd frontend
npm install
npm run dev          # local dev server
npm run build        # production bundle -> dist/
aws s3 sync dist/ s3://cosc-demos-069163481355/mutato/ --profile cosc_s3
```

## Lambda

`mutato-extractor` Lambda. Accepts a pre-baked ontology id OR an inline TTL string and runs mutato's three matching passes (exact, span, hierarchy). Hash-keyed LRU cache (20 entries) on inline TTLs so repeated extracts on the same edited ontology are warm. Origin allow-list enforcement (`https://craigtrim.com`) for defense in depth — see issue #1.

```bash
cd lambda
./update.sh          # build + push image + update function
```

| Resource | Value |
|---|---|
| Function | `mutato-extractor` |
| Region | `us-west-2` |
| ECR repo | `mutato-extractor-repo` |
| API Gateway ID | `340cnsxykj` |
| Stage / path | `prod` / `POST /mutato_extractor_post` |
| Architecture | x86_64 (mutato pins spaCy 3.8.2 which has no Linux aarch64 wheel) |

Endpoint: `https://340cnsxykj.execute-api.us-west-2.amazonaws.com/prod/mutato_extractor_post`.

## Ontologies

Source of truth for the demo's Middle-earth ontology. `lotr-mutato.owl` is hand-authored OWL/Turtle with mutato-specific annotations (`skos:altLabel`, `:inflection`). The Python script compiles it into the MDA JSON dict both the frontend tree and the Lambda parser consume.

```bash
cd ontologies
pip install -r requirements.txt    # mutato, rdflib
python mutato-build.py             # writes:
#   ./lotr-mutato.json                  (canonical artifact)
#   ../frontend/public/data/lotr.json   (left-rail tree, fallback when no edits)
#   ../lambda/ontologies/lotr.json      (Lambda pre-baked bundle)
```

Rerun after editing the OWL file, then redeploy the Lambda + frontend.

## Provenance

Originated as `demos/mutato/` + `infra/lambdas/mutato-extractor/` in [craigtrim/cosc-agentic-systems](https://github.com/craigtrim/cosc-agentic-systems). Carved out into this dedicated repo on 2026-05-20. The companion article *Mutato: Entity Extraction Without an LLM* stays in `cosc-agentic-systems` because it's content for craigtrim.com; the demo it embeds is served from the build of this repo.

## Related upstream work

| Repo | Why |
|---|---|
| [craigtrim/mutato](https://github.com/craigtrim/mutato) | The Python matching engine. This repo is its web face. |
| [craigtrim/cosc-agentic-systems](https://github.com/craigtrim/cosc-agentic-systems) | Hosts the companion article, the live craigtrim.com deployment infrastructure, and the prior issue history for this project. |
