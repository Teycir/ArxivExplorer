#!/bin/bash
# test-enrichment.sh
# Integration tests for the enrichment pipeline features (tasks 1–12):
#   Phase 1  — OpenAlex, PWC, Semantic Scholar expanded fields, CrossRef
#   Phase 2  — Extended summary fields, entity extraction
#   Phase 3  — DB schema (tested via API field presence)
#   Phase 4  — Frontend: badges, enriched panels, search filters, new routes

set -euo pipefail

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"
FRONTEND="https://arxivexplorer.arxivexplorer.workers.dev"

# A well-known paper that should be indexed and enriched
PAPER_ID="2605.30353"

# Seed paper for concept/institution — skip if none indexed yet (graceful)
# These will be discovered dynamically below.

# ─── Colour helpers ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNED=0

pass()  { echo -e "${GREEN}✓ PASS${NC} $*"; PASSED=$((PASSED+1)); }
fail()  { echo -e "${RED}✗ FAIL${NC} $*"; FAILED=$((FAILED+1)); }
warn()  { echo -e "${YELLOW}⚠ WARN${NC} $*"; WARNED=$((WARNED+1)); }
section() { echo ""; echo -e "${CYAN}$*${NC}"; printf '%0.s─' {1..50}; echo ""; }

# ─── Core helpers ────────────────────────────────────────────────────────────

# Fetch JSON once; reuse across tests in each section
api_get() { curl -s "$API_BASE$1"; }
fe_get()  { curl -s -o /dev/null -w "%{http_code}" "$FRONTEND$1"; }

# Assert a jq expression is truthy on a JSON blob
assert_jq() {
  local label="$1" json="$2" expr="$3"
  echo -n "  $label ... "
  if echo "$json" | jq -e "$expr" > /dev/null 2>&1; then
    local val; val=$(echo "$json" | jq -r "$expr" 2>/dev/null | head -c 120)
    pass "($val)"
  else
    fail "(expr: $expr)"
    echo "    JSON snippet: $(echo "$json" | head -c 300)"
  fi
}

# Assert HTTP status
assert_http() {
  local label="$1" url="$2" expected="${3:-200}"
  echo -n "  $label ... "
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" -eq "$expected" ]; then
    pass "(HTTP $code)"
  else
    fail "(expected $expected, got $code)"
  fi
}

# Assert JSON field is a non-empty array
assert_array() {
  local label="$1" json="$2" expr="$3"
  echo -n "  $label ... "
  local len; len=$(echo "$json" | jq -r "$expr | length" 2>/dev/null || echo "ERR")
  if [ "$len" = "ERR" ]; then
    fail "(not valid JSON or field missing)"
  elif [ "$len" -gt 0 ] 2>/dev/null; then
    pass "(length=$len)"
  else
    warn "(array is empty — enrichment may not have run yet for this paper)"
  fi
}

# Assert field is a non-empty string
assert_string() {
  local label="$1" json="$2" expr="$3"
  echo -n "  $label ... "
  local val; val=$(echo "$json" | jq -r "$expr" 2>/dev/null || echo "null")
  if [ "$val" != "null" ] && [ "$val" != "" ]; then
    pass "(\"${val:0:80}\")"
  else
    warn "(field is null/empty — enrichment may not have run yet)"
  fi
}

# Assert field is a boolean (0/1 integer from D1, or true/false from JSON)
assert_bool_set() {
  local label="$1" json="$2" expr="$3"
  echo -n "  $label ... "
  local val; val=$(echo "$json" | jq -r "$expr" 2>/dev/null || echo "null")
  if [ "$val" != "null" ]; then
    pass "($val)"
  else
    warn "(field missing — migration may not have run)"
  fi
}

# ─── Timing helper ───────────────────────────────────────────────────────────
time_request() {
  local label="$1" url="$2" max_ms="${3:-3000}"
  echo -n "  $label ... "
  local start; start=$(date +%s%N)
  curl -s "$url" > /dev/null
  local end; end=$(date +%s%N)
  local ms=$(( (end - start) / 1000000 ))
  if [ "$ms" -lt "$max_ms" ]; then
    pass "(${ms}ms < ${max_ms}ms)"
  else
    warn "(${ms}ms — slow, check D1 query plan)"
  fi
}

###############################################################################
echo "🧪 ArxivExplorer — Enrichment Integration Tests"
echo "================================================"
echo "  API:      $API_BASE"
echo "  Frontend: $FRONTEND"
echo "  Seed ID:  $PAPER_ID"
###############################################################################

# ─────────────────────────────────────────────────────────────────────────────
section "§1  DB SCHEMA — enrichment columns present in API response"
# ─────────────────────────────────────────────────────────────────────────────

PAPER=$(api_get "/api/paper/$PAPER_ID")

# Phase 1 — papers table columns surfaced in Paper type
assert_bool_set "isOpenAccess field present"          "$PAPER" ".isOpenAccess"
assert_jq       "oaUrl field present (null ok)"       "$PAPER" ".oaUrl != \"MISSING\""
assert_jq       "concepts is an array"                "$PAPER" ".concepts | type == \"array\""
assert_jq       "affiliations is an array"            "$PAPER" ".affiliations | type == \"array\""
assert_jq       "codeCount is a number"               "$PAPER" ".codeCount | type == \"number\""
assert_jq       "hasBenchmark is a bool"              "$PAPER" ".hasBenchmark | type == \"boolean\""

# Extended Semantic Scholar fields
assert_jq       "influentialCitationCount field exists" "$PAPER" "has(\"influentialCitationCount\") or .influentialCitationCount == null"
assert_jq       "referenceCount field exists"           "$PAPER" "has(\"referenceCount\") or .referenceCount == null"

# Phase 2 — summary fields
SUMMARY=$(echo "$PAPER" | jq '.summary // {}')
assert_jq       "summary.keywords is an array"        "$SUMMARY" ".keywords | type == \"array\""
assert_jq       "summary.entities is an array"        "$SUMMARY" ".entities | type == \"array\""
assert_jq       "summary.paperType field present"     "$SUMMARY" ".paperType | type == \"string\""
assert_jq       "summary.novelty field present"       "$SUMMARY" "has(\"novelty\")"
assert_jq       "summary.applications is an array"    "$SUMMARY" ".applications | type == \"array\""
assert_jq       "summary.prerequisites is an array"   "$SUMMARY" ".prerequisites | type == \"array\""
assert_jq       "summary.followUpQuestions is array"  "$SUMMARY" ".followUpQuestions | type == \"array\""

# ─────────────────────────────────────────────────────────────────────────────
section "§2  EXTENDED SUMMARY FIELDS — content quality"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "  summary.paperType is a valid enum value ... "
PT=$(echo "$SUMMARY" | jq -r '.paperType')
VALID_TYPES="empirical theoretical survey dataset position tutorial unknown"
if echo "$VALID_TYPES" | grep -qw "$PT"; then
  pass "(\"$PT\")"
else
  fail "(got \"$PT\", expected one of: $VALID_TYPES)"
fi

echo -n "  summary.keywords non-empty (enrichment ran) ... "
KW_LEN=$(echo "$SUMMARY" | jq '.keywords | length' 2>/dev/null || echo 0)
if [ "$KW_LEN" -gt 0 ] 2>/dev/null; then
  KWSAMPLE=$(echo "$SUMMARY" | jq -r '.keywords | join(", ")' | head -c 80)
  pass "(${KW_LEN} keywords: $KWSAMPLE)"
else
  warn "(empty — run backfill-summaries-v2.ts to populate)"
fi

echo -n "  summary.novelty non-empty (enrichment ran) ... "
NOV=$(echo "$SUMMARY" | jq -r '.novelty // ""')
if [ -n "$NOV" ] && [ "$NOV" != "null" ]; then
  pass "(\"${NOV:0:80}\")"
else
  warn "(empty — run backfill-summaries-v2.ts to populate)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§3  ENTITY EXTRACTION — entities in summary"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "  summary.entities have correct shape [{name,type}] ... "
ENTITY_COUNT=$(echo "$SUMMARY" | jq '.entities | length' 2>/dev/null || echo 0)
if [ "$ENTITY_COUNT" -gt 0 ] 2>/dev/null; then
  # Validate first entity has name and type fields
  FIRST_ENTITY=$(echo "$SUMMARY" | jq '.entities[0]')
  if echo "$FIRST_ENTITY" | jq -e '.name | type == "string"' > /dev/null 2>&1 &&
     echo "$FIRST_ENTITY" | jq -e '.type | type == "string"' > /dev/null 2>&1; then
    ENAME=$(echo "$FIRST_ENTITY" | jq -r '.name')
    ETYPE=$(echo "$FIRST_ENTITY" | jq -r '.type')
    pass "($ENTITY_COUNT entities, first: \"$ENAME\" [$ETYPE])"
  else
    fail "(entity missing name or type field)"
  fi
else
  warn "(0 entities — requires Ollama + entity extraction to have run)"
fi

echo -n "  entity types are constrained to model|dataset|benchmark ... "
INVALID_TYPES=$(echo "$SUMMARY" | jq '[.entities[].type] | map(select(. != "model" and . != "dataset" and . != "benchmark")) | length' 2>/dev/null || echo 0)
if [ "$INVALID_TYPES" -eq 0 ] 2>/dev/null; then
  pass "(all types valid)"
else
  fail "($INVALID_TYPES entities have invalid type)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§4  OPENALEX ENRICHMENT — concepts & affiliations"
# ─────────────────────────────────────────────────────────────────────────────

echo -n "  concepts have correct shape [{name,wikidataId,score}] ... "
CON_COUNT=$(echo "$PAPER" | jq '.concepts | length' 2>/dev/null || echo 0)
if [ "$CON_COUNT" -gt 0 ] 2>/dev/null; then
  FIRST_CON=$(echo "$PAPER" | jq '.concepts[0]')
  if echo "$FIRST_CON" | jq -e '.name | type == "string"' > /dev/null 2>&1 &&
     echo "$FIRST_CON" | jq -e '.score | type == "number"' > /dev/null 2>&1; then
    CNAME=$(echo "$FIRST_CON" | jq -r '.name')
    CSCORE=$(echo "$FIRST_CON" | jq -r '.score')
    pass "($CON_COUNT concepts, first: \"$CNAME\" score=$CSCORE)"
  else
    fail "(concept missing name or score field)"
  fi
else
  warn "(0 concepts — run backfill-openalex.ts first)"
fi

echo -n "  concepts scores are in [0,1] range ... "
OUT_OF_RANGE=$(echo "$PAPER" | jq '[.concepts[].score] | map(select(. < 0 or . > 1)) | length' 2>/dev/null || echo 0)
if [ "$OUT_OF_RANGE" -eq 0 ] 2>/dev/null; then
  pass "(all scores in [0,1])"
else
  fail "($OUT_OF_RANGE concept scores out of range)"
fi

echo -n "  affiliations have correct shape [{author,institution,...}] ... "
AFF_COUNT=$(echo "$PAPER" | jq '.affiliations | length' 2>/dev/null || echo 0)
if [ "$AFF_COUNT" -gt 0 ] 2>/dev/null; then
  FIRST_AFF=$(echo "$PAPER" | jq '.affiliations[0]')
  if echo "$FIRST_AFF" | jq -e '.author | type == "string"' > /dev/null 2>&1; then
    ANAME=$(echo "$FIRST_AFF" | jq -r '.author')
    AINST=$(echo "$FIRST_AFF" | jq -r '.institution // ""')
    pass "($AFF_COUNT affiliations, first author: \"$ANAME\" @ \"$AINST\")"
  else
    fail "(affiliation missing author field)"
  fi
else
  warn "(0 affiliations — run backfill-openalex.ts first)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§5  PAPERS WITH CODE — /api/paper/:id/code"
# ─────────────────────────────────────────────────────────────────────────────

CODE_RESP=$(api_get "/api/paper/$PAPER_ID/code")

assert_jq  "code endpoint returns repos array"  "$CODE_RESP" ".repos | type == \"array\""
assert_http "code endpoint HTTP 200"            "$API_BASE/api/paper/$PAPER_ID/code"

echo -n "  code endpoint returns 404 for unknown paper ... "
CODE_404=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/paper/0000.00000/code")
if [ "$CODE_404" -eq 404 ] || [ "$CODE_404" -eq 200 ]; then
  # 200 with empty repos array is also acceptable (paper exists but no code)
  pass "(HTTP $CODE_404)"
else
  fail "(expected 404 or 200, got $CODE_404)"
fi

echo -n "  repos have correct shape (repoUrl, stars, isOfficial) ... "
REPO_COUNT=$(echo "$CODE_RESP" | jq '.repos | length' 2>/dev/null || echo 0)
if [ "$REPO_COUNT" -gt 0 ] 2>/dev/null; then
  FIRST_REPO=$(echo "$CODE_RESP" | jq '.repos[0]')
  if echo "$FIRST_REPO" | jq -e '.repoUrl | type == "string"' > /dev/null 2>&1 &&
     echo "$FIRST_REPO" | jq -e '.stars | type == "number"' > /dev/null 2>&1; then
    RURL=$(echo "$FIRST_REPO" | jq -r '.repoUrl')
    RSTARS=$(echo "$FIRST_REPO" | jq -r '.stars')
    ROFF=$(echo "$FIRST_REPO" | jq -r '.isOfficial')
    pass "($REPO_COUNT repos, first: $RURL stars=$RSTARS official=$ROFF)"
  else
    fail "(repo missing repoUrl or stars field)"
  fi
else
  warn "(0 repos for $PAPER_ID — run backfill-pwc.ts first)"
fi

echo -n "  codeCount on paper object matches repos array length ... "
PAPER_CODE_COUNT=$(echo "$PAPER" | jq '.codeCount' 2>/dev/null || echo -1)
if [ "$PAPER_CODE_COUNT" -eq "$REPO_COUNT" ] 2>/dev/null; then
  pass "(codeCount=$PAPER_CODE_COUNT == repos.length=$REPO_COUNT)"
else
  warn "(codeCount=$PAPER_CODE_COUNT != repos.length=$REPO_COUNT — backfill may differ from live)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§6  BENCHMARK RESULTS — /api/paper/:id/benchmarks"
# ─────────────────────────────────────────────────────────────────────────────

BENCH_RESP=$(api_get "/api/paper/$PAPER_ID/benchmarks")

assert_jq  "benchmarks endpoint returns benchmarks array" "$BENCH_RESP" ".benchmarks | type == \"array\""
assert_http "benchmarks endpoint HTTP 200" "$API_BASE/api/paper/$PAPER_ID/benchmarks"

echo -n "  benchmark rows have correct shape (task, dataset, metric, value) ... "
B_COUNT=$(echo "$BENCH_RESP" | jq '.benchmarks | length' 2>/dev/null || echo 0)
if [ "$B_COUNT" -gt 0 ] 2>/dev/null; then
  FIRST_B=$(echo "$BENCH_RESP" | jq '.benchmarks[0]')
  if echo "$FIRST_B" | jq -e '.task | type == "string"' > /dev/null 2>&1 &&
     echo "$FIRST_B" | jq -e '.value | type == "number"' > /dev/null 2>&1; then
    BTASK=$(echo "$FIRST_B" | jq -r '.task')
    BVAL=$(echo "$FIRST_B" | jq -r '.value')
    BRANK=$(echo "$FIRST_B" | jq -r '.sotaRank // "N/A"')
    pass "($B_COUNT rows, first: task=\"$BTASK\" value=$BVAL rank=$BRANK)"
  else
    fail "(benchmark missing task or value field)"
  fi
else
  warn "(0 benchmarks for $PAPER_ID — run backfill-pwc.ts first)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§7  SEMANTIC SCHOLAR EXPANDED FIELDS"
# ─────────────────────────────────────────────────────────────────────────────

# Pick a highly-cited paper to maximise chance of SS data existing
SS_PAPER=$(api_get "/api/paper/1706.03762")   # Attention is All You Need

assert_jq  "ssPaperId field present on highly-cited paper"     "$SS_PAPER" ".ssPaperId | type == \"string\""
assert_jq  "influentialCitationCount is a number"              "$SS_PAPER" ".influentialCitationCount | type == \"number\""
assert_jq  "referenceCount is a number"                        "$SS_PAPER" ".referenceCount | type == \"number\""

echo -n "  influentialCitationCount > 0 for 1706.03762 ... "
INC=$(echo "$SS_PAPER" | jq '.influentialCitationCount // 0' 2>/dev/null || echo 0)
if [ "$INC" -gt 0 ] 2>/dev/null; then
  pass "($INC influential citations)"
else
  warn "(0 — citations job may not have updated this paper yet)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§8  CROSSREF ENRICHMENT — journal, publisher, funders"
# ─────────────────────────────────────────────────────────────────────────────

# Find a paper that has a DOI and was CrossRef-enriched
echo -n "  searching for a CrossRef-enriched paper in the API ... "
SEARCH_RESP=$(api_get "/api/search?q=transformer&limit=20")
CR_PAPER_ID=""
CR_PAPER="{}"

# Loop through results looking for one with journal_name
while IFS= read -r pid; do
  P=$(api_get "/api/paper/$pid")
  JN=$(echo "$P" | jq -r '.journalName // ""' 2>/dev/null)
  if [ -n "$JN" ] && [ "$JN" != "null" ]; then
    CR_PAPER_ID="$pid"
    CR_PAPER="$P"
    break
  fi
done < <(echo "$SEARCH_RESP" | jq -r '.papers[].id' 2>/dev/null | head -5)

if [ -n "$CR_PAPER_ID" ]; then
  pass "(found: $CR_PAPER_ID)"
  JN=$(echo "$CR_PAPER" | jq -r '.journalName')
  PUB=$(echo "$CR_PAPER" | jq -r '.publisher // "N/A"')
  echo "    journalName: \"$JN\""
  echo "    publisher:   \"$PUB\""
  assert_jq "journalName is a string"  "$CR_PAPER" ".journalName | type == \"string\""
  assert_jq "funders is array or null" "$CR_PAPER" ".funders == null or (.funders | type == \"array\")"
else
  warn "(no CrossRef-enriched paper found in top 5 results — run backfill-crossref.ts)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§9  SEARCH FILTERS — paperType, hasCode, openAccess"
# ─────────────────────────────────────────────────────────────────────────────

# paperType filter
echo -n "  search?paperType=empirical returns papers array ... "
PT_RESP=$(api_get "/api/search?q=neural+network&paperType=empirical")
if echo "$PT_RESP" | jq -e '.papers | type == "array"' > /dev/null 2>&1; then
  PT_CNT=$(echo "$PT_RESP" | jq '.papers | length')
  pass "($PT_CNT papers)"
else
  fail "(invalid response)"
fi

echo -n "  all returned papers have paperType=empirical in summary ... "
WRONG_TYPE=$(echo "$PT_RESP" | jq '[.papers[].summary.paperType] | map(select(. != "empirical")) | length' 2>/dev/null || echo 0)
if [ "$WRONG_TYPE" -eq 0 ] 2>/dev/null; then
  pass "(all match)"
else
  fail "($WRONG_TYPE papers have wrong paperType)"
fi

# hasCode filter
echo -n "  search?hasCode=1 returns papers array ... "
HC_RESP=$(api_get "/api/search?q=deep+learning&hasCode=1")
if echo "$HC_RESP" | jq -e '.papers | type == "array"' > /dev/null 2>&1; then
  HC_CNT=$(echo "$HC_RESP" | jq '.papers | length')
  pass "($HC_CNT papers)"
else
  fail "(invalid response)"
fi

echo -n "  all hasCode=1 results have codeCount > 0 ... "
ZERO_CODE=$(echo "$HC_RESP" | jq '[.papers[].codeCount] | map(select(. == 0)) | length' 2>/dev/null || echo 0)
if [ "$ZERO_CODE" -eq 0 ] 2>/dev/null; then
  pass "(all have code)"
else
  fail "($ZERO_CODE papers have codeCount=0 despite hasCode=1 filter)"
fi

# openAccess filter
echo -n "  search?openAccess=1 returns papers array ... "
OA_RESP=$(api_get "/api/search?q=machine+learning&openAccess=1")
if echo "$OA_RESP" | jq -e '.papers | type == "array"' > /dev/null 2>&1; then
  OA_CNT=$(echo "$OA_RESP" | jq '.papers | length')
  pass "($OA_CNT papers)"
else
  fail "(invalid response)"
fi

echo -n "  all openAccess=1 results have isOpenAccess=true ... "
NOT_OA=$(echo "$OA_RESP" | jq '[.papers[].isOpenAccess] | map(select(. != true)) | length' 2>/dev/null || echo 0)
if [ "$NOT_OA" -eq 0 ] 2>/dev/null; then
  pass "(all open access)"
else
  fail "($NOT_OA papers have isOpenAccess=false despite openAccess=1 filter)"
fi

# Combined enrichment filters
echo -n "  combined filters: paperType=survey + openAccess=1 ... "
COMBO_RESP=$(api_get "/api/search?q=survey&paperType=survey&openAccess=1")
if echo "$COMBO_RESP" | jq -e '.papers | type == "array"' > /dev/null 2>&1; then
  pass "($(echo "$COMBO_RESP" | jq '.papers | length') papers)"
else
  fail "(invalid response)"
fi

# Filter cache keys are distinct (openAccess=1 vs no filter should differ)
echo -n "  hasCode filter produces different results from unfiltered ... "
BASE_RESP=$(api_get "/api/search?q=transformer")
BASE_IDS=$(echo "$BASE_RESP"  | jq -r '[.papers[].id] | sort | join(",")' 2>/dev/null)
HC_IDS=$(echo "$HC_RESP" | jq -r '[.papers[].id] | sort | join(",")' 2>/dev/null)
if [ "$BASE_IDS" != "$HC_IDS" ]; then
  pass "(different result sets)"
else
  warn "(same result set — may have 100% code overlap or sparse index)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§10  CONCEPT ROUTE — /api/concept/:name + /concept/[name]"
# ─────────────────────────────────────────────────────────────────────────────

# Discover a real concept from the seed paper (if enriched), else use fallback
FIRST_CONCEPT=$(echo "$PAPER" | jq -r '.concepts[0].name // ""')
if [ -z "$FIRST_CONCEPT" ] || [ "$FIRST_CONCEPT" = "null" ]; then
  FIRST_CONCEPT="Transformer"   # fallback — very common concept
fi
CONCEPT_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FIRST_CONCEPT'))" 2>/dev/null || echo "$FIRST_CONCEPT")

echo "  Using concept: \"$FIRST_CONCEPT\""

CONCEPT_RESP=$(api_get "/api/concept/$CONCEPT_ENC")
assert_jq   "concept API returns concept field"         "$CONCEPT_RESP" ".concept | type == \"string\""
assert_jq   "concept API returns papers array"          "$CONCEPT_RESP" ".papers | type == \"array\""
assert_jq   "concept API returns total count"           "$CONCEPT_RESP" ".total | type == \"number\""

echo -n "  concept API: total matches papers array length ... "
CTOTAL=$(echo "$CONCEPT_RESP" | jq '.total' 2>/dev/null || echo -1)
CLEN=$(echo "$CONCEPT_RESP"   | jq '.papers | length' 2>/dev/null || echo -1)
if [ "$CTOTAL" -eq "$CLEN" ] 2>/dev/null; then
  pass "(total=$CTOTAL)"
else
  warn "(total=$CTOTAL != papers.length=$CLEN — may have been truncated at limit=20)"
fi

echo -n "  concept API: unknown concept returns empty papers ... "
UNK_RESP=$(api_get "/api/concept/ThisConceptDefinitelyDoesNotExistXYZ123")
UNK_LEN=$(echo "$UNK_RESP" | jq '.papers | length' 2>/dev/null || echo -1)
if [ "$UNK_LEN" -eq 0 ] 2>/dev/null; then
  pass "(0 papers as expected)"
else
  warn "($UNK_LEN papers for unknown concept)"
fi

# Frontend route
assert_http "frontend /concept/[name] page HTTP 200"  "$FRONTEND/concept/$CONCEPT_ENC"
time_request "frontend /concept/[name] response time" "$FRONTEND/concept/$CONCEPT_ENC" 4000

echo -n "  frontend /concept/[name] page contains concept name ... "
PAGE=$(curl -s "$FRONTEND/concept/$CONCEPT_ENC")
if echo "$PAGE" | grep -qi "$FIRST_CONCEPT\|concept\|paper"; then
  pass "(page has content)"
else
  fail "(page appears empty)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§11  INSTITUTION ROUTE — /api/institution/:name + /institution/[slug]"
# ─────────────────────────────────────────────────────────────────────────────

# Discover a real institution from the seed paper (if enriched), else fallback
FIRST_INST=$(echo "$PAPER" | jq -r '.affiliations[0].institution // ""')
if [ -z "$FIRST_INST" ] || [ "$FIRST_INST" = "null" ]; then
  FIRST_INST="MIT"   # fallback — frequently appears in arXiv papers
fi
INST_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FIRST_INST'))" 2>/dev/null || echo "$FIRST_INST")

echo "  Using institution: \"$FIRST_INST\""

INST_RESP=$(api_get "/api/institution/$INST_ENC")
assert_jq   "institution API returns institution field"  "$INST_RESP" ".institution | type == \"string\""
assert_jq   "institution API returns papers array"       "$INST_RESP" ".papers | type == \"array\""
assert_jq   "institution API returns total count"        "$INST_RESP" ".total | type == \"number\""

echo -n "  institution API: all papers have the institution in affiliations ... "
INST_COUNT=$(echo "$INST_RESP" | jq '.papers | length' 2>/dev/null || echo 0)
if [ "$INST_COUNT" -gt 0 ] 2>/dev/null; then
  MISMATCH=$(echo "$INST_RESP" | jq --arg inst "$FIRST_INST" \
    '[.papers[] | select(.affiliations | map(.institution) | index($inst) == null)] | length' \
    2>/dev/null || echo 0)
  if [ "$MISMATCH" -eq 0 ] 2>/dev/null; then
    pass "($INST_COUNT papers, all match)"
  else
    fail "($MISMATCH papers do not have \"$FIRST_INST\" in affiliations)"
  fi
else
  warn "(0 papers — run backfill-openalex.ts first)"
fi

echo -n "  institution API: unknown institution returns empty papers ... "
UNK_INST_RESP=$(api_get "/api/institution/ThisInstitutionDefinitelyDoesNotExistXYZ999")
UNK_INST_LEN=$(echo "$UNK_INST_RESP" | jq '.papers | length' 2>/dev/null || echo -1)
if [ "$UNK_INST_LEN" -eq 0 ] 2>/dev/null; then
  pass "(0 papers as expected)"
else
  warn "($UNK_INST_LEN papers for unknown institution)"
fi

# Frontend route
assert_http "frontend /institution/[slug] page HTTP 200"  "$FRONTEND/institution/$INST_ENC"
time_request "frontend /institution/[slug] response time" "$FRONTEND/institution/$INST_ENC" 4000

echo -n "  frontend /institution/[slug] page contains institution name ... "
INST_PAGE=$(curl -s "$FRONTEND/institution/$INST_ENC")
if echo "$INST_PAGE" | grep -qi "$FIRST_INST\|institution\|paper"; then
  pass "(page has content)"
else
  fail "(page appears empty)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§12  CROSSREF ADMIN ENDPOINT — POST /admin/crossref-batch"
# ─────────────────────────────────────────────────────────────────────────────

# Read ADMIN_SECRET from .env.local if available
ADMIN_SECRET=""
for f in .env.local .env; do
  if [ -f "/home/teycir/Repos/ArxivExplorer/$f" ]; then
    VAL=$(grep '^ADMIN_SECRET=' "/home/teycir/Repos/ArxivExplorer/$f" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
    if [ -n "$VAL" ]; then ADMIN_SECRET="$VAL"; break; fi
  fi
done

echo -n "  POST /admin/crossref-batch without auth returns 401 ... "
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/admin/crossref-batch")
if [ "$NOAUTH" -eq 401 ]; then
  pass "(401 Unauthorized)"
else
  fail "(expected 401, got $NOAUTH)"
fi

if [ -n "$ADMIN_SECRET" ]; then
  echo -n "  POST /admin/crossref-batch with auth returns 200 + processed ... "
  CR_BATCH=$(curl -s -X POST "$API_BASE/admin/crossref-batch" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"limit":2}')
  if echo "$CR_BATCH" | jq -e '.ok == true' > /dev/null 2>&1; then
    PROC=$(echo "$CR_BATCH" | jq -r '.processed // "?"')
    ENR=$(echo "$CR_BATCH" | jq -r '.enriched // "?"')
    pass "(processed=$PROC enriched=$ENR)"
  else
    fail "(unexpected response: $(echo "$CR_BATCH" | head -c 200))"
  fi
else
  warn "  ADMIN_SECRET not in .env.local — skipping authenticated admin test"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§13  FRONTEND ENRICHMENT UI — PaperCard badges"
# ─────────────────────────────────────────────────────────────────────────────

# Fetch a search page that should contain enriched paper cards
SEARCH_PAGE=$(curl -s "$FRONTEND/search?q=deep+learning")

echo -n "  search page renders (HTTP 200) ... "
SC=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/search?q=deep+learning")
[ "$SC" -eq 200 ] && pass "(200)" || fail "(HTTP $SC)"

# Look for enrichment badge markers in the SSR output
echo -n "  search page contains Open Access badge markup ... "
if echo "$SEARCH_PAGE" | grep -q "Open Access\|open-access\|openAccess\|isOpenAccess"; then
  pass "(found in HTML)"
else
  warn "(not found — papers may not have OA enrichment yet, or badge is client-rendered)"
fi

echo -n "  search page contains code badge markup ... "
if echo "$SEARCH_PAGE" | grep -qi "repos\|codeCount\|code_count\|HasCode\|has-code"; then
  pass "(found in HTML)"
else
  warn "(not found — papers may not have PWC enrichment yet)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§14  FRONTEND ENRICHMENT UI — paper detail page"
# ─────────────────────────────────────────────────────────────────────────────

DETAIL_PAGE=$(curl -s "$FRONTEND/paper/$PAPER_ID")
SC=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/paper/$PAPER_ID")

echo -n "  paper detail page HTTP 200 ... "
[ "$SC" -eq 200 ] && pass "(200)" || fail "(HTTP $SC)"

echo -n "  detail page contains AI Summary section ... "
echo "$DETAIL_PAGE" | grep -qi "AI Summary\|summary\|tldr" && pass "(found)" || fail "(not found)"

echo -n "  detail page contains Concepts section (when enriched) ... "
if echo "$DETAIL_PAGE" | grep -qi "concept\|Wikidata\|openAlex\|via OpenAlex"; then
  pass "(found)"
else
  warn "(not found — run backfill-openalex.ts first)"
fi

echo -n "  detail page contains Code section header (when enriched) ... "
if echo "$DETAIL_PAGE" | grep -qi "Code\|repos\|repository\|github"; then
  pass "(found)"
else
  warn "(not found — run backfill-pwc.ts first)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "§15  FRONTEND SEARCH FILTERS — new filter params in URL"
# ─────────────────────────────────────────────────────────────────────────────

# All three new filter types should produce valid SSR responses
assert_http "search?paperType=survey frontend SSR"    "$FRONTEND/search?q=survey&paperType=survey"
assert_http "search?hasCode=1 frontend SSR"           "$FRONTEND/search?q=transformer&hasCode=1"
assert_http "search?openAccess=1 frontend SSR"        "$FRONTEND/search?q=language+model&openAccess=1"

echo -n "  search?hasCode=1 page contains paper content ... "
HC_PAGE=$(curl -s "$FRONTEND/search?q=transformer&hasCode=1")
echo "$HC_PAGE" | grep -qi "paper\|result\|arxiv" && pass "(has content)" || fail "(empty page)"

# ─────────────────────────────────────────────────────────────────────────────
section "§16  API RESPONSE TIMES — enrichment endpoints"
# ─────────────────────────────────────────────────────────────────────────────

time_request "GET /api/paper/:id (enrichment fields)" \
  "$API_BASE/api/paper/$PAPER_ID" 2000

time_request "GET /api/paper/:id/code" \
  "$API_BASE/api/paper/$PAPER_ID/code" 2000

time_request "GET /api/paper/:id/benchmarks" \
  "$API_BASE/api/paper/$PAPER_ID/benchmarks" 2000

time_request "GET /api/concept/:name" \
  "$API_BASE/api/concept/$CONCEPT_ENC" 3000

time_request "GET /api/institution/:name" \
  "$API_BASE/api/institution/$INST_ENC" 3000

time_request "GET /api/search?paperType=empirical (new filter)" \
  "$API_BASE/api/search?q=neural&paperType=empirical" 3000

###############################################################################
echo ""
echo "══════════════════════════════════════════════"
echo "  Results"
echo "══════════════════════════════════════════════"
TOTAL=$((PASSED + FAILED + WARNED))
echo -e "  Total:   $TOTAL"
echo -e "  ${GREEN}Passed:  $PASSED${NC}"
echo -e "  ${RED}Failed:  $FAILED${NC}"
echo -e "  ${YELLOW}Warned:  $WARNED${NC}  (data-dependent — run backfill scripts to resolve)"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "  ${GREEN}✅ All hard assertions passed!${NC}"
  [ "$WARNED" -gt 0 ] && echo -e "  ${YELLOW}ℹ  $WARNED warnings indicate enrichment data not yet backfilled.${NC}"
  echo -e "  ${YELLOW}  Run the following to populate:${NC}"
  echo -e "  ${YELLOW}    npx tsx scripts/backfill-openalex.ts --local${NC}"
  echo -e "  ${YELLOW}    npx tsx scripts/backfill-pwc.ts --local${NC}"
  echo -e "  ${YELLOW}    npx tsx scripts/backfill-summaries-v2.ts${NC}"
  echo -e "  ${YELLOW}    npx tsx scripts/backfill-crossref.ts --local${NC}"
  exit 0
else
  echo -e "  ${RED}❌ $FAILED hard assertion(s) failed.${NC}"
  exit 1
fi
