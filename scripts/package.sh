#!/usr/bin/env bash
# Builds the ZIP to upload to the Chrome Web Store: runtime files only, no tests, docs
# or git metadata. Output: dist/gh-slash-commands-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(node -e 'process.stdout.write(require("./manifest.json").version)')
out="dist/gh-slash-commands-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -q -X "$out" \
  manifest.json \
  parser.js fetcher.js content.js content.css \
  options.html options.js \
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png

echo "$out"
unzip -Z1 "$out" | sed 's/^/  /'
