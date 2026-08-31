#!/usr/bin/env bash
# Submit the current Firefox build to addons.mozilla.org as a listed update.
# Requires JWT credentials from https://addons.mozilla.org/developers/addon/api/key/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT/outputs/cuims-clear-firefox"
METADATA="$SOURCE_DIR/amo-metadata.json"

if [[ -z "${WEB_EXT_API_KEY:-}" || -z "${WEB_EXT_API_SECRET:-}" ]]; then
  echo "Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET from the AMO developer hub." >&2
  exit 1
fi

npx --yes web-ext@8 sign \
  --source-dir "$SOURCE_DIR" \
  --channel listed \
  --amo-metadata "$METADATA" \
  --api-key "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET"
