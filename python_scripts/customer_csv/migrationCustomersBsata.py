#!/usr/bin/env python3
# migration_customers_basata.py
#
# Imports customers CSV into MySQL table `customers` (TypeORM entity shown).
# - Supports CSV WITH header OR WITHOUT header (2 columns)
# - Cleans whitespace, Arabic-safe (utf-8-sig)
# - Upserts by unique customerAccountNumber
# - Fills required currencyId (default you choose)
# - Optionally links to accounts table:
#     - If customers.accountId exists: tries to set it by matching accounts.accountNumber = customerAccountNumber
#     - If not found, leaves accountId NULL (or you can force create accounts separately)
#
# Usage:
#   pip install mysql-connector-python
#   python migration_customers_basata.py omar-bsata-customers.csv
#
# Options:
#   python migration_customers_basata.py omar-bsata-customers.csv --db omar_bsata --currency-id 1
#   python migration_customers_basata.py omar-bsata-customers.csv --dry-run
#   python migration_customers_basata.py omar-bsata-customers.csv --debug-sql

import argparse
import csv
from typing import Dict, List, Optional, Tuple

import mysql.connector


HEADER_SYNONYMS = {
    "customeraccountnumber": [
        "customer account number",
        "customer_account_number",
        "customerAccountNumber",
        "customeraccountnumber",
        "account number",
        "account_number",
        "code",
        "رقم حساب الزبون",
        "رقم الزبون",
    ],
    "customername": [
        "customer name",
        "customer_name",
        "customerName",
        "customername",
        "name",
        "اسم الزبون",
        "اسم العميل",
    ],
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


def _looks_like_header(row: List[str]) -> bool:
    joined = " ".join([norm_key(x) for x in row if x is not None])
    return ("customer" in joined) or ("زبون" in joined) or ("اسم" in joined) or ("رقم" in joined)


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


def fetch_accounts_map_by_number(cur, db: str) -> Dict[str, int]:
    """
    Returns { accountNumber(str) : accountId(int) } from accounts table.
    If accounts table doesn't exist or has different structure, returns empty.
    """
    try:
        cur.execute(f"SELECT id, accountNumber FROM `{db}`.`accounts`")
        out = {}
        for acc_id, acc_num in cur.fetchall():
            if acc_num is None:
                continue
            out[str(acc_num).strip()] = int(acc_id)
        return out
    except Exception:
        return {}


def read_customers_csv(path: str, encoding: str) -> Tuple[List[Dict], List[str]]:
    warnings: List[str] = []

    # Read raw rows first to support no-header CSVs
    with open(path, "r", encoding=encoding, newline="") as f:
        raw_reader = csv.reader(f)
        raw_rows = [r for r in raw_reader if r and any((x or "").strip() for x in r)]

    if not raw_rows:
        raise SystemExit("CSV is empty.")

    has_header = _looks_like_header(raw_rows[0])

    rows: List[Dict] = []

    if has_header:
        with open(path, "r", encoding=encoding, newline="") as f2:
            reader = csv.DictReader(f2)
            if not reader.fieldnames:
                raise SystemExit("CSV has no header row.")

            num_col = pick_header(reader.fieldnames, "customeraccountnumber")
            name_col = pick_header(reader.fieldnames, "customername")

            if not num_col or not name_col:
                raise SystemExit(
                    f"Could not detect required headers.\n"
                    f"Found headers: {reader.fieldnames}\n"
                    f"Need at least: customer account number + customer name"
                )

            seen: Dict[str, int] = {}
            for i, r in enumerate(reader, start=2):
                num = clean_str(r.get(num_col))
                name = clean_str(r.get(name_col))

                if not num:
                    warnings.append(f"Line {i}: missing customer account number -> skipped")
                    continue

                if num in seen:
                    warnings.append(
                        f"Line {i}: duplicate customerAccountNumber '{num}' (previous at line {seen[num]}) -> keeping latest"
                    )
                seen[num] = i

                rows.append({"customerAccountNumber": num, "customerName": name})
    else:
        # no-header: assume first 2 columns are number, name
        seen: Dict[str, int] = {}
        for i, r in enumerate(raw_rows, start=1):
            r = (r + ["", ""])[:2]
            num = clean_str(r[0])
            name = clean_str(r[1])

            if not num:
                warnings.append(f"Line {i}: missing customer account number -> skipped")
                continue

            if num in seen:
                warnings.append(
                    f"Line {i}: duplicate customerAccountNumber '{num}' (previous at line {seen[num]}) -> keeping latest"
                )
            seen[num] = i

            rows.append({"customerAccountNumber": num, "customerName": name})

    # Deduplicate: keep last occurrence
    dedup: Dict[str, Dict] = {}
    for x in rows:
        dedup[x["customerAccountNumber"]] = x
    rows = list(dedup.values())

    return rows, warnings


def main():
    ap = argparse.ArgumentParser(description="Migrate customers CSV into MySQL customers table (upsert by customerAccountNumber).")
    ap.add_argument("csv_path", help="Path to customers CSV")
    ap.add_argument("--table", default="customers")
    ap.add_argument("--encoding", default="utf-8-sig", help="CSV encoding (utf-8-sig handles BOM)")
    ap.add_argument("--dry-run", action="store_true", help="Print what would happen without writing to DB")
    ap.add_argument("--chunk", type=int, default=500, help="Batch size for executemany()")
    ap.add_argument("--debug-sql", action="store_true", help="Print generated SQL")

    # DB + required defaults
    ap.add_argument("--db", default="omar_bsata", help="Database/schema name")
    ap.add_argument("--currency-id", type=int, default=1, help="currencyId to set for all imported customers (required column)")

    # Optional: try to set accountId by matching accounts.accountNumber == customerAccountNumber
    ap.add_argument("--link-account", action="store_true", help="If customers.accountId exists, set it from accounts by matching number")
    args = ap.parse_args()

    customers, warnings = read_customers_csv(args.csv_path, args.encoding)

    print(f"Loaded {len(customers)} unique customers from CSV.")
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
        for x in customers[:10]:
            print(x)
        return

    # ✅ Hardcoded-style connection (but DB name is configurable)
    db = mysql.connector.connect(
        host="localhost",
        user="root",
        password="70631859HADI",
        database=args.db,
        autocommit=False,
    )
    cur = db.cursor()

    try:
        cols = fetch_table_columns(cur, args.db, args.table)
        cols_set = set(cols)

        # Required in your entity: customerAccountNumber, customerName, currencyId
        insert_cols = ["customerAccountNumber", "customerName", "currencyId"]

        # Optional columns if exist in table
        optional_cols = [
            "firstName", "middleName", "lastName",
            "paymentTerms", "area", "companyType",
            "address", "phoneNumber", "financialNumber",
            "invoiceType", "vat",
            "accountId",
        ]
        for c in optional_cols:
            if c in cols_set:
                insert_cols.append(c)

        # Prepare accountId mapping if needed
        acc_map: Dict[str, int] = {}
        if args.link_account and "accountId" in cols_set:
            acc_map = fetch_accounts_map_by_number(cur, args.db)

        # Build SQL safely
        col_list = ", ".join([f"`{c}`" for c in insert_cols])
        placeholders = ", ".join(["%s"] * len(insert_cols))
        update_cols = [c for c in insert_cols if c != "customerAccountNumber"]
        update_expr = ", ".join([f"`{c}`=VALUES(`{c}`)" for c in update_cols])

        sql = (
            f"INSERT INTO `{args.table}` ({col_list}) "
            f"VALUES ({placeholders}) "
            f"ON DUPLICATE KEY UPDATE {update_expr}"
        )

        if args.debug_sql:
            print("DEBUG SQL:", sql)

        def row_values(r: Dict) -> tuple:
            base = {
                "customerAccountNumber": r["customerAccountNumber"],
                "customerName": r.get("customerName") or "",
                "currencyId": args.currency_id,
            }

            # Fill optional columns with NULL by default
            for c in insert_cols:
                if c not in base:
                    base[c] = None

            # accountId linking if requested
            if args.link_account and "accountId" in cols_set:
                base["accountId"] = acc_map.get(r["customerAccountNumber"])

            return tuple(base.get(c) for c in insert_cols)

        total = 0
        for i in range(0, len(customers), args.chunk):
            chunk = customers[i: i + args.chunk]
            cur.executemany(sql, [row_values(r) for r in chunk])
            total += len(chunk)
            print(f"Upserted {total}/{len(customers)}...")

        db.commit()
        print(f"\n✅ Done. Upserted {len(customers)} rows into `{args.db}`.`{args.table}`")

        if args.link_account and "accountId" in cols_set and acc_map:
            linked = sum(1 for c in customers if acc_map.get(c["customerAccountNumber"]) is not None)
            print(f"🔗 Linked accountId for {linked}/{len(customers)} customers (by matching accountNumber).")

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
