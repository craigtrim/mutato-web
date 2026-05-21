/*
 * Same-origin proxy for the mutato extractor.
 *
 * Route binding (set in wrangler.toml):
 *   craigtrim.com/api/mutato/*  ->  this worker
 *
 * Why: the browser was hitting the API Gateway domain
 *   (340cnsxykj.execute-api.us-west-2.amazonaws.com) cross-origin. Some
 *   client environments (ad-blockers, corporate filters, privacy modes)
 *   surface that as a generic "Failed to fetch" with no further detail.
 *   Routing through craigtrim.com makes the browser call same-origin —
 *   no preflight, no CORS, no AWS-domain on any blocklist.
 *
 * The worker itself talks to API Gateway server-side and forwards the
 * Origin header explicitly because the Lambda enforces an allow-list
 * of {"https://craigtrim.com"}; without it the upstream returns 403.
 */

const UPSTREAM = 'https://340cnsxykj.execute-api.us-west-2.amazonaws.com/prod/mutato_extractor_post'
const ALLOWED_METHODS = new Set(['POST', 'OPTIONS'])

export default {
  async fetch(request) {
    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response('Method not allowed', { status: 405 })
    }

    // The page calls /api/mutato/extract — same-origin from the browser's
    // perspective — so no preflight should ever fire. Handle OPTIONS
    // defensively anyway in case a future client adds custom headers.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 })
    }

    // Reconstruct the upstream request. We deliberately rebuild headers
    // rather than passing them through: Cloudflare adds CF-specific
    // headers (cf-connecting-ip, cf-ray, ...) that API Gateway tolerates
    // but don't add value, and we want to pin the Origin to satisfy the
    // Lambda allow-list regardless of what header the browser sent.
    const upstreamReq = new Request(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        'Origin': 'https://craigtrim.com',
        'Accept': 'application/json',
      },
      body: request.body,
    })

    let upstreamRes
    try {
      upstreamRes = await fetch(upstreamReq)
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Upstream fetch failed: ${e.message}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Pass the body and status through. Strip the upstream CORS headers
    // — they're meaningless for a same-origin response and would just be
    // noise in DevTools.
    const passHeaders = new Headers()
    passHeaders.set('Content-Type', upstreamRes.headers.get('content-type') || 'application/json')

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: passHeaders,
    })
  },
}
