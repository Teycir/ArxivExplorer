#!/usr/bin/env bash
# Export the remote D1 (arxiv-explorer) and import it into local dev state.
# Dumps go to db-dumps/ which is git-ignored.
#
# NOTE: `d1 export` reads every row. On the free tier this counts against the
# daily row-read quota (resets at 00:00 UTC) and will fail if already exhausted.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="arxiv-explorer"
CONFIG="wrangler.api.toml"
EXPECTED_ACCOUNT="654138bf69495500265ef8536b778244"   # teycircoder12
OUT_DIR="db-dumps"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/arxiv-explorer-$STAMP.sql"

mkdir -p "$OUT_DIR"

echo "==> Checking Cloudflare account"
WHOAMI="$(npx wrangler whoami 2>&1 || true)"
if ! grep -q "$EXPECTED_ACCOUNT" <<<"$WHOAMI"; then
  echo "ERROR: wrangler is not logged in to account $EXPECTED_ACCOUNT (teycircoder12)." >&2
  echo "       Run: npx wrangler logout && npx wrangler login" >&2
  exit 1
fi

echo "==> Checking D1 quota with a tiny query"
if ! PROBE="$(npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG" \
      --command "SELECT COUNT(*) AS n FROM papers" --json 2>&1)"; then
  if grep -qE "7500|row read limit" <<<"$PROBE"; then
    echo "ERROR: D1 free-tier daily row-read limit still exhausted. Retry after 00:00 UTC." >&2
  else
    echo "ERROR: probe query failed:" >&2
    echo "$PROBE" | tail -20 >&2
  fi
  exit 2
fi
REMOTE_COUNT="$(grep -oE '"n": *[0-9]+' <<<"$PROBE" | head -1 | grep -oE '[0-9]+')"
echo "    remote papers: ${REMOTE_COUNT:-unknown}"

echo "==> Exporting remote DB to $DUMP"
npx wrangler d1 export "$DB_NAME" --remote --config "$CONFIG" --output "$DUMP"
echo "    size: $(du -h "$DUMP" | cut -f1)"

echo "==> Importing into local D1 state (.wrangler/, git-ignored)"
npx wrangler d1 execute "$DB_NAME" --local --config "$CONFIG" --file "$DUMP"

echo "==> Verifying local row count"
LOCAL="$(npx wrangler d1 execute "$DB_NAME" --local --config "$CONFIG" \
          --command "SELECT COUNT(*) AS n FROM papers" --json 2>&1)"
LOCAL_COUNT="$(grep -oE '"n": *[0-9]+' <<<"$LOCAL" | head -1 | grep -oE '[0-9]+')"
echo "    local papers:  ${LOCAL_COUNT:-unknown}"

if [[ -n "${REMOTE_COUNT:-}" && "${LOCAL_COUNT:-}" != "$REMOTE_COUNT" ]]; then
  echo "WARNING: local ($LOCAL_COUNT) != remote ($REMOTE_COUNT). Inspect the dump." >&2
  exit 3
fi
echo "==> Done. Dump kept at $DUMP (git-ignored)."
