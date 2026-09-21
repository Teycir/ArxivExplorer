#!/usr/bin/env python3
"""Pull the remote D1 (arxiv-explorer) into a NEW local sqlite file.

Why not `wrangler d1 export`?  It refuses databases with FTS5 virtual tables
("cannot export databases with Virtual Tables (fts5)"). So we page through the
real data tables via `wrangler d1 execute --remote` and rebuild FTS locally.

Safety:
  * writes to db-dumps/ (git-ignored), never touches the live local DB
  * verifies row counts against the remote before reporting success
  * swap into .wrangler/ is a separate, explicit step (--install)

Free-tier cost: each row is read once (~110k rows total), well under the
5M/day row-read quota.
"""
import argparse, json, os, re, shutil, sqlite3, subprocess, sys, time
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONFIG = "wrangler.api.toml"
DB_NAME = "arxiv-explorer"
LOCAL_DB = os.path.join(REPO, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite")

# order matters: parents before children (foreign keys)
TABLES = ["papers", "summaries", "topics", "related_papers", "embeddings_meta",
          "citation_snapshots", "entity_definitions", "paper_code", "paper_benchmarks"]
PAGE = {"papers": 250, "summaries": 250, "related_papers": 2000}  # default 1000
# Wrangler wraps results; keep pages small enough for the ~10 MB API response cap.


def wrangler(sql, retries=4):
    """Run one remote query, return list of row dicts. Retries transient errors."""
    cmd = ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--config", CONFIG,
           "--command", sql, "--json"]
    last = ""
    for attempt in range(1, retries + 1):
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=180)
        out = p.stdout
        try:
            data = json.loads(out[out.index("["):]) if "[" in out else None
        except ValueError:
            data = None
        if p.returncode == 0 and data and data[0].get("success"):
            return data[0]["results"]
        last = (out + p.stderr)[-600:]
        if "7500" in last and "row read limit" in last:
            sys.exit("FATAL: D1 daily row-read quota exhausted. Retry after 00:00 UTC.")
        time.sleep(3 * attempt)  # 7403 right after quota reset was transient
    sys.exit(f"FATAL: query failed after {retries} tries: {sql[:80]}\n{last}")


def remote_schema():
    rows = wrangler("SELECT name, sql FROM sqlite_master WHERE type='table' "
                    "AND name IN (%s)" % ",".join("'%s'" % t for t in TABLES))
    return {r["name"]: r["sql"] for r in rows}


def fix_ddl(name, ddl):
    # Remote `papers` has a stray column literally named `openc itations_enriched_at`
    # (typo, space inside). Rename it so the DDL is valid SQL; it's unused/all NULL.
    if name == "papers":
        ddl = ddl.replace("openc itations_enriched_at TEXT",
                          "openc_itations_enriched_at TEXT")
    return ddl


def columns(con, table):
    return [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--install", action="store_true",
                    help="after verification, replace the live .wrangler local DB")
    ap.add_argument("--tables", nargs="*", default=TABLES)
    args = ap.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = os.path.join(REPO, "db-dumps", f"arxiv-explorer-{stamp}.sqlite")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    print("==> reading remote schema")
    schema = remote_schema()
    missing = [t for t in TABLES if t not in schema]
    if missing:
        sys.exit(f"FATAL: tables missing on remote: {missing}")

    con = sqlite3.connect(out)
    con.execute("PRAGMA foreign_keys=OFF")
    for t in TABLES:
        con.execute(fix_ddl(t, schema[t]))
    con.commit()

    keys = {"papers": ["id"], "summaries": ["paper_id"], "topics": ["slug"],
            "related_papers": ["paper_id", "related_paper_id"],
            "embeddings_meta": ["paper_id"],
            "citation_snapshots": ["paper_id", "recorded_at"],
            "entity_definitions": ["entity_name"],
            "paper_code": ["paper_id", "repo_url"],
            "paper_benchmarks": ["paper_id", "task", "dataset", "metric"]}

    print("==> pulling data")
    got = {}
    for t in args.tables:
        cols = columns(con, t)
        # remote column `openc itations_enriched_at` must be selected by its real name
        sel = ['"openc itations_enriched_at"' if c == "openc_itations_enriched_at" else f'"{c}"'
               for c in cols]
        # pull with remote names, insert with local names
        got[t] = pull_table_mapped(con, t, cols, sel, keys[t])

    print("==> rebuilding FTS indexes locally")
    rebuild_fts(con)

    print("==> verifying against remote")
    ok = True
    for t in args.tables:
        r = wrangler(f'SELECT COUNT(*) AS n FROM "{t}"')[0]["n"]
        l = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        flag = "OK " if r == l else "MISMATCH"
        ok &= (r == l)
        print(f"    {flag} {t:<20} remote={r:<7} local={l}")
    integ = con.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"    integrity_check: {integ}")
    con.close()
    if not ok or integ != "ok":
        sys.exit(f"FAILED verification. Nothing installed. Inspect: {out}")

    print(f"==> verified dump: {out} ({os.path.getsize(out)/1e6:.1f} MB)")
    if args.install:
        install(out)
    else:
        print("    (not installed; re-run with --install to replace the live local DB)")


def pull_table_mapped(con, table, cols, sel, key):
    size = PAGE.get(table, 1000)
    selist = ", ".join(sel)
    ins = ", ".join(f'"{c}"' for c in cols)
    ph = ",".join("?" * len(cols))
    total, last = 0, None
    order = ", ".join(f'"{k}"' for k in key)
    while True:
        where = ""
        if last is not None:
            lit = ",".join("'%s'" % str(v).replace("'", "''") for v in last)
            where = f"WHERE ({order}) > ({lit})"
        rows = wrangler(f'SELECT {selist} FROM "{table}" {where} ORDER BY {order} LIMIT {size}')
        if not rows:
            break
        remote_names = [s.strip('"') for s in sel]
        con.executemany(f'INSERT OR REPLACE INTO "{table}" ({ins}) VALUES ({ph})',
                        [tuple(r.get(n) for n in remote_names) for r in rows])
        con.commit()
        total += len(rows)
        last = tuple(rows[-1][k] for k in key)
        print(f"    {table:<20} {total:>7} rows", end="\r", flush=True)
        if len(rows) < size:
            break
    print(f"    {table:<20} {total:>7} rows   ")
    return total


def rebuild_fts(con):
    """Recreate papers_fts / problems_fts + triggers EXACTLY as defined on remote.

    Definitions were read from remote sqlite_master (not guessed):
      papers_fts   standalone FTS5 (paper_id UNINDEXED, title, abstract, authors),
                   default tokenizer -- NOT content='papers', NOT porter.
      problems_fts external-content over summaries.
    Triggers are created AFTER the bulk load and the index is filled explicitly,
    so the load isn't slowed by per-row FTS maintenance.
    """
    con.executescript("""
        DROP TRIGGER IF EXISTS papers_fts_insert;
        DROP TRIGGER IF EXISTS papers_fts_update;
        DROP TRIGGER IF EXISTS papers_fts_delete;
        DROP TRIGGER IF EXISTS problems_fts_insert;
        DROP TRIGGER IF EXISTS problems_fts_update;
        DROP TRIGGER IF EXISTS problems_fts_delete;
        DROP TABLE IF EXISTS papers_fts;
        DROP TABLE IF EXISTS problems_fts;

        CREATE VIRTUAL TABLE papers_fts USING fts5(
          paper_id UNINDEXED,
          title,
          abstract,
          authors
        );
        INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
          SELECT rowid, id, title, abstract, authors FROM papers;

        CREATE VIRTUAL TABLE problems_fts USING fts5(
          paper_id UNINDEXED,
          problem_statement,
          content=summaries,
          content_rowid=rowid
        );
        INSERT INTO problems_fts(rowid, paper_id, problem_statement)
          SELECT rowid, paper_id, problem_statement FROM summaries;

        CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
          INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
          VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
        END;
        CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
          UPDATE papers_fts
          SET title=new.title, abstract=new.abstract, authors=new.authors, paper_id=new.id
          WHERE rowid=new.rowid;
        END;
        CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
          DELETE FROM papers_fts WHERE rowid=old.rowid;
        END;
        CREATE TRIGGER problems_fts_insert AFTER INSERT ON summaries BEGIN
          INSERT INTO problems_fts(rowid, paper_id, problem_statement)
          VALUES (new.rowid, new.paper_id, new.problem_statement);
        END;
        CREATE TRIGGER problems_fts_update AFTER UPDATE ON summaries BEGIN
          UPDATE problems_fts SET problem_statement = new.problem_statement WHERE rowid = old.rowid;
        END;
        CREATE TRIGGER problems_fts_delete AFTER DELETE ON summaries BEGIN
          DELETE FROM problems_fts WHERE rowid = old.rowid;
        END;
    """)
    con.commit()


def install(built):
    os.makedirs(os.path.dirname(LOCAL_DB), exist_ok=True)
    if os.path.exists(LOCAL_DB):
        bak = LOCAL_DB + ".pre-import-" + datetime.now().strftime("%Y%m%d%H%M%S")
        shutil.copy2(LOCAL_DB, bak)
        print(f"    backed up previous local DB -> {bak}")
    shutil.copy2(built, LOCAL_DB)
    print(f"==> installed -> {LOCAL_DB}")


if __name__ == "__main__":
    main()
