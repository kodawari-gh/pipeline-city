#!/usr/bin/env bash
# Concatenates src/ into dist/. artifact.html = exactly what was published as a Claude artifact
# (no doctype/head wrapper). index.html = same content wrapped as a normal local page.
set -e; cd "$(dirname "$0")"; mkdir -p dist
cat src/b1.js src/b2.js src/c1.js src/c2.js src/c3a.js src/c3b.js src/d.js > dist/all.js
node --check dist/all.js
{ cat src/a.html dist/all.js; echo '</script>'; } > dist/artifact.html
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>'
  cat src/a.html dist/all.js; echo '</script></body></html>'; } > dist/index.html
echo "built dist/index.html ($(wc -c < dist/index.html) bytes)"
