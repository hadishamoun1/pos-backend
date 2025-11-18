

import csv
import os
import re
import sys
from decimal import Decimal, InvalidOperation
import mysql.connector

# ====================== CONFIG ======================

# ---- DB creds set directly here ----
DB_HOST = "localhost"
DB_PORT = 3306
DB_USER = "root"
DB_PASS = "70631859HADI"
DB_NAME = "pos_v1"

# CSV path: default next to this script; can be overridden by argv[1]
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE_PATH = os.path.join(SCRIPT_DIR, "suppliersCsvfinal.csv")

# If True: rows referencing non-existing currencyId/accountId will be inserted
# at the very end with foreign key checks temporarily disabled.
FORCE_INSERT_WITHOUT_FK = False

# If True: also update `id = VALUES(id)` on duplicate (be careful!)
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


def open_db():
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
    )


def load_fk_sets(cur):
    """Return (valid_currency_ids, valid_account_ids) as sets."""
    cur.execute("SELECT id FROM currency")
    currency_ids = {row[0] for row in cur.fetchall()}
    cur.execute("SELECT id FROM accounts")
    account_ids = {row[0] for row in cur.fetchall()}
    return currency_ids, account_ids


def resolve_csv_path(arg_path: str | None) -> str:
    if arg_path:
        p = arg_path
    else:
        p = CSV_FILE_PATH
    if not os.path.isabs(p):
        p = os.path.join(SCRIPT_DIR, p)
    if not os.path.exists(p):
        raise FileNotFoundError(f"CSV not found at: {p}")
    return p


def read_csv_rows(csv_path):
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            r = normalize_keys(raw)

            rid = pick(r, "id", "supplierid")
            supplier_acc = pick(
                r, "supplieraccountnumber", "accountnumber", "accountno", "accno"
            )
            supplier_name = pick(r, "suppliername", "name")
            first_name = pick(r, "firstname")
            middle_name = pick(r, "middlename")
            area = pick(r, "area")
            company_type = pick(r, "companytype")
            payment_terms = pick(r, "paymentterms", "paymentterm")
            currency_id = parse_int(pick(r, "currencyid"))
            address = pick(r, "address")
            phone_number = pick(r, "phonenumber", "phone")
            financial_number = pick(r, "financialnumber", "taxnumber", "vatnumber")
            vat = parse_decimal(pick(r, "vat"))
            account_id = parse_int(pick(r, "accountid"))

            if rid is not None:
                rid = parse_int(rid)
                if rid is None:
                    print(f"SKIP (invalid id): {raw}")
                    continue

            if not supplier_acc:
                print(f"SKIP (missing supplierAccountNumber): {raw}")
                continue
            if not supplier_name:
                supplier_name = ""

            rows.append(
                {
                    "id": rid,  # may be None
                    "supplierAccountNumber": str(supplier_acc),
                    "supplierName": supplier_name,
                    "firstName": first_name,
                    "middleName": middle_name,
                    "area": area,
                    "companyType": company_type,
                    "paymentTerms": payment_terms,
                    "currencyId": currency_id,
                    "address": address,
                    "phoneNumber": phone_number,
                    "financialNumber": financial_number,
                    "vat": vat,
                    "accountId": account_id,
                }
            )
    return rows


def main():
    # CSV path (allow override via argv)
    csv_path = resolve_csv_path(sys.argv[1] if len(sys.argv) > 1 else None)

    db = open_db()
    cur = db.cursor()

    # Pre-load FK sets
    valid_currency_ids, valid_account_ids = load_fk_sets(cur)

    rows = read_csv_rows(csv_path)
    if not rows:
        print("No rows to import.")
        cur.close()
        db.close()
        return

    # Build UPSERT SQL
    cols = [
        "id",
        "supplierAccountNumber",
        "supplierName",
        "firstName",
        "middleName",
        "area",
        "companyType",
        "paymentTerms",
        "currencyId",
        "address",
        "phoneNumber",
        "financialNumber",
        "vat",
        "accountId",
    ]
    placeholders = ", ".join(["%s"] * len(cols))

    update_parts = []
    if UPDATE_ID_ON_DUPLICATE:
        update_parts.append("id = VALUES(id)")
    update_parts.extend(
        [
            "supplierAccountNumber = VALUES(supplierAccountNumber)",
            "supplierName = VALUES(supplierName)",
            "firstName = VALUES(firstName)",
            "middleName = VALUES(middleName)",
            "area = VALUES(area)",
            "companyType = VALUES(companyType)",
            "paymentTerms = VALUES(paymentTerms)",
            "currencyId = VALUES(currencyId)",
            "address = VALUES(address)",
            "phoneNumber = VALUES(phoneNumber)",
            "financialNumber = VALUES(financialNumber)",
            "vat = VALUES(vat)",
            "accountId = VALUES(accountId)",
        ]
    )
    update_sql = ",\n      ".join(update_parts)

    upsert_sql = f"""
    INSERT INTO suppliers ({", ".join(cols)})
    VALUES ({placeholders})
    ON DUPLICATE KEY UPDATE
      {update_sql}
    """

    def row_values(r):
        return [
            r["id"],
            r["supplierAccountNumber"],
            r["supplierName"],
            r["firstName"],
            r["middleName"],
            r["area"],
            r["companyType"],
            r["paymentTerms"],
            r["currencyId"],
            r["address"],
            r["phoneNumber"],
            r["financialNumber"],
            r["vat"],
            r["accountId"],
        ]

    # Split rows by FK readiness
    ready_vals = []
    pending_rows = []
    for r in rows:
        ci_ok = (r["currencyId"] is None) or (r["currencyId"] in valid_currency_ids)
        ai_ok = (r["accountId"] is None) or (r["accountId"] in valid_account_ids)
        if ci_ok and ai_ok:
            ready_vals.append(row_values(r))
        else:
            pending_rows.append(r)

    inserted = 0
    if ready_vals:
        try:
            cur.executemany(upsert_sql, ready_vals)
            db.commit()
            inserted += cur.rowcount
        except mysql.connector.Error as e:
            print("ERROR inserting ready rows:", e)
            db.rollback()

    # Retry pending after refreshing FK sets once
    if pending_rows:
        valid_currency_ids, valid_account_ids = load_fk_sets(cur)
        still_pending = []
        newly_ready = []
        for r in pending_rows:
            ci_ok = (r["currencyId"] is None) or (r["currencyId"] in valid_currency_ids)
            ai_ok = (r["accountId"] is None) or (r["accountId"] in valid_account_ids)
            if ci_ok and ai_ok:
                newly_ready.append(row_values(r))
            else:
                still_pending.append(r)

        if newly_ready:
            try:
                cur.executemany(upsert_sql, newly_ready)
                db.commit()
                inserted += cur.rowcount
            except mysql.connector.Error as e:
                print("ERROR inserting newly-ready rows:", e)
                db.rollback()

        pending_rows = still_pending

    # Forced insert without FK checks (optional)
    if pending_rows and FORCE_INSERT_WITHOUT_FK:
        print(f"{len(pending_rows)} rows pending due to FK constraints. Forcing insert with FK checks disabled...")
        try:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            db.commit()
            cur.executemany(upsert_sql, [row_values(r) for r in pending_rows])
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
        pending_rows = []

    print(f"Upserted rows (affected count from executemany): {inserted}")
    if pending_rows:
        print("\nLeft pending (FK missing):")
        for r in pending_rows:
            print(
                {
                    "supplierAccountNumber": r["supplierAccountNumber"],
                    "currencyId": r["currencyId"],
                    "accountId": r["accountId"],
                }
            )

    cur.close()
    db.close()


if __name__ == "__main__":
    try:
        # Allow: python migrateSuppliers.py  "C:\path\to\your.csv"
        main()
    except KeyboardInterrupt:
        sys.exit(1)
