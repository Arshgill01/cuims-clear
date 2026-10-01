#!/bin/sh
# Copy the shared Firefox source into the Chrome package.
# Chrome-only files (manifest, service-worker) are left alone.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FF="$ROOT/outputs/cuims-clear-firefox"
CH="$ROOT/outputs/cuims-clear-chrome"

if [ ! -f "$FF/captcha-solver.js" ] || [ ! -f "$CH/manifest.json" ]; then
  echo "Expected $FF and $CH to already exist." >&2
  exit 1
fi

# content.js needs the glyphs and solver before it; the service worker loads
# the solver and the attendance scripts.
if ! grep -q '"captcha-solver.js"' "$CH/manifest.json" \
  || ! grep -q 'captcha-solver.js' "$CH/service-worker.js" \
  || ! grep -q 'attendance-bg.js' "$CH/service-worker.js"; then
  echo "Chrome manifest or service-worker.js is missing a shared script." >&2
  exit 1
fi

for f in captcha-glyphs.js captcha-solver.js content.js popup.html popup.js popup.css \
  attendance-parse.js attendance-model.js attendance-client.js attendance-daemon.js attendance-view.js attendance-bg.js \
  lms-model.js lms.js lms.css lms-launch.js lms-boot.js lms-open.js lms-open-wrap.js themes.js theme-boot.js theme-bg.js cuims-theme.js; do
  cp "$FF/$f" "$CH/$f"
done

mkdir -p "$CH/icons"
cp "$FF/icons/icon.svg" "$CH/icons/icon.svg"

echo "Synced Firefox source into $CH"
