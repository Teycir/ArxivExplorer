#!/usr/bin/env bash
# scripts/verify-deploy.sh — post-deploy check ("did the right release go live?").
#
# 1. The footer on the live site shows package.json's version (retried while
#    the new Worker version propagates).
# 2. The API worker answers /api/stats.
# 3. Claim classification works end to end (site proxy -> service binding -> AI).
#
# Usage:  npm run verify:deploy
# Env:    SITE_URL / API_URL   override the production URLs
#         SKIP_AI=1            skip step 3 (it costs one small Workers AI call)
#         RETRIES / DELAY      footer polling (default 8 x 6s)

set -uo pipefail
cd "$(dirname "$0")/.."

SITE="${SITE_URL:-https://arxivexplorer.arxivexplorer.workers.dev}"
API="${API_URL:-https://arxiv-api.arxivexplorer.workers.dev}"
RETRIES="${RETRIES:-8}"
DELAY="${DELAY:-6}"
UA="Mozilla/5.0 (verify-deploy)"

EXPECTED="$(node -p "require('./package.json').version")"
FAIL=0
ok()   { echo "  ✅ $*"; }
bad()  { echo "  ❌ $*"; FAIL=1; }

echo "▶ Verifying deploy of v${EXPECTED}"

# ── 1. Footer version ───────────────────────────────────────────────────────
echo "1) Footer version on ${SITE}"
LIVE=""
for i in $(seq 1 "$RETRIES"); do
  LIVE="$(curl -fsS -m 20 -A "$UA" -H 'Cache-Control: no-cache' "${SITE}/?_v=$(date +%s)" 2>/dev/null \
    | grep -oE 'data-version="[^"]+"' | head -1 | sed -E 's/data-version="([^"]+)"/\1/')"
  [ "$LIVE" = "$EXPECTED" ] && break
  [ "$i" -lt "$RETRIES" ] && sleep "$DELAY"
done
if [ "$LIVE" = "$EXPECTED" ]; then
  ok "footer shows v${LIVE}"
else
  bad "footer shows '${LIVE:-nothing}', expected v${EXPECTED} (not deployed yet, or cached)"
fi

# ── 2. API worker ───────────────────────────────────────────────────────────
echo "2) API worker ${API}"
CODE="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "${API}/api/stats")"
[ "$CODE" = "200" ] && ok "/api/stats -> 200" || bad "/api/stats -> ${CODE}"

# ── 3. Claim classification smoke test ──────────────────────────────────────
if [ "${SKIP_AI:-0}" = "1" ]; then
  echo "3) Claim classification: skipped (SKIP_AI=1)"
else
  echo "3) Claim classification through the site proxy"
  BODY='{"claim":"ai jailbreak security","abstract":"We study jailbreak attacks against large language models and propose a defense.","tldr":"Jailbreak defense."}'
  RESP="$(curl -s -m 40 -w '\n%{http_code}' -X POST "${SITE}/api/classify-claim" \
    -H 'Content-Type: application/json' -d "$BODY")"
  CODE="${RESP##*$'\n'}"
  JSON="${RESP%$'\n'*}"
  RESULT="$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result||"")}catch{console.log("")}})')"
  case "$RESULT" in
    support|contradict|neutral) ok "HTTP ${CODE}, result=${RESULT}" ;;
    *) bad "HTTP ${CODE}, body: ${JSON:0:200}" ;;
  esac
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ v${EXPECTED} verified — safe to git push."
else
  echo "❌ Verification failed — do NOT push yet."
fi
exit "$FAIL"
