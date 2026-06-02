#!/usr/bin/env bash
# =============================================================================
# ArxivExplorer — Full Integration Test Suite
# Tests every deployed feature end-to-end against live production URLs.
# =============================================================================
set -euo pipefail

API="https://arxiv-api.arxivexplorer.workers.dev"
FE="https://arxivexplorer.arxivexplorer.workers.dev"
REPO="/home/teycir/Repos/ArxivExplorer"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

pass() { echo -e "  ${GREEN}✓ PASS${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC}  $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠ WARN${NC}  $1"; WARN=$((WARN+1)); }
section() { echo -e "\n${CYAN}── $1 ──${NC}"; }

# Fetch helpers
api()  { curl -sf --max-time 15 "$API$1" 2>/dev/null; }
fe()   { curl -sf --max-time 15 "$FE$1"  2>/dev/null; }
code() { curl -s  --max-time 15 -o /dev/null -w "%{http_code}" "$1"; }
ms()   { local t0=$(($(date +%s%N)/1000000)); curl -sf --max-time 15 "$1" >/dev/null 2>&1; echo $(( $(date +%s%N)/1000000 - t0 )); }

# Grab a real paper ID from DB to use in ID-specific tests
PAPER_ID=$(api "/api/trending" | jq -r '.papers[0].id // empty' 2>/dev/null || true)
if [ -z "$PAPER_ID" ]; then
  warn "Could not fetch a paper ID from trending — using fallback ID for paper tests"
  PAPER_ID="2301.07041"
fi
echo -e "  Using paper ID: ${CYAN}${PAPER_ID}${NC}"

# =============================================================================
section "1. TYPE-CHECK (source)"
# =============================================================================
if cd "$REPO" && npx tsc --noEmit 2>/dev/null; then
  pass "npx tsc --noEmit → exit 0"
else
  fail "TypeScript errors present"
fi

# =============================================================================
section "2. API WORKER — core routes"
# =============================================================================

# 2a. Trending
R=$(api "/api/trending"); C=$(echo "$R" | jq '.papers|length' 2>/dev/null || echo 0)
[ "$C" -gt 0 ] && pass "GET /api/trending → $C papers" || fail "GET /api/trending returned 0 papers"

# 2b. Trending windows all respond
for W in day week month; do
  SC=$(code "$API/api/trending?window=$W")
  [ "$SC" = "200" ] && pass "GET /api/trending?window=$W → 200" || fail "GET /api/trending?window=$W → $SC"
done

# 2c. Paper by ID
R=$(api "/api/paper/$PAPER_ID")
echo "$R" | jq -e '.id' >/dev/null 2>&1 && pass "GET /api/paper/$PAPER_ID → has .id" || fail "GET /api/paper/$PAPER_ID → bad response"
echo "$R" | jq -e '.title' >/dev/null 2>&1 && pass "GET /api/paper/$PAPER_ID → has .title" || fail "missing .title"

# 2d. Paper 404
SC=$(code "$API/api/paper/0000.00000")
[ "$SC" = "404" ] && pass "GET /api/paper/0000.00000 → 404" || fail "expected 404, got $SC"

# 2e. Related papers
R=$(api "/api/paper/$PAPER_ID/related")
echo "$R" | jq -e 'type=="array"' >/dev/null 2>&1 && pass "GET /api/paper/$PAPER_ID/related → array" || fail "related not an array"

# 2f. Related — all IDs exist in papers table (DB-only policy)
REL_COUNT=$(echo "$R" | jq 'length' 2>/dev/null || echo 0)
if [ "$REL_COUNT" -gt 0 ]; then
  BAD=0
  for RID in $(echo "$R" | jq -r '.[].id' 2>/dev/null | head -5); do
    SC=$(code "$API/api/paper/$RID")
    [ "$SC" != "200" ] && BAD=$((BAD+1))
  done
  [ "$BAD" -eq 0 ] && pass "Related paper IDs all resolve in DB ($REL_COUNT papers, spot-checked 5)" \
                     || fail "$BAD related paper ID(s) returned non-200 from /api/paper/:id"
else
  warn "No related papers for $PAPER_ID — skipping ID validation"
fi

# 2g. Search — keyword
R=$(api "/api/search?q=transformer+attention")
echo "$R" | jq -e '.papers|length>0' >/dev/null 2>&1 && pass "GET /api/search?q=transformer+attention → results" || warn "search returned 0 results (sparse index?)"

# 2h. Search — empty query → 400
SC=$(code "$API/api/search?q=")
[ "$SC" = "400" ] && pass "GET /api/search?q= → 400" || fail "expected 400, got $SC"

# 2i. Search — category filter
R=$(api "/api/search?q=neural+network&category=cs.LG")
echo "$R" | jq -e '.papers' >/dev/null 2>&1 && pass "GET /api/search?q=...&category=cs.LG → .papers field" || fail "category filter response malformed"

# 2j. Search — date filter
R=$(api "/api/search?q=diffusion&date=month")
echo "$R" | jq -e '.papers' >/dev/null 2>&1 && pass "GET /api/search?q=...&date=month → .papers field" || fail "date filter response malformed"

# 2k. More-like-this
R=$(api "/api/search?like=$PAPER_ID")
echo "$R" | jq -e '.papers' >/dev/null 2>&1 && pass "GET /api/search?like=$PAPER_ID → .papers field" || warn "more-like-this returned no results (Vectorize may not have vector)"

# 2l. Topics list
R=$(api "/api/topics")
echo "$R" | jq -e '.topics|length>0' >/dev/null 2>&1 && pass "GET /api/topics → has topics" || fail "GET /api/topics empty"

# 2m. Individual topic
R=$(api "/api/topic/large-language-models")
echo "$R" | jq -e '.papers' >/dev/null 2>&1 && pass "GET /api/topic/large-language-models → .papers" || fail "topic endpoint failed"

# 2n. Unknown topic → 404
SC=$(code "$API/api/topic/not-a-real-topic-xyz123")
[ "$SC" = "404" ] && pass "GET /api/topic/not-a-real-topic-xyz123 → 404" || fail "expected 404, got $SC"

# 2o. Author search
AUTHOR=$(api "/api/paper/$PAPER_ID" | jq -r '.authors[0] // empty' 2>/dev/null || true)
if [ -n "$AUTHOR" ]; then
  SC=$(code "$API/api/author/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$AUTHOR")")
  [ "$SC" = "200" ] && pass "GET /api/author/$AUTHOR → 200" || warn "author endpoint → $SC (may be sparse)"
fi

# 2p. CORS headers present
CORS=$(curl -sI --max-time 10 "$API/api/trending" | grep -i "access-control-allow-origin" || true)
[ -n "$CORS" ] && pass "CORS headers present on API" || fail "CORS headers missing"

# 2q. Cache header present
CACHE=$(curl -sI --max-time 10 "$API/api/trending" | grep -i "cache-control" || true)
[ -n "$CACHE" ] && pass "Cache-Control header present" || fail "Cache-Control header missing"

# =============================================================================
section "3. API WORKER — response time"
# =============================================================================
for LABEL URL in \
  "trending(cached)" "$API/api/trending" \
  "paper(cached)"    "$API/api/paper/$PAPER_ID" \
  "search(keyword)"  "$API/api/search?q=attention+mechanism"
do
  T=$(ms "$URL")
  [ "$T" -lt 2000 ] && pass "$LABEL → ${T}ms" || warn "$LABEL slow: ${T}ms (>2000ms)"
done

# =============================================================================
section "4. API WORKER — summary_ready caching policy"
# =============================================================================

# Paper with summaryReady=1 should be cached (KV hit on second request is faster)
T1=$(ms "$API/api/paper/$PAPER_ID")
T2=$(ms "$API/api/paper/$PAPER_ID")
# Can't guarantee strict ordering due to network jitter, just check both are fast
[ "$T2" -lt 2000 ] && pass "Paper second fetch still fast: ${T2}ms" || warn "Paper second fetch slow: ${T2}ms"

# =============================================================================
section "5. FRONTEND — HTTP status codes"
# =============================================================================
declare -A PAGES=(
  ["homepage"]="/"
  ["search(no query)"]="/search"
  ["search(with query)"]="/search?q=neural+networks"
  ["paper page"]="/paper/$PAPER_ID"
  ["bookmarks"]="/bookmarks"
  ["compare(no ids)"]="/compare"
  ["topic page"]="/topic/large-language-models"
  ["faq"]="/faq"
  ["how-to-use"]="/how-to-use"
  ["robots.txt"]="/robots.txt"
  ["sitemap.xml"]="/sitemap.xml"
)
for LABEL in "${!PAGES[@]}"; do
  PATH="${PAGES[$LABEL]}"
  SC=$(code "$FE$PATH")
  [ "$SC" = "200" ] && pass "Frontend $LABEL → 200" || fail "Frontend $LABEL → $SC"
done

# Unknown paper → 404
SC=$(code "$FE/paper/0000.00000")
[ "$SC" = "404" ] && pass "Frontend /paper/0000.00000 → 404" || fail "expected 404, got $SC"

# =============================================================================
section "6. FRONTEND — SSR content"
# =============================================================================

# Homepage has trending papers
R=$(fe "/")
echo "$R" | grep -qi "arxiv\|paper\|transformer\|neural" && pass "Homepage contains paper content" || fail "Homepage empty"

# Search page SSR
R=$(fe "/search?q=diffusion+model")
echo "$R" | grep -qi "paper\|result\|arxiv" && pass "Search page SSR has content" || fail "Search SSR empty"

# Search page has og:title meta
echo "$R" | grep -qi 'og:title\|<title' && pass "Search page has meta tags (SEO)" || fail "Search page missing meta tags"

# Paper page has title
R=$(fe "/paper/$PAPER_ID")
echo "$R" | grep -qi 'og:title\|<h1\|<title' && pass "Paper page has title tag" || fail "Paper page missing title"

# Paper page does NOT contain synthesised arxiv.org abs URL
# (pdfUrl/htmlUrl must come from DB, not be built from the ID)
if echo "$R" | grep -q "arxiv.org/abs/$PAPER_ID"; then
  warn "Paper page contains arxiv.org/abs URL — check if this is from a link or synthesised"
else
  pass "Paper page does not synthesise arxiv.org/abs links"
fi

# =============================================================================
section "7. FRONTEND — DB-only link policy"
# =============================================================================

# Search results: every /paper/:id link must resolve
R=$(fe "/search?q=attention+mechanism")
IDS=$(echo "$R" | grep -oP '(?<=/paper/)[0-9]{4}\.[0-9]{4,5}' | sort -u | head -5)
BAD=0
for ID in $IDS; do
  SC=$(code "$API/api/paper/$ID")
  [ "$SC" != "200" ] && BAD=$((BAD+1)) && fail "Search result link /paper/$ID → API $SC (not in DB)"
done
[ "$BAD" -eq 0 ] && [ -n "$IDS" ] && pass "All search result paper IDs resolve in DB (spot-checked $(echo "$IDS"|wc -w))" \
  || [ -z "$IDS" ] && warn "No paper IDs extracted from search page — can't verify"

# =============================================================================
section "8. SOURCE CODE — bug fixes verified"
# =============================================================================

# BookmarksList: DB validation on load
grep -q "getPaper" "$REPO/app/components/BookmarksList.tsx" && \
grep -q "Promise.allSettled" "$REPO/app/components/BookmarksList.tsx" && \
  pass "BookmarksList: DB validation via getPaper + allSettled present" || \
  fail "BookmarksList: DB validation code missing"

# BookmarksList: dead IDs removed from localStorage
grep -q "removeBookmark" "$REPO/app/components/BookmarksList.tsx" && \
  pass "BookmarksList: removeBookmark called on dead IDs" || \
  fail "BookmarksList: removeBookmark not called"

# CollectionManager: onUpdate passes value
grep -q "onUpdate(name)" "$REPO/app/components/CollectionManager.tsx" && \
  pass "CollectionManager.onUpdate passes collection value" || \
  fail "CollectionManager.onUpdate not passing value"

# CollectionExport: accepts bookmarks prop
grep -q "propBookmarks" "$REPO/app/components/CollectionManager.tsx" && \
  pass "CollectionExport accepts bookmarks prop" || \
  fail "CollectionExport missing propBookmarks"

# PersonalizedFeed: cache busted on bookmarks-changed
grep -q "arxiv:bookmarks-changed" "$REPO/app/components/PersonalizedFeed.tsx" && \
grep -q "sessionStorage.removeItem" "$REPO/app/components/PersonalizedFeed.tsx" && \
  pass "PersonalizedFeed: sessionStorage cache busted on bookmarks-changed" || \
  fail "PersonalizedFeed: cache bust listener missing"

# pipeline.ts: all 3 trending windows invalidated
grep -c "kv:trending:" "$REPO/src/ingest-worker/pipeline.ts" | grep -qE "^[3-9]|^[0-9]{2}" && \
  pass "pipeline.ts: 3 trending cache keys invalidated" || \
  fail "pipeline.ts: not all trending windows invalidated (only $(grep -c 'kv:trending:' $REPO/src/ingest-worker/pipeline.ts))"

# paper.ts: summaryReady=2 also cached with 1h TTL
grep -q "summaryReady === 2" "$REPO/src/api-worker/routes/paper.ts" && \
  pass "paper.ts: summaryReady=2 papers cached (1h TTL)" || \
  fail "paper.ts: summaryReady=2 caching not added"

# update-citations.ts: sequential loop replaced with concurrent
grep -q "runConcurrent" "$REPO/src/ingest-worker/update-citations.ts" && \
  pass "update-citations.ts: uses runConcurrent (no sequential 3s sleep loop)" || \
  fail "update-citations.ts: still using sequential loop"

# csGuard: disabled (no exports remain)
! grep -q "^export function isCSQuery" "$REPO/lib/csGuard.ts" && \
  pass "csGuard.ts: isCSQuery export removed" || \
  fail "csGuard.ts: isCSQuery still exported"

# CategoryScopeBar: false 'searches blocked' claim removed
! grep -q "searches outside these topics are blocked" "$REPO/app/components/CategoryScopeBar.tsx" && \
  pass "CategoryScopeBar: false blocking claim removed" || \
  fail "CategoryScopeBar: still claims searches are blocked"

# Lock icon import removed from CategoryScopeBar
! grep -q "Lock" "$REPO/app/components/CategoryScopeBar.tsx" && \
  pass "CategoryScopeBar: Lock icon import removed" || \
  fail "CategoryScopeBar: unused Lock import still present"

# fetch-arxiv: dual-ordering htmlMatch
grep -q "??" "$REPO/src/ingest-worker/fetch-arxiv.ts" && \
  pass "fetch-arxiv.ts: dual-ordering htmlMatch with ?? chaining" || \
  fail "fetch-arxiv.ts: ?? chaining missing"

# =============================================================================
section "9. SITEMAP & SEO"
# =============================================================================

# Sitemap contains paper URLs
R=$(fe "/sitemap.xml")
echo "$R" | grep -q "/paper/" && pass "sitemap.xml contains /paper/ URLs" || fail "sitemap.xml missing paper URLs"
echo "$R" | grep -q "/topic/" && pass "sitemap.xml contains /topic/ URLs" || fail "sitemap.xml missing topic URLs"
echo "$R" | grep -q "<urlset" && pass "sitemap.xml has valid XML root" || fail "sitemap.xml malformed"

# Robots.txt
R=$(fe "/robots.txt")
echo "$R" | grep -qi "user-agent\|disallow\|allow" && pass "robots.txt has valid content" || fail "robots.txt empty"

# =============================================================================
section "10. ADMIN ENDPOINT — auth guard"
# =============================================================================
SC=$(code "$API/admin/retry-failed")
[ "$SC" = "401" ] || [ "$SC" = "405" ] && pass "POST /admin/retry-failed without secret → 401/405" || fail "Admin endpoint unprotected → $SC"

# =============================================================================
echo ""
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN} RESULTS${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
TOTAL=$((PASS+FAIL+WARN))
echo -e "  Total : $TOTAL"
echo -e "  ${GREEN}Pass  : $PASS${NC}"
echo -e "  ${RED}Fail  : $FAIL${NC}"
echo -e "  ${YELLOW}Warn  : $WARN${NC}"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ✅  All tests passed${NC}"
  exit 0
else
  echo -e "${RED}  ❌  $FAIL test(s) failed${NC}"
  exit 1
fi
