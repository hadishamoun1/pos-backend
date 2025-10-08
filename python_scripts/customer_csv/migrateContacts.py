#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Import/Upsert customers ("contacts") from CSV into MySQL.

- Table: customers
- Upsert key: UNIQUE(customerAccountNumber)
- Validates FK existence for currencyId and accountId (unless forced)
- Handles flexible CSV headers (case/space/underscore-insensitive)
- Primary key id is inserted for new rows; by default we DO NOT overwrite id on duplicates.

Requires:
  pip install mysql-connector-python
"""

import csv
import re
import sys
from decimal import Decimal, InvalidOperation
import mysql.connector

# ====================== CONFIG ======================

# ---- DB creds set directly here ----
DB_HOST = "localhost"
DB_PORT = 3306
DB_USER = "root"
DB_PASS = "70631859HADI"   # ← your MySQL root password
DB_NAME = "new_schema2"

# CSV path
CSV_FILE_PATH = "finalContactsCsv.csv"

# If True: rows referencing non-existing currencyId/accountId will be inserted
# at the very end with foreign key checks temporarily disabled.
FORCE_INSERT_WITHOUT_FK = False

# If True: also update `id = VALUES(id)` on duplicate. Be careful with FKs.
UPDATE_ID_ON_DUPLICATE = False

# ====================================================


# ---------- Helpers ----------
def normalize_keys(row: dict) -> dict:
    """
    Lowercase header names and strip all non-alphanumerics (spaces, underscores, etc.).
    Values are stripped; empty string -> None.
    """
    out = {}
    for k, v in row.items():
        nk = re.sub(r"[^a-z0-9]+", "", (k or "").lower())
        if isinstance(v, str):
            v = v.strip()
        out[nk] = (v if v != "" else None)
    return out


def pick(d: dict, *keys):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def parse_int(x, default=None):
    if x is None:
        return default
    try:
        return int(str(x).strip())
    except (ValueError, TypeError):
        return default


def parse_decimal(x, default=None):
    if x is None or str(x).strip() == "":
        return default
    try:
        return Decimal(str(x).strip())
    except (InvalidOperation, ValueError):
        return default


def parse_invoice_type(x):
    """Normalize invoiceType to 'S' | 'G' | 'Both' | None."""
    if x is None:
        return None
    s = str(x).strip().lower()
    if s in {"s", "sale", "sales"}:
        return "S"
    if s in {"g", "general"}:
        return "G"
    if s in {"both", "s,g", "g,s", "sg", "gs"}:
        return "Both"
    # If CSV already uses exact enum (S/G/Both), keep it
    if s in {"both"}:
        return "Both"
    if s == "s":
        return "S"
    if s == "g":
        return "G"
    return None


def open_db():
    return mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
    )


def load_fk_sets(cur):
    """Return (valid_currency_ids, valid_account_ids) as sets."""
    # Adjust table names if yours differ
    cur.execute("SELECT id FROM currency")
    currency_ids = {row[0] for row in cur.fetchall()}
    cur.execute("SELECT id FROM accounts")
    account_ids = {row[0] for row in cur.fetchall()}
    return currency_ids, account_ids


def read_csv_rows(csv_path):
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            r = normalize_keys(raw)

            rid              = pick(r, "id", "customerid")  # optional
            customer_acc_num = pick(r, "customeraccountnumber", "accountnumber", "accountno")
            customer_name    = pick(r, "customername", "name")

            first_name    = pick(r, "firstname")
            middle_name   = pick(r, "middlename")
            payment_terms = pick(r, "paymentterms", "paymentterm")
            area          = pick(r, "area")
            company_type  = pick(r, "companytype")

            address         = pick(r, "address")
            phone_number    = pick(r, "phonenumber", "phone")
            financial_number= pick(r, "financialnumber", "taxnumber", "vatnumber")

            invoice_type  = parse_invoice_type(pick(r, "invoicetype"))
            vat           = parse_decimal(pick(r, "vat"))

            currency_id   = parse_int(pick(r, "currencyid"))
            account_id    = parse_int(pick(r, "accountid"))

            # Required fields
            if not customer_acc_num:
                print(f"SKIP row (missing customerAccountNumber): {raw}")
                continue
            if not customer_name:
                # entity requires customerName NOT NULL; use empty string to pass
                customer_name = ""

            rid_parsed = parse_int(rid) if rid is not None else None

            rows.append(
                {
                    "id": rid_parsed,  # may be None
                    "customerAccountNumber": str(customer_acc_num),
                    "customerName": customer_name,
                    "firstName": first_name,
                    "middleName": middle_name,
                    "paymentTerms": payment_terms,
                    "area": area,
                    "companyType": company_type,
                    "address": address,
                    "phoneNumber": phone_number,
                    "financialNumber": financial_number,
                    "invoiceType": invoice_type,
                    "vat": vat,
                    "currencyId": currency_id,
                    "accountId": account_id,
                }
            )
    return rows


def main():
    db = open_db()
    cur = db.cursor()

    # Pre-load FK sets
    valid_currency_ids, valid_account_ids = load_fk_sets(cur)

    rows = read_csv_rows(CSV_FILE_PATH)
    if not rows:
        print("No rows to import.")
        cur.close()
        db.close()
        return

    # Build UPSERT SQL
    cols = [
        "id",
        "customerAccountNumber",
        "customerName",
        "firstName",
        "middleName",
        "paymentTerms",
        "area",
        "companyType",
        "address",
        "phoneNumber",
        "financialNumber",
        "invoiceType",
        "vat",
        "currencyId",
        "accountId",
    ]
    placeholders = ", ".join(["%s"] * len(cols))

    # ON DUPLICATE: update all but id by default
    update_parts = []
    if UPDATE_ID_ON_DUPLICATE:
        update_parts.append("id = VALUES(id)")
    update_parts.extend(
        [
            "customerAccountNumber = VALUES(customerAccountNumber)",
            "customerName = VALUES(customerName)",
            "firstName = VALUES(firstName)",
            "middleName = VALUES(middleName)",
            "paymentTerms = VALUES(paymentTerms)",
            "area = VALUES(area)",
            "companyType = VALUES(companyType)",
            "address = VALUES(address)",
            "phoneNumber = VALUES(phoneNumber)",
            "financialNumber = VALUES(financialNumber)",
            "invoiceType = VALUES(invoiceType)",
            "vat = VALUES(vat)",
            "currencyId = VALUES(currencyId)",
            "accountId = VALUES(accountId)",
        ]
    )
    update_sql = ",\n      ".join(update_parts)

    upsert_sql = f"""
    INSERT INTO customers ({", ".join(cols)})
    VALUES ({placeholders})
    ON DUPLICATE KEY UPDATE
      {update_sql}
    """

    # Split rows: ready vs pending (FK)
    ready, pending = [], []
    for r in rows:
        ci_ok = (r["currencyId"] is None) or (r["currencyId"] in valid_currency_ids)
        ai_ok = (r["accountId"] is None) or (r["accountId"] in valid_account_ids)
        if ci_ok and ai_ok:
            ready.append(r)
        else:
            pending.append(r)

    def row_values(r):
        return [
            r["id"],
            r["customerAccountNumber"],
            r["customerName"],
            r["firstName"],
            r["middleName"],
            r["paymentTerms"],
            r["area"],
            r["companyType"],
            r["address"],
            r["phoneNumber"],
            r["financialNumber"],
            r["invoiceType"],
            r["vat"],
            r["currencyId"],
            r["accountId"],
        ]

    inserted = 0
    if ready:
        try:
            cur.executemany(upsert_sql, [row_values(r) for r in ready])
            db.commit()
            inserted += cur.rowcount
        except mysql.connector.Error as e:
            print("ERROR inserting ready rows:", e)
            db.rollback()

    if pending:
        # Refresh FK sets once (maybe parents were loaded meanwhile)
        valid_currency_ids, valid_account_ids = load_fk_sets(cur)
        still_pending = []
        new_ready_vals = []
        for r in pending:
            ci_ok = (r["currencyId"] is None) or (r["currencyId"] in valid_currency_ids)
            ai_ok = (r["accountId"] is None) or (r["accountId"] in valid_account_ids)
            if ci_ok and ai_ok:
                new_ready_vals.append(row_values(r))
            else:
                still_pending.append(r)

        if new_ready_vals:
            try:
                cur.executemany(upsert_sql, new_ready_vals)
                db.commit()
                inserted += cur.rowcount
            except mysql.connector.Error as e:
                print("ERROR inserting newly-ready rows:", e)
                db.rollback()

        pending = still_pending

    if pending and FORCE_INSERT_WITHOUT_FK:
        print(f"{len(pending)} rows pending due to FK constraints. Forcing insert with FK checks disabled...")
        try:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            db.commit()
            cur.executemany(upsert_sql, [row_values(r) for r in pending])
            db.commit()
            inserted += cur.rowcount
        except mysql.connector.Error as e:
            print("ERROR during forced insert:", e)
            db.rollback()
        finally:
            try:
                cur.execute("SET FOREIGN_KEY_CHECKS=1")
                db.commit()
            except Exception:
                pass
        pending = []

    print(f"Upserted rows (affected count from executemany): {inserted}")
    if pending:
        print("\nLeft pending (FK missing):")
        for r in pending:
            print(
                {
                    "customerAccountNumber": r["customerAccountNumber"],
                    "currencyId": r["currencyId"],
                    "accountId": r["accountId"],
                }
            )

    cur.close()
    db.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
