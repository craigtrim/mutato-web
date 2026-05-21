#!/usr/bin/env bash
# Build, deploy, and smoke-test the mutato-web frontend.
#
# Modes:
#   ./scripts/deploy.sh                # full: build + sync + smoke
#   ./scripts/deploy.sh --smoke-only   # skip build + sync, just smoke the live site
#   ./scripts/deploy.sh --no-smoke     # build + sync, skip smoke (escape hatch)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-full}"

S3_PATH="s3://craigtrim.com/product/mutato/"
AWS_PROFILE_NAME="dwc_s3"
LIVE_URL="https://craigtrim.com/product/mutato/"

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

  echo "==> Syncing to $S3_PATH"
  aws s3 sync "$ROOT/frontend/dist/" "$S3_PATH" --profile "$AWS_PROFILE_NAME"

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
