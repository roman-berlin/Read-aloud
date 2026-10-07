#!/usr/bin/env bash
# Regenerates the PDF fixtures from the HTML sources with headless Chromium.
# Usage: CHROME=/path/to/chrome bash tests/fixtures/src/make-pdfs.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-$(command -v chromium || command -v google-chrome || echo /opt/pw-browsers/chromium-1194/chrome-linux/chrome)}"
tmp="$(mktemp -d)"
render() { # $1 = html name, $2 = output path
  "$CHROME" --headless=new --no-sandbox --disable-gpu --user-data-dir="$tmp" --no-pdf-header-footer \
    --print-to-pdf="$2" "file://$here/$1.html" 2>/dev/null
  echo "wrote $2"
}
render hebrew "$here/../hebrew.pdf"
render scanned "$here/../scanned.pdf"
rm -rf "$tmp"
