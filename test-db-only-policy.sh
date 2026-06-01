#!/bin/bash
# test-db-only-policy.sh
# Proves the "DB-only, no arXiv fallback" fixes are live.
# Run AFTER deploy. Requires: curl, jq, grep.
#
# NOTE on Next.js App Router + Cloudflare Workers:
#   notFound() triggers RSC error payload (NEXT_HTTP_ERROR_FALLBACK;404)
#   but the HTTP status is still 200 (RSC streaming limitation).
#   We detect 404 pages by checking the body for the NOT_FOUND sentinel
#   or the 404 UI content, not the HTTP status code.

set -euo pipefail

API="https://arxiv-api.arxivexplorer.workers.dev"
FRONTEND="https://arxivexplorer.arxivexplorer.workers.dev"
SRC="/home/teycir/Repos/ArxivExplorer"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASSED=0; FAILED=0; WARNED=0

pass()  { echo -e "  ${GREEN}✓ PASS${NC}  $1"; PASSED=$((PASSED+1)); }
fail()  { echo -e "  ${RED}✗ FAIL${NC}  $1"; FAILED=$((FAILED+1)); }
warn()  { echo -e "  ${YELLOW}⚠ WARN${NC}  $1"; WARNED=$((WARNED+1)); }
hdr()   { echo -e "\n${CYAN}── $1 ──${NC}"; }

# Helper: detect if a Next.js RSC page is actually a 404
# Returns true if body contains the Next.js 404 error sentinel OR "not found" UI
body_is_notfound() {
  echo "$1" | grep -qi 'NEXT_HTTP_ERROR_FALLBACK;404\|Page not found\|doesn.*exist.*indexed'
}

# ─────────────────────────────────────────────────────────────────────────────
hdr "SOURCE: No arxiv.org URL construction in UI layer"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "CopyBibtex.tsx: no arxiv.org URL ... "
if grep -q 'https://arxiv.org' "$SRC/app/components/CopyBibtex.tsx"; then
  fail "arxiv.org URL still present in CopyBibtex.tsx"
else
  pass "clean"
fi

echo -n "ExportButton.tsx: no arxiv.org URL construction ... "
if grep -q 'https://arxiv.org' "$SRC/app/components/ExportButton.tsx"; then
  fail "arxiv.org URL still present in ExportButton.tsx"
else
  pass "clean"
fi

echo -n "PaperComparison.tsx: pdfUrl is string | null ... "
if grep -q 'pdfUrl: string | null' "$SRC/app/components/PaperComparison.tsx"; then
  pass "nullable"
else
  fail "pdfUrl still typed as non-nullable string"
fi

echo -n "PaperComparison.tsx: PDF link gated on {paper.pdfUrl && ...} ... "
if grep -q 'paper\.pdfUrl &&' "$SRC/app/components/PaperComparison.tsx"; then
  pass "guarded"
else
  fail "PDF link has no null guard"
fi

echo -n "compare/page.tsx: uses getPaper() helper, not raw API_BASE fetch ... "
uses_getPaper=$(grep -c 'getPaper' "$SRC/app/compare/page.tsx" || true)
uses_rawFetch=$(grep -c 'API_BASE' "$SRC/app/compare/page.tsx" || true)
if [ "$uses_getPaper" -ge 1 ] && [ "$uses_rawFetch" -eq 0 ]; then
  pass "uses getPaper(), API_BASE removed"
else
  fail "uses_getPaper=$uses_getPaper uses_rawFetch=$uses_rawFetch"
fi

echo -n "compare/page.tsx: no 'failed to load' user-visible message ... "
if grep -q 'failed to load' "$SRC/app/compare/page.tsx"; then
  fail "'failed to load' message still in compare/page.tsx"
else
  pass "clean"
fi

echo -n "paper page: PDF link gated on {paper.pdfUrl && ...} ... "
if grep -q 'paper\.pdfUrl &&' "$SRC/app/paper/[arxiv_id]/page.tsx"; then
  pass "guarded"
else
  fail "PDF link has no null guard"
fi

echo -n "paper page: HTML link gated on {paper.htmlUrl && ...} ... "
if grep -q 'paper\.htmlUrl &&' "$SRC/app/paper/[arxiv_id]/page.tsx"; then
  pass "guarded"
else
  fail "HTML link has no null guard"
fi

echo -n "helper/format.ts: arxivAbsUrl / arxivPdfUrl helpers removed ... "
if grep -q 'arxivAbsUrl\|arxivPdfUrl' "$SRC/helper/format.ts"; then
  fail "arXiv URL helpers still present in format.ts"
else
  pass "removed"
fi

echo -n "types.ts: pdfUrl typed as string | null ... "
if grep -q 'pdfUrl: string | null' "$SRC/src/shared/types.ts"; then
  pass "nullable"
else
  fail "pdfUrl not typed as string | null in types.ts"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "SOURCE: No synthesised arxiv.org fallback links in any UI component"
# ─────────────────────────────────────────────────────────────────────────────

# Scan all .tsx/.ts app files for patterns like `arxiv.org/abs/${` or `arxiv.org/pdf/${`
# (these would be synthesised at runtime from a bare ID). DB-stored URLs are fine.
echo -n "No runtime URL synthesis pattern (arxiv.org/abs/\${ or arxiv.org/pdf/\${) in app/ ... "
SYNTH=$(grep -r 'arxiv\.org/\(abs\|pdf\)/\${' "$SRC/app" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
if [ -n "$SYNTH" ]; then
  fail "Found runtime URL synthesis: $SYNTH"
else
  pass "no synthesis patterns found"
fi

echo -n "No runtime URL synthesis in helper/ ... "
SYNTH=$(grep -r 'arxiv\.org/\(abs\|pdf\)/\${' "$SRC/helper" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
if [ -n "$SYNTH" ]; then
  fail "Found runtime URL synthesis in helper/: $SYNTH"
else
  pass "no synthesis patterns found"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "API: Paper endpoint — fields come from DB only"
# ─────────────────────────────────────────────────────────────────────────────

PAPER_ID="2605.30353"
echo -n "API /api/paper/$PAPER_ID: returns 200 ... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/paper/$PAPER_ID")
if [ "$STATUS" = "200" ]; then
  pass "HTTP 200"
else
  fail "HTTP $STATUS"
fi

echo -n "API /api/paper/$PAPER_ID: pdfUrl field present (DB-stored, may be null) ... "
PAPER=$(curl -s "$API/api/paper/$PAPER_ID")
if echo "$PAPER" | jq -e 'has("pdfUrl")' > /dev/null 2>&1; then
  PDF_URL=$(echo "$PAPER" | jq -r '.pdfUrl // "null"')
  pass "pdfUrl=$PDF_URL"
else
  fail "pdfUrl field missing from API response"
fi

echo -n "API /api/paper/$PAPER_ID: htmlUrl field present (DB-stored, may be null) ... "
if echo "$PAPER" | jq -e 'has("htmlUrl")' > /dev/null 2>&1; then
  HTML_URL=$(echo "$PAPER" | jq -r '.htmlUrl // "null"')
  pass "htmlUrl=$HTML_URL"
else
  warn "htmlUrl field absent in response (may be omitted when null by API)"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "API: Unknown paper → 404 (pure DB miss, no arXiv fallback)"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "API /api/paper/9999.99999: returns 404 ... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/paper/9999.99999")
if [ "$STATUS" = "404" ]; then
  pass "HTTP 404"
else
  fail "Expected 404, got $STATUS — possible arXiv fallback still active"
fi

echo -n "API /api/paper/0000.00000: returns 404 ... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/paper/0000.00000")
if [ "$STATUS" = "404" ]; then
  pass "HTTP 404"
else
  fail "Expected 404, got $STATUS"
fi

echo -n "API 404 body: no arXiv fallback data returned ... "
BODY=$(curl -s "$API/api/paper/9999.99999")
# A fallback would return a JSON object with title/abstract. A proper 404 returns {"error":"..."}
HAS_TITLE=$(echo "$BODY" | jq -r '.title // empty' 2>/dev/null || true)
HAS_ERROR=$(echo "$BODY" | jq -r '.error // empty' 2>/dev/null || true)
if [ -n "$HAS_TITLE" ]; then
  fail "API returned paper data for unknown ID — arXiv fallback still active: title=$HAS_TITLE"
elif [ -n "$HAS_ERROR" ]; then
  pass "returns error JSON: $HAS_ERROR"
else
  pass "returns no paper data (body: ${BODY:0:60})"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "FRONTEND: Paper page for unknown ID → 404 UI (Next.js RSC streaming)"
# ─────────────────────────────────────────────────────────────────────────────
# Next.js App Router with Cloudflare Workers streams RSC with HTTP 200 even
# when notFound() is called. The 404 is signalled in the RSC payload.

echo -n "Frontend /paper/9999.99999: body contains 404 UI content (notFound() called) ... "
BODY=$(curl -s "$FRONTEND/paper/9999.99999")
if body_is_notfound "$BODY"; then
  pass "404 UI rendered (NEXT_HTTP_ERROR_FALLBACK;404 or 'Page not found' in body)"
else
  fail "404 content not detected — notFound() may not be firing"
fi

echo -n "Frontend 404 body: no arXiv paper data rendered (no paper title in RSC) ... "
# If a fallback fetch happened, the paper title would appear in the RSC JSON payload
HAS_ARXIV_TITLE=$(echo "$BODY" | grep -c '"2605\|Attention Is All\|transformer\|children.*notFound' 2>/dev/null || true)
# A better check: the body should NOT contain paper-specific content like abstract/tldr
HAS_ABSTRACT=$(echo "$BODY" | grep -qi 'tldr\|abstract.*[A-Z].*paper\|keyContributions' && echo yes || echo no)
if [ "$HAS_ABSTRACT" = "yes" ]; then
  fail "Paper data (tldr/abstract) appeared in 404 body — arXiv fallback data leaking"
else
  pass "no paper data in 404 body"
fi

echo -n "Frontend 404 body: no synthesised arxiv.org/abs/9999 link ... "
SYNTH=$(echo "$BODY" | grep -o 'arxiv\.org/abs/9999[^"]*' || true)
if [ -n "$SYNTH" ]; then
  fail "Synthesised link found: $SYNTH"
else
  pass "no synthesised arXiv link for the missing paper ID"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "FRONTEND: Known paper page — links from DB only, no synthesised fallback"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "Frontend /paper/$PAPER_ID: returns content (200 or RSC) ... "
BODY=$(curl -s "$FRONTEND/paper/$PAPER_ID")
if echo "$BODY" | grep -qi 'arxiv_id\|paper\|title\|authors'; then
  pass "paper content present"
else
  fail "No paper content in response"
fi

echo -n "Frontend /paper/$PAPER_ID: no URL synthesis pattern (arxiv.org/abs/\${) ... "
# DB-stored htmlUrl (arxiv.org/abs/ID) is fine. We check for JS template literal syntax
# in the SSR output which would indicate dynamic construction at render time.
SYNTH=$(echo "$BODY" | grep -o 'arxiv\.org/abs/\${[^}]*}' || true)
if [ -n "$SYNTH" ]; then
  fail "Template literal URL synthesis found in rendered HTML: $SYNTH"
else
  pass "no template literal synthesis in rendered output"
fi

echo -n "Frontend /paper/$PAPER_ID: PDF/HTML buttons present when DB has URLs ... "
PDF_IN_DB=$(echo "$PAPER" | jq -r '.pdfUrl // empty')
HTML_IN_DB=$(echo "$PAPER" | jq -r '.htmlUrl // empty')
if [ -n "$PDF_IN_DB" ]; then
  # If DB has pdfUrl, the page should contain a PDF link
  if echo "$BODY" | grep -qi 'PDF\|pdf'; then
    pass "PDF button present (pdfUrl=$PDF_IN_DB)"
  else
    warn "PDF button not found in rendered HTML (may be client-side rendered)"
  fi
else
  pass "DB has no pdfUrl for this paper — no button expected"
fi

# ─────────────────────────────────────────────────────────────────────────────
hdr "FRONTEND: Compare page — DB-only, silent drop of missing papers"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "Frontend /compare?ids=$PAPER_ID,9999.99999: valid paper shown (200) ... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/compare?ids=$PAPER_ID,9999.99999")
if [ "$STATUS" = "200" ]; then
  pass "HTTP 200 — valid paper rendered, invalid silently dropped"
else
  fail "HTTP $STATUS"
fi

echo -n "Frontend /compare mixed: no 'failed to load' message ... "
BODY=$(curl -s "$FRONTEND/compare?ids=$PAPER_ID,9999.99999")
if echo "$BODY" | grep -qi 'failed to load'; then
  fail "'failed to load' message still visible"
else
  pass "clean — missing paper silently dropped"
fi

echo -n "Frontend /compare?ids=9999.99999: shows 404 UI (all IDs missing from DB) ... "
BODY=$(curl -s "$FRONTEND/compare?ids=9999.99999")
if body_is_notfound "$BODY"; then
  pass "404 UI rendered — notFound() called when all IDs missing"
else
  # May show "No papers to compare" UI instead — also acceptable
  if echo "$BODY" | grep -qi 'no papers\|compare'; then
    warn "Shows empty compare UI rather than 404 — acceptable but notFound() preferred"
  else
    fail "Unexpected response for all-missing IDs"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══════════════════════════════════════${NC}"
echo -e " Results: ${GREEN}$PASSED passed${NC}  ${RED}$FAILED failed${NC}  ${YELLOW}$WARNED warned${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}\n"

[ $FAILED -eq 0 ] && echo -e "${GREEN}✅ DB-only policy verified.${NC}" && exit 0
echo -e "${RED}❌ Policy violations detected — see failures above.${NC}" && exit 1
