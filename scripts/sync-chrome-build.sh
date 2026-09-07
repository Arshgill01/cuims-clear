#!/bin/sh
# Copy the shared Firefox solver into the Chrome package.
# Chrome-only files (manifest, service-worker, offscreen, popup copy) are left alone.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FF="$ROOT/outputs/cuims-clear-firefox"
CH="$ROOT/outputs/cuims-clear-chrome"

if [ ! -f "$FF/background.js" ] || [ ! -f "$CH/manifest.json" ]; then
  echo "Expected $FF and $CH to already exist." >&2
  exit 1
fi

for f in content.js background.js popup.js popup.css; do
  cp "$FF/$f" "$CH/$f"
done

mkdir -p "$CH/icons" "$CH/vendor/tesseract" "$CH/vendor/tessdata"
cp "$FF/icons/icon.svg" "$CH/icons/icon.svg"
cp "$FF/vendor/tesseract/"* "$CH/vendor/tesseract/"
cp "$FF/vendor/tessdata/"* "$CH/vendor/tessdata/"

echo "Synced Firefox solver into $CH"
