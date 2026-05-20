# mutato-extractor Lambda

Live ontology-driven entity extraction via [mutato](https://github.com/craigtrim/mutato). Three matching passes (exact, span, hierarchy) over a pre-compiled ontology dict that ships baked into the Docker image.

## Endpoint

`POST <api-gateway-invoke-url>`

Request:

```json
{ "text": "string (<=5000 chars)", "ontology": "lotr" }
```

`ontology` is optional and defaults to `"lotr"`. Valid values: `"lotr"`, `"animals-test"`, `"music-test"`.

Response 200:

```json
{
  "ontology": "lotr",
  "tokens": [{"text": "hobbits", "normal": "hobbit", "swaps": {"canon": "Hobbit", "type": "exact", "confidence": 100.0, "ontologies": ["lotr"]}}],
  "matches": [{"surface": "hobbits", "canon": "Hobbit", "type": "exact", "confidence": 100.0, "ontologies": ["lotr"], "start": 4, "end": 11, "normal": "hobbit"}],
  "stats": {"token_count": 5, "match_count": 1}
}
```

Errors: `400` missing/unknown ontology, `400` empty text, `413` text > 5000 chars, `413` ontology TTL > 400,000 chars, `403` Origin not allowed, `500` parser failure.

## Origin allow-list

Requests are accepted only when the `Origin` header matches an entry in `ALLOWED_ORIGINS` (currently `{"https://craigtrim.com"}`). Requests with no `Origin` header are also rejected with `403`. CORS preflight (`OPTIONS`) echoes the matched origin in `Access-Control-Allow-Origin`; rejected origins receive no `Access-Control-Allow-Origin` header at all, so browsers block the response.

This is defense in depth, not a security boundary: CLI clients can forge the `Origin` header. Per-IP rate limiting belongs at WAF; see issue #142 for the full perimeter plan.

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

Calls `infra/resources/update-lambda.sh --repo-name mutato-extractor-repo`, which builds the linux/arm64 image, pushes to ECR, and points the function at the new tag.

## Ontology rebuild

Source ontology lives at `site/articles/mutato-entity-extraction.draft/builder/lotr-mutato.owl`. After editing it, rerun the build script before redeploying the Lambda:

```bash
cd site/articles/mutato-entity-extraction.draft/builder
poetry run python mutato-build.py
# rewrites ontologies/lotr.json under this Lambda dir
cd -
./update.sh
```
