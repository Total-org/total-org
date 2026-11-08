#!/bin/bash
# The answers installed apps depend on (/api on every host, the old-host redirects), normalised.
# Run against main's build and a branch build ON THE SAME PORT (downloadUrl echoes the origin) and diff:
#   npm run build && (npx next start -p 3124 &) && sleep 5 && bash scripts/api-matrix.sh 3124 > branch.txt
# Identical output = nothing an old app relies on changed (A6, PR body).
P=$1
TMPBODY=$(mktemp)
trap 'rm -f "$TMPBODY"' EXIT
req() { # host path [ua]
  local ua="${3:-Total/0.12 (Macintosh)}"
  echo "=== $1 $2 [$ua]"
  curl -s -D - -o "$TMPBODY" -H "Host: $1" -A "$ua" "http://localhost:$P$2" | tr -d '\r' | grep -iv '^date:\|^keep-alive\|^connection' | sort
  echo "--- body sha"; shasum -a 256 < "$TMPBODY" | cut -c1-16
}
for h in irminflow.com devjindal.tech www.devjindal.tech www.irminflow.com; do
  req $h /api/latest
  req $h /api/download
  req $h '/api/download?platform=win'
  req $h '/api/download?platform=mac'
  req $h /api/download 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  req $h /api/waitlist/export
done
for h in devjindal.tech www.devjindal.tech www.irminflow.com; do
  for p in / /docs /changelog '/docs/faq?x=1' /privacy /apis; do
    echo "=== $h $p"; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Host: $h" "http://localhost:$P$p"
  done
done
