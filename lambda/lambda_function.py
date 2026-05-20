import hashlib
import json
import logging
import time
from collections import OrderedDict
from logging import Logger
from pathlib import Path

from mutato.api import OntologyParser


def configure_logging(function_name: str) -> Logger:
    root_logger = logging.getLogger()
    if len(root_logger.handlers) > 0:
        root_logger.setLevel(logging.INFO)
    else:
        logging.basicConfig(level=logging.INFO)
    return logging.getLogger(function_name)


logger = configure_logging("mutato-extractor")

_COLD_START = True

MAX_TEXT_LENGTH = 5000
MAX_TTL_LENGTH = 400_000
MAX_CACHED_INLINE_PARSERS = 20
ONTOLOGIES_DIR = Path(__file__).resolve().parent / "ontologies"
VALID_ONTOLOGIES = {"lotr", "animals-test", "music-test"}

# Origin allow-list. Requests whose Origin header is not in this set are
# rejected with 403, including requests with no Origin header. Browsers set
# Origin automatically on cross-origin requests; CLI clients can spoof it, so
# this is defense in depth, not a security boundary.
ALLOWED_ORIGINS = frozenset({"https://craigtrim.com"})

# Cache for pre-baked ontologies. Unbounded because the keys are a fixed
# whitelist.
_PARSERS: dict = {}

# Cache for caller-supplied inline TTL ontologies, keyed by SHA-256 of the
# TTL text. LRU-evicted at MAX_CACHED_INLINE_PARSERS entries so a chatty
# editor session does not grow the container memory without bound.
_INLINE_PARSERS: "OrderedDict[str, OntologyParser]" = OrderedDict()


def _get_parser(ontology_id: str) -> OntologyParser:
    if ontology_id not in _PARSERS:
        ont_path = ONTOLOGIES_DIR / f"{ontology_id}.json"
        if not ont_path.exists():
            raise FileNotFoundError(f"Ontology bundle missing: {ont_path}")
        d_owl = json.loads(ont_path.read_text())
        _PARSERS[ontology_id] = OntologyParser.from_dict(d_owl, name=ontology_id)
        logger.info(f"Loaded ontology bundle: {ontology_id}")
    return _PARSERS[ontology_id]


def _get_parser_from_ttl(ttl_text: str) -> OntologyParser:
    h = hashlib.sha256(ttl_text.encode("utf-8")).hexdigest()
    if h in _INLINE_PARSERS:
        # Touch the LRU order
        _INLINE_PARSERS.move_to_end(h)
        return _INLINE_PARSERS[h]

    tmp_path = Path("/tmp") / f"custom-{h[:12]}.owl"
    tmp_path.write_text(ttl_text)
    parser = OntologyParser(tmp_path, namespace=None)
    _INLINE_PARSERS[h] = parser

    while len(_INLINE_PARSERS) > MAX_CACHED_INLINE_PARSERS:
        evicted_hash, _ = _INLINE_PARSERS.popitem(last=False)
        evicted_path = Path("/tmp") / f"custom-{evicted_hash[:12]}.owl"
        try:
            evicted_path.unlink()
        except OSError:
            pass
        logger.info(f"Evicted inline parser cache entry: {evicted_hash[:12]}")
    logger.info(f"Compiled inline ontology: {h[:12]} ({len(ttl_text)} chars)")
    return parser


def _summarize(tokens):
    """Project the rich mutato token list down to a flat match ledger."""
    matches = []
    for t in tokens or []:
        swaps = t.get("swaps")
        if not swaps:
            continue
        matches.append({
            "surface": t.get("text", "").strip(),
            "normal": t.get("normal", ""),
            "canon": swaps.get("canon", ""),
            "type": swaps.get("type", ""),
            "confidence": swaps.get("confidence", 0.0),
            "ontologies": swaps.get("ontologies", []),
            "start": t.get("x"),
            "end": t.get("y"),
        })
    return matches


def handler(event, context):
    """
    Lambda handler for mutato ontology-driven entity extraction.

    Expected input (via API Gateway POST):
    {
        "text": "any input sentence (<= 5000 chars)",
        "ontology": "lotr",          // pre-baked id (lotr, animals-test, music-test)
        "ontology_ttl": "..."         // optional: full TTL/OWL source; takes
                                      //   precedence over `ontology`. Hash-cached
                                      //   server-side so repeated extracts on the
                                      //   same source are warm.
    }

    Response (200):
    {
        "ontology": "lotr" | "custom",
        "tokens": [<full mutato token dicts>],
        "matches": [{"surface", "canon", "type", "confidence", ...}, ...],
        "stats": {"token_count", "match_count"}
    }
    """
    global _COLD_START
    is_cold_start = _COLD_START
    _COLD_START = False

    start_time = time.time()
    request_id = getattr(context, "aws_request_id", "local")

    logger.info("=== Lambda invocation started ===")
    logger.info(f"Request ID: {request_id}")
    logger.info(f"Cold start: {is_cold_start}")

    request_context = event.get("requestContext", {}) or {}
    headers = event.get("headers", {}) or {}
    identity = request_context.get("identity", {}) or {}
    source_ip = identity.get("sourceIp", "unknown")
    request_origin = _request_origin(headers)
    matched_origin = _matched_origin(request_origin)
    logger.info("REQUEST_META: %s", json.dumps({
        "log_type": "REQUEST_META",
        "request_id": request_id,
        "source_ip": source_ip,
        "origin": request_origin or "missing",
        "origin_allowed": bool(matched_origin),
        "cold_start": is_cold_start,
    }))

    http_method = event.get("httpMethod", "UNKNOWN")
    if http_method == "OPTIONS":
        logger.info("Handling CORS preflight")
        return _cors_preflight(matched_origin)

    if not matched_origin:
        logger.warning("ORIGIN_REJECTED: %s", json.dumps({
            "log_type": "ORIGIN_REJECTED",
            "request_id": request_id,
            "source_ip": source_ip,
            "origin": request_origin or "missing",
        }))
        return _error_response(403, "Origin not allowed",
                               matched_origin=matched_origin,
                               request_id=request_id, start_time=start_time,
                               is_cold_start=is_cold_start)

    try:
        body = event.get("body", "{}")
        if isinstance(body, str):
            body = json.loads(body)

        text = body.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return _error_response(400, "Missing required field: text",
                                   matched_origin=matched_origin,
                                   request_id=request_id, start_time=start_time,
                                   is_cold_start=is_cold_start)
        if len(text) > MAX_TEXT_LENGTH:
            return _error_response(413, f"Text too long. Maximum {MAX_TEXT_LENGTH} characters.",
                                   matched_origin=matched_origin,
                                   request_id=request_id, start_time=start_time,
                                   is_cold_start=is_cold_start)

        ttl = body.get("ontology_ttl")
        if ttl is not None:
            if not isinstance(ttl, str) or not ttl.strip():
                return _error_response(400, "Field ontology_ttl must be a non-empty string.",
                                       matched_origin=matched_origin,
                                       request_id=request_id, start_time=start_time,
                                       is_cold_start=is_cold_start)
            if len(ttl) > MAX_TTL_LENGTH:
                return _error_response(413,
                                       f"Ontology TTL too long. Max {MAX_TTL_LENGTH} chars.",
                                       matched_origin=matched_origin,
                                       request_id=request_id, start_time=start_time,
                                       is_cold_start=is_cold_start)
            try:
                parser = _get_parser_from_ttl(ttl)
            except Exception as e:
                logger.exception("Inline TTL parse failed")
                return _error_response(400, f"Ontology parse failed: {e}",
                                       matched_origin=matched_origin,
                                       request_id=request_id, start_time=start_time,
                                       is_cold_start=is_cold_start)
            ontology_id = "custom"
        else:
            ontology_id = body.get("ontology", "lotr")
            if ontology_id not in VALID_ONTOLOGIES:
                return _error_response(400,
                                       f"Unknown ontology: {ontology_id}. Valid: {sorted(VALID_ONTOLOGIES)}",
                                       matched_origin=matched_origin,
                                       request_id=request_id, start_time=start_time,
                                       is_cold_start=is_cold_start)
            parser = _get_parser(ontology_id)

        logger.info("REQUEST_SUMMARY: %s", json.dumps({
            "log_type": "REQUEST_SUMMARY",
            "request_id": request_id,
            "ontology": ontology_id,
            "text_length": len(text),
            "ttl_length": len(ttl) if ttl else 0,
        }))

        tokens = parser._api.swap_input_text(text) or []
        matches = _summarize(tokens)

        return _success_response({
            "ontology": ontology_id,
            "tokens": tokens,
            "matches": matches,
            "stats": {
                "token_count": len(tokens),
                "match_count": len(matches),
            }
        }, matched_origin=matched_origin, request_id=request_id,
           start_time=start_time, is_cold_start=is_cold_start)

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        return _error_response(400, f"Invalid JSON: {e}",
                               matched_origin=matched_origin,
                               request_id=request_id, start_time=start_time,
                               is_cold_start=is_cold_start)
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return _error_response(500, str(e),
                               matched_origin=matched_origin,
                               request_id=request_id, start_time=start_time,
                               is_cold_start=is_cold_start)


def _request_origin(headers):
    """Read the Origin header from an API Gateway event, case-insensitive."""
    return headers.get("origin") or headers.get("Origin") or ""


def _matched_origin(request_origin):
    """Return the request's Origin if it is in ALLOWED_ORIGINS, else ''."""
    return request_origin if request_origin in ALLOWED_ORIGINS else ""


def _cors_origin_header(matched_origin):
    """Single-key dict with Access-Control-Allow-Origin, or empty if not allowed.

    Omitting the header for rejected origins causes the browser to block the
    response, which is the intended behavior. We do not fall back to '*'.
    """
    return {"Access-Control-Allow-Origin": matched_origin} if matched_origin else {}


def _cors_preflight(matched_origin):
    headers = {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    }
    headers.update(_cors_origin_header(matched_origin))
    return {
        "statusCode": 200,
        "headers": headers,
        "body": "",
    }


def _log_response(response, request_id, start_time, is_cold_start):
    duration_ms = round((time.time() - start_time) * 1000, 2)
    logger.info("RESPONSE: %s", json.dumps({
        "log_type": "RESPONSE",
        "request_id": request_id,
        "status_code": response.get("statusCode", 0),
        "duration_ms": duration_ms,
        "cold_start": is_cold_start,
        "response_size_bytes": len(response.get("body", "")),
    }))


def _success_response(payload, matched_origin, request_id, start_time, is_cold_start):
    headers = {"Content-Type": "application/json"}
    headers.update(_cors_origin_header(matched_origin))
    response = {
        "statusCode": 200,
        "headers": headers,
        "body": json.dumps(payload),
    }
    _log_response(response, request_id, start_time, is_cold_start)
    logger.info("=== Lambda invocation completed successfully ===")
    return response


def _error_response(status_code, message, matched_origin, request_id, start_time, is_cold_start):
    headers = {"Content-Type": "application/json"}
    headers.update(_cors_origin_header(matched_origin))
    response = {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps({"error": message}),
    }
    _log_response(response, request_id, start_time, is_cold_start)
    return response
