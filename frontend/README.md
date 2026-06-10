# Mutato Entity Extraction Demo

Live ontology-driven entity extraction over a Middle-earth ontology. Three matching passes (exact, span, hierarchy) executed by the [mutato](https://github.com/craigtrim/mutato) Python library, served via the `mutato-extractor` Lambda. The companion demo for the *Mutato Entity Extraction* article, which extends *What Is an Ontology?* into a worked example of NLP without an LLM.

## Companion Article

Draft at [site/articles/mutato-entity-extraction.draft/](../../site/articles/mutato-entity-extraction.draft/). Embeds this demo as the worked example in section 5.

## Related Demos

Part of the Week 6 ontology / agent-memory sequence:

1. [ontology-building-blocks](../ontology-building-blocks/) — classes, properties, relationships, constraints
2. [ontology-syntaxes](../ontology-syntaxes/) — the same ontology in five RDF serializations
3. **mutato** (this demo) — the ontology as a working entity extractor

## Live URL

https://d1417qhlp96qo6.cloudfront.net/mutato/

## Architecture

- **Frontend.** Vite 5 + React 18. Three-pane layout: class tree (left), text input + result (center), provenance ledger (right).
- **Backend.** `infra/lambdas/mutato-extractor/` Docker Lambda (Python 3.11 ARM64). POST `/mutato-extract` with `{text, ontology}` returns the per-token swap dicts and a flattened match ledger.
- **Ontology.** Source TTL at `site/articles/mutato-entity-extraction.draft/builder/lotr-mutato.owl`; compiled to a JSON MDA dict by `mutato-build.py` and consumed in two places: the Lambda's `ontologies/lotr.json` and this demo's `public/data/lotr.json`.

## Build and Deploy

```bash
cd demos/mutato.draft
npm install
npm run dev          # local dev server
npm run build        # production bundle -> dist/
# Deploy only after dropping the .draft suffix and getting explicit author sign-off.
# deployed via ../scripts/deploy.sh (s3://cosc-demos-069163481355/mutato/, profile cosc_s3)
```

The Lambda endpoint URL is wired into `config.js`. Until the Lambda is provisioned, the demo runs in a degraded "backend pending" state: the class tree and sample sentences are visible, but the extract button surfaces a notice instead of calling the backend.
