#!/bin/sh
# Copy the shared Firefox source into the Chrome package.
# Chrome-only files (manifest, service-worker, offscreen) are left alone.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FF="$ROOT/outputs/cuims-clear-firefox"
CH="$ROOT/outputs/cuims-clear-chrome"

if [ ! -f "$FF/background.js" ] || [ ! -f "$CH/manifest.json" ]; then
  echo "Expected $FF and $CH to already exist." >&2
  exit 1
fi

# content.js needs captcha-prep.js before it; the offscreen solver needs it
# before background.js; the service worker loads the attendance scripts.
if ! grep -q '"captcha-prep.js"' "$CH/manifest.json" \
  || ! grep -q 'captcha-prep.js' "$CH/offscreen.html" \
  || ! grep -q 'attendance-bg.js' "$CH/service-worker.js"; then
  echo "Chrome manifest, offscreen.html or service-worker.js is missing a shared script." >&2
  exit 1
fi

for f in captcha-prep.js content.js background.js popup.html popup.js popup.css \
  attendance-parse.js attendance-model.js attendance-client.js attendance-daemon.js attendance-view.js attendance-bg.js \
  lms-model.js lms.js lms.css lms-launch.js lms-boot.js lms-open.js lms-open-wrap.js; do
  cp "$FF/$f" "$CH/$f"
done

mkdir -p "$CH/icons" "$CH/vendor/tesseract" "$CH/vendor/tessdata"
cp "$FF/icons/icon.svg" "$CH/icons/icon.svg"
cp "$FF/vendor/tesseract/"* "$CH/vendor/tesseract/"
cp "$FF/vendor/tessdata/"* "$CH/vendor/tessdata/"

echo "Synced Firefox source into $CH"
