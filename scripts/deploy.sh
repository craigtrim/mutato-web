#!/usr/bin/env bash
# Build, deploy, and smoke-test the mutato-web frontend on the COSC account
# (craigtrim/cosc-agentic-systems#175).
#
# Modes:
#   ./scripts/deploy.sh                # full: build + sync + smoke
#   ./scripts/deploy.sh --smoke-only   # skip build + sync, just smoke the live site
#   ./scripts/deploy.sh --no-smoke     # build + sync, skip smoke (escape hatch)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-full}"

# COSC: served from the cosc-demos bucket behind CloudFront. The API base is in
# frontend/public/cosc-config.js and must stay no-cache so it is re-pointable in
# place; the content-hashed assets are immutable.
S3_PATH="s3://cosc-demos-069163481355/mutato/"
AWS_PROFILE_NAME="cosc_s3"
LIVE_URL="https://d1417qhlp96qo6.cloudfront.net/mutato/"

case "$MODE" in
  full|--smoke-only|--no-smoke) ;;
  *)
    echo "usage: $0 [--smoke-only | --no-smoke]" >&2
    exit 2
    ;;
esac

if [[ "$MODE" != "--smoke-only" ]]; then
  echo "==> Building frontend"
  (cd "$ROOT/frontend" && npm run build)

  echo "==> Syncing to $S3_PATH (two-step: immutable assets, no-cache html/config)"
  aws s3 sync "$ROOT/frontend/dist/" "$S3_PATH" \
    --exclude index.html --exclude cosc-config.js \
    --cache-control "public, max-age=31536000, immutable" \
    --profile "$AWS_PROFILE_NAME"
  aws s3 cp "$ROOT/frontend/dist/index.html" "$S3_PATH/index.html" \
    --cache-control "no-cache" --profile "$AWS_PROFILE_NAME"
  aws s3 cp "$ROOT/frontend/dist/cosc-config.js" "$S3_PATH/cosc-config.js" \
    --cache-control "no-cache" --profile "$AWS_PROFILE_NAME"

  echo "==> Waiting 5s for propagation"
  sleep 5
fi

if [[ "$MODE" != "--no-smoke" ]]; then
  echo "==> Smoking $LIVE_URL"
  if [[ ! -d "$ROOT/smoke/node_modules" ]]; then
    echo "    (installing smoke deps — one-time)"
    (cd "$ROOT/smoke" && npm install && npx playwright install chromium)
  fi
  (cd "$ROOT/smoke" && SMOKE_URL="$LIVE_URL" npm test)
fi

echo "==> done"
