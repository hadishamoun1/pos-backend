#!/usr/bin/env python3
# migration_accounts_basata.py
#
# Imports accounts CSV into MySQL table `accounts`.
# - Handles CSV with header OR without header (auto-detect 3 columns)
# - Cleans whitespace, handles blank parentNumber as NULL
# - Stores CSV "account name" into BOTH accountName and arabicAccountName (Arabic CSV)
# - Upserts by unique accountNumber (INSERT ... ON DUPLICATE KEY UPDATE)
# - Warns about duplicate accountNumbers in the CSV (keeps last)
# - Warns about missing parent accounts (but still imports)

import argparse
import csv
from typing import Dict, List, Optional, Tuple

import mysql.connector


HEADER_SYNONYMS = {
    "accountnumber": ["account number", "account_number", "accountNumber", "accountnumber", "code", "رقم الحساب"],
    "accountname": ["account name", "account_name", "accountName", "accountname", "name", "اسم الحساب"],
    "parentnumber": ["parent number", "parent_number", "parentNumber", "parentnumber", "parent", "رقم الأب", "الحساب الأب"],
}


def norm_key(s: str) -> str:
    return (s or "").strip().lower().replace("\ufeff", "")


def pick_header(fieldnames: List[str], canonical: str) -> Optional[str]:
    fn = [norm_key(x) for x in fieldnames]
    for syn in HEADER_SYNONYMS[canonical]:
        syn_n = norm_key(syn)
        if syn_n in fn:
            return fieldnames[fn.index(syn_n)]
    return None


def clean_str(v: Optional[str]) -> str:
    if v is None:
        return ""
    return str(v).strip()


def clean_parent(v: Optional[str]) -> Optional[str]:
    s = clean_str(v)
    return s if s else None


def fetch_table_columns(cur, db: str, table: str) -> List[str]:
    cur.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
        """,
        (db, table),
    )
    return [r[0] for r in cur.fetchall()]


def _looks_like_header(row: List[str]) -> bool:
    """Heuristic: if first row contains words like 'account'/'parent' or Arabic header words."""
    joined = " ".join([norm_key(x) for x in row if x is not None])
    keys = ["account", "parent", "رقم", "الحساب", "اسم"]
    return any(k in joined for k in keys)


def read_accounts_csv(path: str, encoding: str) -> Tuple[List[Dict], List[str]]:
    rows: List[Dict] = []
    warnings: List[str] = []

    # Read raw rows first to support "no header" CSVs
    with open(path, "r", encoding=encoding, newline="") as f:
        raw_reader = csv.reader(f)
        raw_rows = [r for r in raw_reader if r and any((x or "").strip() for x in r)]

    if not raw_rows:
        raise SystemExit("CSV is empty.")

    # Decide: header vs no-header
    has_header = _looks_like_header(raw_rows[0])

    if has_header:
        # Use DictReader
        with open(path, "r", encoding=encoding, newline="") as f2:
            reader = csv.DictReader(f2)
            if not reader.fieldnames:
                raise SystemExit("CSV has no header row.")

            acc_col = pick_header(reader.fieldnames, "accountnumber")
            name_col = pick_header(reader.fieldnames, "accountname")
            parent_col = pick_header(reader.fieldnames, "parentnumber")

            if not acc_col or not name_col:
                raise SystemExit(
                    f"Could not detect required headers.\n"
                    f"Found headers: {reader.fieldnames}\n"
                    f"Need at least: account number + account name"
                )

            seen: Dict[str, int] = {}
            for i, r in enumerate(reader, start=2):  # header is line 1
                account_number = clean_str(r.get(acc_col))
                account_name = clean_str(r.get(name_col))
                parent_number = clean_parent(r.get(parent_col)) if parent_col else None

                if not account_number:
                    warnings.append(f"Line {i}: missing account number -> skipped")
                    continue

                if account_number in seen:
                    warnings.append(
                        f"Line {i}: duplicate accountNumber '{account_number}' (previous at line {seen[account_number]}) -> keeping latest"
                    )
                seen[account_number] = i

                rows.append(
                    {
                        "accountNumber": account_number,
                        "accountName": account_name or "",
                        "arabicAccountName": account_name or "",
                        "parentNumber": parent_number,
                        "currencyId": None,  # not in CSV; keep NULL
                        "accessible": 1,     # default true
                    }
                )
    else:
        # No-header CSV: assume columns are:
        # account number, account name, parent number
        # (If parent missing, allow empty)
        seen: Dict[str, int] = {}
        for idx, r in enumerate(raw_rows, start=1):
            # pad to 3 columns
            r = (r + ["", "", ""])[:3]
            account_number = clean_str(r[0])
            account_name = clean_str(r[1])
            parent_number = clean_parent(r[2])

            if not account_number:
                warnings.append(f"Line {idx}: missing account number -> skipped")
                continue

            if account_number in seen:
                warnings.append(
                    f"Line {idx}: duplicate accountNumber '{account_number}' (previous at line {seen[account_number]}) -> keeping latest"
                )
            seen[account_number] = idx

            rows.append(
                {
                    "accountNumber": account_number,
                    "accountName": account_name or "",
                    "arabicAccountName": account_name or "",
                    "parentNumber": parent_number,
                    "currencyId": None,  # not in CSV; keep NULL
                    "accessible": 1,     # default true
                }
            )

    # Parent validation warnings (doesn't block import)
    all_numbers = {x["accountNumber"] for x in rows}
    missing_parents = sorted(
        {x["parentNumber"] for x in rows if x["parentNumber"] and x["parentNumber"] not in all_numbers}
    )
    for p in missing_parents:
        warnings.append(f"Warning: parentNumber '{p}' not found in CSV list (still importing)")

    # Deduplicate: keep last occurrence
    dedup_map: Dict[str, Dict] = {}
    for x in rows:
        dedup_map[x["accountNumber"]] = x
    rows = list(dedup_map.values())

    return rows, warnings


def main():
    ap = argparse.ArgumentParser(description="Migrate accounts CSV into MySQL accounts table (upsert by accountNumber).")
    ap.add_argument("csv_path", help="Path to accounts CSV")
    ap.add_argument("--table", default="accounts")
    ap.add_argument("--encoding", default="utf-8-sig", help="CSV encoding (utf-8-sig handles BOM)")
    ap.add_argument("--dry-run", action="store_true", help="Print what would happen without writing to DB")
    ap.add_argument("--chunk", type=int, default=500, help="Batch size for executemany()")
    ap.add_argument("--debug-sql", action="store_true", help="Print generated SQL")
    args = ap.parse_args()

    accounts, warnings = read_accounts_csv(args.csv_path, args.encoding)

    print(f"Loaded {len(accounts)} unique accounts from CSV.")
    if warnings:
        print("\n--- WARNINGS ---")
        for w in warnings[:200]:
            print(w)
        if len(warnings) > 200:
            print(f"... ({len(warnings) - 200} more)")
        print("---------------\n")

    if args.dry_run:
        print("DRY RUN: no DB changes.")
        print("First 10 rows preview:")
        for x in accounts[:10]:
            print(x)
        return

    # ✅ Your requested hardcoded DB connection
    DB_NAME = "omar_bsata"
    db = mysql.connector.connect(
        host="localhost",
        user="root",
        password="70631859HADI",
        database=DB_NAME,
        autocommit=False,
    )
    cur = db.cursor()

    try:
        cols = fetch_table_columns(cur, DB_NAME, args.table)
        cols_set = set(cols)

        # Insert/upsert columns (currencyId only if column exists)
        insert_cols = ["accountNumber", "accountName", "parentNumber", "arabicAccountName", "accessible"]
        if "currencyId" in cols_set:
            insert_cols.insert(4, "currencyId")

        # ✅ Use backticks to avoid any SQL parsing issues
        col_list = ", ".join([f"`{c}`" for c in insert_cols])
        placeholders = ", ".join(["%s"] * len(insert_cols))

        update_cols = [c for c in insert_cols if c != "accountNumber"]
        update_expr = ", ".join([f"`{c}`=VALUES(`{c}`)" for c in update_cols])

        sql = (
            f"INSERT INTO `{args.table}` ({col_list}) "
            f"VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE {update_expr}"
        )

        if args.debug_sql:
            print("DEBUG SQL:", sql)

        def row_values(r: Dict) -> tuple:
            return tuple(r.get(c) for c in insert_cols)

        total = 0
        for i in range(0, len(accounts), args.chunk):
            chunk = accounts[i: i + args.chunk]
            cur.executemany(sql, [row_values(r) for r in chunk])
            total += len(chunk)
            print(f"Upserted {total}/{len(accounts)}...")

        db.commit()
        print(f"\n✅ Done. Upserted {len(accounts)} rows into `{DB_NAME}`.`{args.table}`")

    except Exception:
        db.rollback()
        print("\n❌ Failed. Rolled back transaction.")
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass
        db.close()


if __name__ == "__main__":
    main()
