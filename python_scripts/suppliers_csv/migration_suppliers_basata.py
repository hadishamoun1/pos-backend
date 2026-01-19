#!/usr/bin/env python3
# migration_suppliers_basata.py
#
# Imports suppliers CSV into MySQL `suppliers`.
# - Reads CSV (with header OR no-header)
# - Deduplicates by supplierAccountNumber (keeps last)
# - Upserts by unique supplierAccountNumber
# - Forces accountId to a single fixed value for ALL suppliers (e.g. 66)
# - Optionally forces currencyId (if column exists)
#
# Usage:
#   python migration_suppliers_basata.py omar-bsata-suppliers.csv --db omar_bsata --currency-id 1 --account-id 66
#   python migration_suppliers_basata.py omar-bsata-suppliers.csv --db omar_bsata --account-id 66
#   python migration_suppliers_basata.py omar-bsata-suppliers.csv --dry-run

import argparse
import csv
from typing import Dict, List, Optional, Tuple

import mysql.connector


HEADER_SYNONYMS = {
    "supplieraccountnumber": [
        "supplier account number",
        "supplier_account_number",
        "supplierAccountNumber",
        "account number",
        "account_number",
        "code",
        "رقم حساب المورد",
        "رقم المورد",
    ],
    "suppliername": [
        "supplier name",
        "supplier_name",
        "supplierName",
        "name",
        "اسم المورد",
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
    return ("supplier" in joined) or ("مورد" in joined) or ("اسم" in joined) or ("رقم" in joined)


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


def read_suppliers_csv(path: str, encoding: str) -> Tuple[List[Dict], List[str]]:
    warnings: List[str] = []

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

            num_col = pick_header(reader.fieldnames, "supplieraccountnumber")
            name_col = pick_header(reader.fieldnames, "suppliername")
            if not num_col or not name_col:
                raise SystemExit(
                    f"Could not detect required headers.\n"
                    f"Found headers: {reader.fieldnames}\n"
                    f"Need at least: supplier account number + supplier name"
                )

            seen: Dict[str, int] = {}
            for i, r in enumerate(reader, start=2):
                num = clean_str(r.get(num_col))
                name = clean_str(r.get(name_col))

                if not num:
                    warnings.append(f"Line {i}: missing supplier account number -> skipped")
                    continue

                if num in seen:
                    warnings.append(
                        f"Line {i}: duplicate supplierAccountNumber '{num}' (previous at line {seen[num]}) -> keeping latest"
                    )
                seen[num] = i

                rows.append({"supplierAccountNumber": num, "supplierName": name})
    else:
        # no-header: assume first 2 columns are number, name
        seen: Dict[str, int] = {}
        for i, r in enumerate(raw_rows, start=1):
            r = (r + ["", ""])[:2]
            num = clean_str(r[0])
            name = clean_str(r[1])

            if not num:
                warnings.append(f"Line {i}: missing supplier account number -> skipped")
                continue

            if num in seen:
                warnings.append(
                    f"Line {i}: duplicate supplierAccountNumber '{num}' (previous at line {seen[num]}) -> keeping latest"
                )
            seen[num] = i

            rows.append({"supplierAccountNumber": num, "supplierName": name})

    # Deduplicate: keep last occurrence
    dedup: Dict[str, Dict] = {}
    for x in rows:
        dedup[x["supplierAccountNumber"]] = x
    rows = list(dedup.values())

    return rows, warnings


def main():
    ap = argparse.ArgumentParser(description="Migrate suppliers CSV into MySQL suppliers table (upsert by supplierAccountNumber).")
    ap.add_argument("csv_path", help="Path to suppliers CSV")
    ap.add_argument("--encoding", default="utf-8-sig")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--chunk", type=int, default=500)

    ap.add_argument("--db", default="omar_bsata")
    ap.add_argument("--table", default="suppliers")

    ap.add_argument("--currency-id", type=int, default=None, help="currencyId to set for all suppliers (if column exists)")
    ap.add_argument("--account-id", type=int, required=True, help="FORCE accountId for ALL suppliers (e.g. 66)")

    args = ap.parse_args()

    suppliers, warnings = read_suppliers_csv(args.csv_path, args.encoding)

    print(f"Loaded {len(suppliers)} unique suppliers from CSV.")
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
        for x in suppliers[:10]:
            print(x)
        print(f"\nWould force accountId={args.account_id}, currencyId={args.currency_id}")
        return

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

        # Safety: ensure target columns exist
        if "supplierAccountNumber" not in cols_set or "supplierName" not in cols_set:
            raise SystemExit(f"Table `{args.table}` must have supplierAccountNumber and supplierName columns.")
        if "accountId" not in cols_set:
            raise SystemExit(f"Table `{args.table}` must have accountId column (your entity has it).")

        # Insert/upsert columns
        insert_cols = ["supplierAccountNumber", "supplierName", "accountId"]
        if "currencyId" in cols_set and args.currency_id is not None:
            insert_cols.append("currencyId")

        # Optional columns (only if they exist in DB)
        optional_cols = [
            "firstName", "middleName",
            "area", "companyType", "paymentTerms",
            "address", "phoneNumber", "financialNumber",
            "vat",
        ]
        for c in optional_cols:
            if c in cols_set:
                insert_cols.append(c)

        sql = (
            f"INSERT INTO `{args.table}` ({', '.join([f'`{c}`' for c in insert_cols])}) "
            f"VALUES ({', '.join(['%s'] * len(insert_cols))}) "
            f"ON DUPLICATE KEY UPDATE "
            + ", ".join([f"`{c}`=VALUES(`{c}`)" for c in insert_cols if c != "supplierAccountNumber"])
        )

        def row_values(s: Dict) -> tuple:
            base = {
                "supplierAccountNumber": s["supplierAccountNumber"],
                "supplierName": s.get("supplierName") or "",
                "accountId": args.account_id,
            }
            if "currencyId" in insert_cols:
                base["currencyId"] = args.currency_id

            # Fill optional columns with NULL
            for c in insert_cols:
                if c not in base:
                    base[c] = None

            return tuple(base.get(c) for c in insert_cols)

        total = 0
        for i in range(0, len(suppliers), args.chunk):
            chunk = suppliers[i : i + args.chunk]
            cur.executemany(sql, [row_values(r) for r in chunk])
            total += len(chunk)
            print(f"Upserted {total}/{len(suppliers)}...")

        db.commit()
        print(f"\n✅ Done. Upserted {len(suppliers)} rows into `{args.db}`.`{args.table}` with accountId={args.account_id}")

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
