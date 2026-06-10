# mutato-extractor Lambda

Live ontology-driven entity extraction via [mutato](https://github.com/craigtrim/mutato). Three matching passes (exact, span, hierarchy) over a pre-compiled ontology dict that ships baked into the Docker image.

## Endpoint

`POST <api-gateway-invoke-url>`

Request:

```json
{ "text": "string (<=5000 chars)", "ontology": "lotr" }
```

`ontology` is optional and defaults to `"lotr"`. Valid values: `"lotr"`, `"oilgas"`, `"healthcare"`.

Response 200:

```json
{
  "ontology": "lotr",
  "tokens": [{"text": "hobbits", "normal": "hobbit", "swaps": {"canon": "Hobbit", "type": "exact", "confidence": 100.0, "ontologies": ["lotr"]}}],
  "matches": [{"surface": "hobbits", "canon": "Hobbit", "type": "exact", "confidence": 100.0, "ontologies": ["lotr"], "start": 4, "end": 11, "normal": "hobbit"}],
  "stats": {"token_count": 5, "match_count": 1}
}
```

Errors: `400` missing/unknown ontology, `400` empty text, `413` text > 5000 chars, `413` ontology TTL > 400,000 chars, `500` parser failure.

## CORS

CORS is wildcard (craigtrim/cosc-agentic-systems#175): the Lambda returns `Access-Control-Allow-Origin: *` on every response and the preflight, consistent with the other COSC demo backends. It does not reject by origin. Abuse and per-IP rate limiting belong at WAF; see #142 for the full perimeter plan.

## Sample curl

```bash
curl -X POST <invoke-url> \
  -H 'Content-Type: application/json' \
  -d '{"text":"The hobbits met Strider on the road to Hobbiton; he wore the One Ring.","ontology":"lotr"}'
```

Expected: at least four matches (`hobbits` → `Hobbit`, `Strider` → `Aragorn`, `Hobbiton` → `Shire`, `the One Ring` → `One Ring`) with mixed match types.

## Cold start

Cold start runs roughly 2.5 to 3.5 seconds: most of it is spaCy `en_core_web_sm` load inside `MutatoAPI.__init__`. Warm requests are under 500 ms. The demo UI shows a "warming up..." state on the first request.

## Update

```bash
./update.sh
```

Self-contained: builds the linux/amd64 image, ensures the `cosc-mutato-extractor` ECR repo, its Lambda-pull policy, and the log group exist, pushes, and creates-or-updates the `cosc-mutato-extractor` function on the shared `cosc/cosc-lambda-exec` role.

## Ontology rebuild

Source ontology lives at `site/articles/mutato-entity-extraction.draft/builder/lotr-mutato.owl`. After editing it, rerun the build script before redeploying the Lambda:

```bash
cd site/articles/mutato-entity-extraction.draft/builder
poetry run python mutato-build.py
# rewrites ontologies/lotr.json under this Lambda dir
cd -
./update.sh
```
