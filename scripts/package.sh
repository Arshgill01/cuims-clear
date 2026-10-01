#!/bin/sh
# Builds the store zips for both browsers into outputs/dist.
# Syncs the shared source into Chrome, runs the unit tests, checks both
# manifests carry the same version, then zips each package's contents.
#   sh scripts/package.sh            unit tests only
#   BROWSERS=1 sh scripts/package.sh also the real-browser solver run

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

sh scripts/sync-chrome-build.sh
npm test --silent >/dev/null || { echo "Unit tests failed; run npm test." >&2; exit 1; }
if [ -n "$BROWSERS" ]; then
  (cd work/e2e && node solver-browsers.mjs) || { echo "Browser solver run failed." >&2; exit 1; }
fi

version() { node -p "require('./outputs/cuims-clear-$1/manifest.json').version"; }
FF_VERSION="$(version firefox)"
CH_VERSION="$(version chrome)"
if [ "$FF_VERSION" != "$CH_VERSION" ]; then
  echo "Version mismatch: firefox $FF_VERSION, chrome $CH_VERSION" >&2
  exit 1
fi

mkdir -p outputs/dist
for build in chrome firefox; do
  out="$ROOT/outputs/dist/cuims-clear-$build-$FF_VERSION.zip"
  rm -f "$out"
  # amo-metadata.json is for the AMO upload form, not the package.
  (cd "outputs/cuims-clear-$build" && zip -qrX "$out" . -x ".*" -x "*/.*" -x "amo-metadata.json")
  echo "$out ($(du -h "$out" | cut -f1 | tr -d ' '))"
done
