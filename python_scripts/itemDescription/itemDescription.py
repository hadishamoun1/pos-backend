#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Load rows from CSV 'itemDescription-HadiShamoun(.csv)' into MySQL table `item_name_description`.

Expected columns (spacing/case tolerant):
  categoryName, subCategory, colorName, designName, itemNumber

Idempotent:
- Uses UPSERT (ON DUPLICATE KEY UPDATE) if a UNIQUE index exists on either
  (itemNumber, categoryName, subCategory, colorName, designName)  OR
  (categoryName, subCategory, colorName, designName).
- Otherwise does plain INSERTs (duplicates possible).

Usage:
  # default file in same folder: itemDescription-HadiShamoun(.csv)
  python migrate_item_name_description_from_csv.py

  # or provide a custom path
  python migrate_item_name_description_from_csv.py path/to/file.csv

Env vars: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
"""

import os
import sys
import csv
import re
from pathlib import Path
import mysql.connector

TABLE = "item_name_description"

# ---- DB config via env ----
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "70631859HADI")
DB_NAME = os.getenv("DB_NAME", "new_schema2")

# ---- Default CSV filename (try with & without .csv) ----
DEFAULT_BASENAME = "itemDescription-HadiShamoun"

CANON_KEYS = {
    "categoryname": "categoryName",
    "subcategory": "subCategory",
    "colorname": "colorName",
    "designname": "designName",
    "itemnumber": "itemNumber",
}
SPACE_RE = re.compile(r"\s+")

def norm_header(h: str) -> str:
    if h is None:
        return ""
    key = SPACE_RE.sub("", h).strip().lower()
    return CANON_KEYS.get(key, key)

def norm_val(v):
    if v is None:
        return ""
    s = str(v).replace("\t", " ").strip()
    s = SPACE_RE.sub(" ", s)
    return s.replace("\ufeff", "")

def detect_unique_index(cursor):
    q = """
    SELECT index_name, column_name, seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = %s AND table_name = %s AND non_unique = 0
    ORDER BY index_name, seq_in_index
    """
    cursor.execute(q, (DB_NAME, TABLE))
    rows = cursor.fetchall()
    by_idx = {}
    for name, col, seq in rows:
        by_idx.setdefault(name, []).append((seq, col))
    unique_sets = []
    for _, cols in by_idx.items():
        cols_sorted = [c for _, c in sorted(cols, key=lambda x: x[0])]
        unique_sets.append(tuple(cols_sorted))

    wanted1 = ('itemNumber','categoryName','subCategory','colorName','designName')
    wanted2 = ('categoryName','subCategory','colorName','designName')
    if wanted1 in unique_sets: return wanted1
    if wanted2 in unique_sets: return wanted2
    return None

def find_default_csv() -> Path | None:
    here = Path(__file__).resolve().parent
    candidates = [
        here / DEFAULT_BASENAME,
        here / f"{DEFAULT_BASENAME}.csv",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None

def main():
    # Resolve CSV path
    if len(sys.argv) >= 2:
        csv_path = Path(sys.argv[1]).expanduser().resolve()
    else:
        csv_path = find_default_csv()
        if not csv_path:
            print(f"❌ CSV not found. Looked for '{DEFAULT_BASENAME}' and '{DEFAULT_BASENAME}.csv' next to this script, "
                  f"or pass a path: python {Path(__file__).name} <file.csv>", file=sys.stderr)
            sys.exit(66)

    if not csv_path.exists():
        print(f"❌ CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(66)

    # Connect DB
    try:
        conn = mysql.connector.connect(
            host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
        )
        cur = conn.cursor()
    except mysql.connector.Error as e:
        print(f"❌ MySQL connection failed: {e}", file=sys.stderr)
        sys.exit(1)

    unique_cols = detect_unique_index(cur)
    if unique_cols:
        print(f"✔️ Using UPSERT with unique index on {unique_cols}")
    else:
        print("⚠️ No suitable UNIQUE index found; inserts may create duplicates.")

    insert_cols = ['categoryName','subCategory','colorName','designName','itemNumber']
    placeholders = ", ".join(["%s"] * len(insert_cols))
    col_sql = ", ".join(f"`{c}`" for c in insert_cols)

    if unique_cols:
        on_dup = "ON DUPLICATE KEY UPDATE " + ", ".join(
            f"`{c}`=VALUES(`{c}`)" for c in ['itemNumber']  # extend if you want to update other fields too
        )
        sql = f"INSERT INTO `{TABLE}` ({col_sql}) VALUES ({placeholders}) {on_dup}"
        mode = "upsert"
    else:
        sql = f"INSERT INTO `{TABLE}` ({col_sql}) VALUES ({placeholders})"
        mode = "insert"

    total_rows = 0
    affected = 0

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, skipinitialspace=True)
            if not reader.fieldnames:
                print("❌ CSV has no header row.", file=sys.stderr)
                sys.exit(65)

            header_map = {h: norm_header(h) for h in reader.fieldnames}

            def src_key(canon):
                for raw, c in header_map.items():
                    if c == canon:
                        return raw
                return None

            src_cat = src_key("categoryName")
            src_sub = src_key("subCategory")
            src_col = src_key("colorName")
            src_des = src_key("designName")
            src_num = src_key("itemNumber")

            missing = [n for n, k in [
                ("categoryName", src_cat),
                ("subCategory", src_sub),
                ("colorName",   src_col),
                ("designName",  src_des),
                # itemNumber can be absent; we handle as NULL
            ] if k is None]
            if missing:
                print(f"❌ Required columns missing in header: {missing}", file=sys.stderr)
                sys.exit(65)

            batch = []
            for row in reader:
                total_rows += 1
                categoryName = norm_val(row.get(src_cat, ""))
                subCategory  = norm_val(row.get(src_sub, ""))
                colorName    = norm_val(row.get(src_col, ""))
                designName   = norm_val(row.get(src_des, ""))
                itemNumber   = norm_val(row.get(src_num, "")) if src_num else ""

                if not (categoryName or subCategory or colorName or designName or itemNumber):
                    continue

                batch.append((categoryName, subCategory, colorName, designName, itemNumber or None))

                if len(batch) >= 1000:
                    cur.executemany(sql, batch)
                    affected += cur.rowcount
                    batch = []

            if batch:
                cur.executemany(sql, batch)
                affected += cur.rowcount

        conn.commit()
        print(f"✅ Done. File: {csv_path.name}. Processed: {total_rows}. Affected rows: {affected}. Mode: {mode}.")

    except mysql.connector.Error as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        try: cur.close()
        except Exception: pass
        conn.close()

if __name__ == "__main__":
    main()
