#!/usr/bin/env bash
# Regenerates the PDF fixtures from the HTML sources with headless Chromium.
# Usage: CHROME=/path/to/chrome bash tests/fixtures/src/make-pdfs.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-$(command -v chromium || command -v google-chrome || echo /opt/pw-browsers/chromium-1194/chrome-linux/chrome)}"
tmp="$(mktemp -d)"
for name in hebrew scanned; do
  "$CHROME" --headless=new --no-sandbox --disable-gpu --user-data-dir="$tmp" --no-pdf-header-footer \
    --print-to-pdf="$here/../$name.pdf" "file://$here/$name.html" 2>/dev/null
  echo "wrote tests/fixtures/$name.pdf"
done
rm -rf "$tmp"
