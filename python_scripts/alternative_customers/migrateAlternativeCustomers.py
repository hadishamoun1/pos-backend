#!/usr/bin/env python3
# migrateAlternativeCustomers.py
#
# Imports an Excel sheet (Company, BusinessPhone, Address, AreaDescription)
# into the MySQL table `alternative_customers` (TypeORM entity: AlternativeCustomer).
#
# - Reads .xlsx / .xls (via pandas) or .csv
# - Arabic-safe
# - Skips rows already present in the table (matched on company + businessPhone),
#   so the script is safe to re-run on the same file
#
# Usage:
#   pip install pandas openpyxl mysql-connector-python
#   python migrateAlternativeCustomers.py customers.xlsx
#
# Options:
#   python migrateAlternativeCustomers.py customers.xlsx --dry-run
#   python migrateAlternativeCustomers.py customers.xlsx --db new --debug-sql

import argparse
import csv
import os
from typing import Dict, List, Optional, Tuple

import mysql.connector

try:
    import pandas as pd  # type: ignore
except Exception:
    pd = None


HEADER_SYNONYMS = {
    "company": ["company", "Company", "customer name", "name", "الشركة", "اسم الزبون"],
    "businessphone": ["businessphone", "business phone", "BusinessPhone", "phone", "رقم الهاتف"],
    "address": ["address", "Address", "العنوان"],
    "areadescription": ["areadescription", "area description", "AreaDescription", "area", "المنطقة"],
}


def norm_key(s: str) -> str:
    return (s or "").strip().lower().replace("﻿", "").replace(" ", "")


def pick_header(fieldnames: List[str], canonical: str) -> Optional[str]:
    fn = [norm_key(x) for x in fieldnames]
    for syn in HEADER_SYNONYMS[canonical]:
        syn_n = norm_key(syn)
        if syn_n in fn:
            return fieldnames[fn.index(syn_n)]
    return None


def clean_str(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() == "nan":
        return ""
    return s


def read_rows(path: str) -> Tuple[List[Dict], List[str]]:
    warnings: List[str] = []
    ext = os.path.splitext(path.lower())[1]

    if ext in (".xlsx", ".xls"):
        if pd is None:
            raise SystemExit("Reading .xlsx requires pandas + openpyxl: pip install pandas openpyxl")
        df = pd.read_excel(path, dtype=str)
        fieldnames = list(df.columns)
        raw_rows = df.to_dict(orient="records")
    else:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []
            raw_rows = list(reader)

    company_col = pick_header(fieldnames, "company")
    phone_col = pick_header(fieldnames, "businessphone")
    address_col = pick_header(fieldnames, "address")
    area_col = pick_header(fieldnames, "areadescription")

    if not company_col:
        raise SystemExit(f"Could not find a 'Company' column. Found headers: {fieldnames}")

    rows: List[Dict] = []
    for i, r in enumerate(raw_rows, start=2):
        company = clean_str(r.get(company_col))
        if not company:
            warnings.append(f"Line {i}: missing company -> skipped")
            continue

        rows.append({
            "company": company,
            "businessPhone": clean_str(r.get(phone_col)) if phone_col else "",
            "address": clean_str(r.get(address_col)) if address_col else "",
            "areaDescription": clean_str(r.get(area_col)) if area_col else "",
        })

    return rows, warnings


def fetch_existing_keys(cur, db: str) -> set:
    cur.execute(f"SELECT `company`, `businessPhone` FROM `{db}`.`alternative_customers`")
    return {(company or "", phone or "") for company, phone in cur.fetchall()}


def main():
    ap = argparse.ArgumentParser(description="Migrate an Excel sheet into the alternative_customers table.")
    ap.add_argument("excel_path", help="Path to the .xlsx/.xls/.csv file")
    ap.add_argument("--table", default="alternative_customers")
    ap.add_argument("--dry-run", action="store_true", help="Print what would happen without writing to DB")
    ap.add_argument("--chunk", type=int, default=500, help="Batch size for executemany()")
    ap.add_argument("--debug-sql", action="store_true", help="Print generated SQL")

    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="70631859HADI")
    ap.add_argument("--db", default="new", help="Database/schema name")

    args = ap.parse_args()

    rows, warnings = read_rows(args.excel_path)

    print(f"Loaded {len(rows)} rows from {args.excel_path}.")
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
        for x in rows[:10]:
            print(x)
        return

    db = mysql.connector.connect(
        host=args.host,
        user=args.user,
        password=args.password,
        database=args.db,
        autocommit=False,
    )
    cur = db.cursor()

    try:
        existing = fetch_existing_keys(cur, args.db)

        to_insert = []
        skipped_existing = 0
        for r in rows:
            key = (r["company"], r["businessPhone"])
            if key in existing:
                skipped_existing += 1
                continue
            existing.add(key)  # avoid duplicate inserts within the same file too
            to_insert.append(r)

        insert_cols = ["company", "businessPhone", "address", "areaDescription"]
        col_list = ", ".join([f"`{c}`" for c in insert_cols])
        placeholders = ", ".join(["%s"] * len(insert_cols))
        sql = f"INSERT INTO `{args.table}` ({col_list}) VALUES ({placeholders})"

        if args.debug_sql:
            print("DEBUG SQL:", sql)

        total = 0
        for i in range(0, len(to_insert), args.chunk):
            chunk = to_insert[i: i + args.chunk]
            cur.executemany(sql, [tuple(r[c] for c in insert_cols) for r in chunk])
            total += len(chunk)
            print(f"Inserted {total}/{len(to_insert)}...")

        db.commit()
        print(f"\n✅ Done. Inserted {len(to_insert)} rows into `{args.db}`.`{args.table}` "
              f"(skipped {skipped_existing} already-present rows).")

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
