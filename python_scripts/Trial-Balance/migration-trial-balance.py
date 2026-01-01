"""
Trial Balance → Opening Balance Journal Voucher (JV) Migrator (MySQL)

✅ Your requirements implemented:
1) PRE-FLIGHT: checks ALL required Accounts / Suppliers / Customers exist first.
   - If anything missing: prints missing list and EXITS (no inserts).
2) Supplier rule FIX: Suppliers are ONLY accounts that start with 4011xxx.
   - So 4018 is treated as a normal ACCOUNT (not supplier).
3) Account lookup: match by accountNumber (full OR extracted) OR arabicAccountName (exact).
4) S-type JV rules:
   - For every detail: dr == drUSD == drOFR == drUSDOFR
   - and cr == crUSD == crOFR == crUSDOFR
   - Header totals also: totalDr == totalDrUSD == totalDrOFR == totalDrUSDOFR (etc)
5) Description: always "Opening Balance" (no customer/supplier name).
6) JV number format EXACTLY like your NestJS createJournalVoucher():
   - jvType 'S'/'SR' -> "JV{YY}-###"
   - jvType 'G'      -> "JVG{YY}-###"
   - sequence is 3 digits.

📌 Notes:
- drLL/crLL are taken from CSV DrLBP/CrLBP if present, otherwise computed as drUSD*exRateUSD.
- currency is stored as a STRING in journal_voucher_details.currency. For this S migration we set it to "USD".
- exRateUSD uses CSV ExRate if present, else DEFAULT_EXRATE_USD_TO_LBP.
- exRateEUROToUSD is set to 0 (not used for this S opening JV).
"""

import csv
import sys
from decimal import Decimal
import mysql.connector

# ============================================================================
# DATABASE CONFIG
# ============================================================================
DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "database": "pos_v1",
    "user": "root",
    "password": "70631859HADI",  # <-- change
}

# ============================================================================
# CONFIG
# ============================================================================
CSV_FILE_PATH = "last-trial.csv"
OPENING_DATE = "2026-01-01"
JV_TYPE = "S"  # this script is for opening balance S JV
INCOME_SUMMARY_ACCOUNT = "137"

DEFAULT_EXRATE_USD_TO_LBP = Decimal("89500")  # used if CSV ExRate is missing/0


# ============================================================================
# HELPERS
# ============================================================================
def to_decimal(v) -> Decimal:
    try:
        if v is None:
            return Decimal("0")
        s = str(v).replace(",", "").strip()
        if s == "":
            return Decimal("0")
        return Decimal(s)
    except Exception:
        return Decimal("0")


def extract_account_number(account_number_with_prefix: str) -> str:
    s = (account_number_with_prefix or "").strip()
    parts = s.split("-")
    return parts[1].strip() if len(parts) > 1 else s


def classify_entity_kind(extracted_account_number: str) -> str:
    """
    ✅ Supplier: 4011xxx only
    ✅ Customer: 411...
    ✅ Otherwise: account
    """
    acc = (extracted_account_number or "").strip()
    if acc.startswith("4011") and len(acc) > 4:
        return "supplier"
    if acc.startswith("411") and len(acc) > 3:
        return "customer"
    return "account"


def get_active_year_yy(cursor) -> str:
    cursor.execute("SELECT year FROM settings WHERE isActive = 1 LIMIT 1")
    r = cursor.fetchone()
    if not r:
        raise Exception("Active year not found in settings")
    return str(r[0])[-2:]


def get_next_jv_number_like_backend(cursor, jv_type: str, yy: str) -> str:
    """
    Matches your NestJS logic:
      basePrefix = (jvType === 'G') ? 'JVG' : 'JV'
      seriesPrefix = `${basePrefix}${yy}-`
      seq padStart(3,'0')
    """
    base_prefix = "JVG" if jv_type == "G" else "JV"
    series_prefix = f"{base_prefix}{yy}-"

    cursor.execute(
        """
        SELECT jvNumber
        FROM journal_vouchers
        WHERE jvNumber LIKE %s
        ORDER BY jvNumber DESC
        LIMIT 1
        """,
        (series_prefix + "%",),
    )
    r = cursor.fetchone()
    if not r:
        next_seq = 1
    else:
        last = str(r[0])
        # last looks like "JV25-001"
        try:
            last_seq = int(last.replace(series_prefix, ""))
        except Exception:
            last_seq = 0
        next_seq = last_seq + 1

    return f"{series_prefix}{str(next_seq).zfill(3)}"


def get_account_id_by_number_or_arabic(cursor, account_number_full: str, account_number_extracted: str, arabic_name: str):
    """
    Accounts table columns:
      - accountNumber
      - arabicAccountName

    Match by:
      - accountNumber = full OR extracted
      - arabicAccountName = AccountDescription (exact)
    """
    full_no = (account_number_full or "").strip()
    ext_no = (account_number_extracted or "").strip()
    ar = (arabic_name or "").strip()

    conds = []
    params = []

    if full_no:
        conds.append("TRIM(accountNumber) = TRIM(%s)")
        params.append(full_no)
    if ext_no and ext_no != full_no:
        conds.append("TRIM(accountNumber) = TRIM(%s)")
        params.append(ext_no)
    if ar:
        conds.append("arabicAccountName IS NOT NULL AND TRIM(arabicAccountName) = TRIM(%s)")
        params.append(ar)

    if not conds:
        return None

    sql = f"""
        SELECT id
        FROM accounts
        WHERE {" OR ".join(conds)}
        LIMIT 1
    """
    cursor.execute(sql, params)
    r = cursor.fetchone()
    return r[0] if r else None


def get_supplier_id_fuzzy(cursor, name: str):
    n = (name or "").strip()
    if not n:
        return None

    # exact supplierName
    cursor.execute(
        """
        SELECT id FROM suppliers
        WHERE TRIM(LOWER(supplierName)) = TRIM(LOWER(%s))
        LIMIT 1
        """,
        (n,),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # partial supplierName
    cursor.execute(
        """
        SELECT id FROM suppliers
        WHERE TRIM(LOWER(supplierName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(supplierName)), '%%')
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # firstName
    cursor.execute(
        """
        SELECT id FROM suppliers
        WHERE firstName IS NOT NULL
          AND (TRIM(LOWER(firstName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(firstName)), '%%'))
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # firstName + supplierName
    cursor.execute(
        """
        SELECT id FROM suppliers
        WHERE TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', supplierName))) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', supplierName))), '%%')
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    return r[0] if r else None


def get_customer_id_fuzzy(cursor, name: str):
    n = (name or "").strip()
    if not n:
        return None

    # exact customerName
    cursor.execute(
        """
        SELECT id FROM customers
        WHERE TRIM(LOWER(customerName)) = TRIM(LOWER(%s))
        LIMIT 1
        """,
        (n,),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # partial customerName
    cursor.execute(
        """
        SELECT id FROM customers
        WHERE TRIM(LOWER(customerName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(customerName)), '%%')
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # firstName
    cursor.execute(
        """
        SELECT id FROM customers
        WHERE firstName IS NOT NULL
          AND (TRIM(LOWER(firstName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(firstName)), '%%'))
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    if r:
        return r[0]

    # firstName + customerName
    cursor.execute(
        """
        SELECT id FROM customers
        WHERE TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', customerName))) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
           OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', customerName))), '%%')
        LIMIT 1
        """,
        (n, n),
    )
    r = cursor.fetchone()
    return r[0] if r else None


# ============================================================================
# MAIN
# ============================================================================
def import_opening_balances():
    print("=" * 80)
    print("OPENING BALANCE JV MIGRATION (S type) — lookup-only, no auto-create")
    print("=" * 80)
    print(f"CSV File: {CSV_FILE_PATH}")
    print(f"Opening Date: {OPENING_DATE}")
    print(f"JV Type: {JV_TYPE}")
    print(f"Balancing Account: {INCOME_SUMMARY_ACCOUNT}")
    print("=" * 80)

    print("\n[1/7] Connecting to database...")
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    print("✓ Connected")

    try:
        print("\n[2/7] Reading CSV file...")
        with open(CSV_FILE_PATH, "r", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        print(f"✓ Read {len(rows)} rows from CSV")

        print("\n[3/7] Generating JV number (matches backend)...")
        yy = get_active_year_yy(cursor)
        jv_number = get_next_jv_number_like_backend(cursor, JV_TYPE, yy)
        print(f"✓ JV Number: {jv_number}")

        # ------------------------------------------------------------
        # [4/7] PRE-FLIGHT: check everything exists
        # ------------------------------------------------------------
        print("\n[4/7] Preflight: checking accounts/suppliers/customers exist...")

        missing_accounts = set()
        missing_suppliers = set()
        missing_customers = set()

        account_cache = {}    # key -> accountId
        supplier_cache = {}   # key -> supplierId
        customer_cache = {}   # key -> customerId

        # income summary must exist as account
        income_summary_id = get_account_id_by_number_or_arabic(
            cursor, INCOME_SUMMARY_ACCOUNT, INCOME_SUMMARY_ACCOUNT, ""
        )
        if not income_summary_id:
            missing_accounts.add((INCOME_SUMMARY_ACCOUNT, "Income Summary"))

        for idx, row in enumerate(rows, start=1):
            account_number_full = (row.get("AccountNumber") or "").strip()
            account_number = extract_account_number(account_number_full)
            desc = (row.get("AccountDescription") or "").strip()

            # ignore zero rows
            dr_usd = to_decimal(row.get("DrUSD"))
            cr_usd = to_decimal(row.get("CrUSD"))
            if dr_usd == 0 and cr_usd == 0:
                continue

            # skip the income summary account if it appears in CSV (we’ll add balancing ourselves)
            if account_number == INCOME_SUMMARY_ACCOUNT or account_number_full == INCOME_SUMMARY_ACCOUNT:
                continue

            kind = classify_entity_kind(account_number)

            if kind == "supplier":
                key = (account_number, desc.lower())
                if key not in supplier_cache:
                    sid = get_supplier_id_fuzzy(cursor, desc)
                    if sid:
                        supplier_cache[key] = sid
                    else:
                        missing_suppliers.add((account_number, desc))

            elif kind == "customer":
                key = (account_number, desc.lower())
                if key not in customer_cache:
                    cid = get_customer_id_fuzzy(cursor, desc)
                    if cid:
                        customer_cache[key] = cid
                    else:
                        missing_customers.add((account_number, desc))

            else:
                if account_number not in account_cache and account_number_full not in account_cache:
                    aid = get_account_id_by_number_or_arabic(cursor, account_number_full, account_number, desc)
                    if aid:
                        account_cache[account_number] = aid
                        account_cache[account_number_full] = aid
                    else:
                        missing_accounts.add((account_number, desc))

        if missing_accounts or missing_suppliers or missing_customers:
            print("\n" + "=" * 80)
            print("❌ STOPPED: Missing master data. Nothing inserted.")
            print("=" * 80)

            if missing_accounts:
                print(f"\nMissing Accounts ({len(missing_accounts)}):")
                for n, name in sorted(missing_accounts):
                    print(f"  - {n} | {name}")

            if missing_suppliers:
                print(f"\nMissing Suppliers ({len(missing_suppliers)}):")
                for n, name in sorted(missing_suppliers):
                    print(f"  - {n} | {name}")

            if missing_customers:
                print(f"\nMissing Customers ({len(missing_customers)}):")
                for n, name in sorted(missing_customers):
                    print(f"  - {n} | {name}")

            sys.exit(1)

        print("✓ Preflight OK: all required master data exists.")
        print("\n[4/7] Processing rows (lookup-only)...")

        # ------------------------------------------------------------
        # REAL BUILD: Create JV details
        # S-type rule: dr == drUSD == drOFR == drUSDOFR and same for cr
        # description = "Opening Balance"
        # ------------------------------------------------------------
        details = []
        total_dr_usd = Decimal("0")
        total_cr_usd = Decimal("0")

        for idx, row in enumerate(rows, start=1):
            account_number_full = (row.get("AccountNumber") or "").strip()
            account_number = extract_account_number(account_number_full)
            desc = (row.get("AccountDescription") or "").strip()

            # skip income summary from csv
            if account_number == INCOME_SUMMARY_ACCOUNT or account_number_full == INCOME_SUMMARY_ACCOUNT:
                continue

            dr_usd = to_decimal(row.get("DrUSD"))
            cr_usd = to_decimal(row.get("CrUSD"))
            dr_lbp = to_decimal(row.get("DrLBP"))
            cr_lbp = to_decimal(row.get("CrLBP"))
            ex_rate = to_decimal(row.get("ExRate"))

            if dr_usd == 0 and cr_usd == 0:
                continue

            # exRateUSD (USD->LBP)
            ex_rate_usd = ex_rate if ex_rate > 0 else DEFAULT_EXRATE_USD_TO_LBP

            # S rule: base amounts = USD amounts
            dr = dr_usd
            cr = cr_usd
            drUSD = dr_usd
            crUSD = cr_usd

            # LL amounts: prefer CSV LBP columns if present, else compute from USD
            drLL = dr_lbp if dr_lbp != 0 else (drUSD * ex_rate_usd)
            crLL = cr_lbp if cr_lbp != 0 else (crUSD * ex_rate_usd)

            # OFR equals base for S
            drOFR = dr
            drUSDOFR = drUSD
            drLLOFR = drLL
            crOFR = cr
            crUSDOFR = crUSD
            crLLOFR = crLL

            kind = classify_entity_kind(account_number)

            account_id = None
            supplier_id = None
            customer_id = None

            if kind == "supplier":
                supplier_id = supplier_cache.get((account_number, desc.lower()))
                if not supplier_id:
                    raise Exception(f"Row {idx}: supplier missing unexpectedly: {account_number} | {desc}")

            elif kind == "customer":
                customer_id = customer_cache.get((account_number, desc.lower()))
                if not customer_id:
                    raise Exception(f"Row {idx}: customer missing unexpectedly: {account_number} | {desc}")

            else:
                account_id = account_cache.get(account_number) or account_cache.get(account_number_full)
                if not account_id:
                    # ultra safety
                    account_id = get_account_id_by_number_or_arabic(cursor, account_number_full, account_number, desc)
                if not account_id:
                    raise Exception(f"Row {idx}: account missing unexpectedly: {account_number} | {desc}")

            details.append(
                {
                    "accountId": account_id,
                    "supplierId": supplier_id,
                    "customerId": customer_id,
                    "description": "Opening Balance",

                    "dr": float(round(dr, 2)),
                    "drUSD": float(round(drUSD, 2)),
                    "drLL": float(round(drLL, 2)),
                    "drOFR": float(round(drOFR, 2)),
                    "drUSDOFR": float(round(drUSDOFR, 2)),
                    "drLLOFR": float(round(drLLOFR, 2)),

                    "cr": float(round(cr, 2)),
                    "crUSD": float(round(crUSD, 2)),
                    "crLL": float(round(crLL, 2)),
                    "crOFR": float(round(crOFR, 2)),
                    "crUSDOFR": float(round(crUSDOFR, 2)),
                    "crLLOFR": float(round(crLLOFR, 2)),

                    "currency": "USD",
                    "exRateEUROToUSD": 0.0,
                    "exRateUSD": float(round(ex_rate_usd, 2)),
                    "docNbr": None,
                }
            )

            total_dr_usd += drUSD
            total_cr_usd += crUSD

        print(f"✓ Built {len(details)} JV details rows.")

        # ------------------------------------------------------------
        # [5/7] Balancing entry (Income Summary)
        # ------------------------------------------------------------
        print("\n[5/7] Calculating Income Summary balancing entry...")
        diff = total_cr_usd - total_dr_usd  # if >0 => need extra DR
        print(f"  Total DR USD: {total_dr_usd:,.2f}")
        print(f"  Total CR USD: {total_cr_usd:,.2f}")
        print(f"  Difference:  {abs(diff):,.2f}")

        if abs(diff) > Decimal("0.01"):
            need_debit = diff > 0
            amt = abs(diff)

            ex_rate_usd = DEFAULT_EXRATE_USD_TO_LBP
            amt_ll = amt * ex_rate_usd

            details.append(
                {
                    "accountId": income_summary_id,
                    "supplierId": None,
                    "customerId": None,
                    "description": "Opening Balance",

                    "dr": float(round(amt, 2)) if need_debit else 0.0,
                    "drUSD": float(round(amt, 2)) if need_debit else 0.0,
                    "drLL": float(round(amt_ll, 2)) if need_debit else 0.0,
                    "drOFR": float(round(amt, 2)) if need_debit else 0.0,
                    "drUSDOFR": float(round(amt, 2)) if need_debit else 0.0,
                    "drLLOFR": float(round(amt_ll, 2)) if need_debit else 0.0,

                    "cr": 0.0 if need_debit else float(round(amt, 2)),
                    "crUSD": 0.0 if need_debit else float(round(amt, 2)),
                    "crLL": 0.0 if need_debit else float(round(amt_ll, 2)),
                    "crOFR": 0.0 if need_debit else float(round(amt, 2)),
                    "crUSDOFR": 0.0 if need_debit else float(round(amt, 2)),
                    "crLLOFR": 0.0 if need_debit else float(round(amt_ll, 2)),

                    "currency": "USD",
                    "exRateEUROToUSD": 0.0,
                    "exRateUSD": float(round(ex_rate_usd, 2)),
                    "docNbr": None,
                }
            )
            print(f"✓ Added Income Summary balancing row ({'DR' if need_debit else 'CR'} {amt:,.2f} USD)")
        else:
            print("✓ Already balanced.")

        # ------------------------------------------------------------
        # [6/7] Insert JV header + details (matches your entity columns)
        # ------------------------------------------------------------
        print("\n[6/7] Inserting Journal Voucher...")

        # header totals (S rule: base == USD == OFR for Dr/Cr)
        totalDrUSD = sum(Decimal(str(d["drUSD"])) for d in details)
        totalCrUSD = sum(Decimal(str(d["crUSD"])) for d in details)
        totalDrLL = sum(Decimal(str(d["drLL"])) for d in details)
        totalCrLL = sum(Decimal(str(d["crLL"])) for d in details)

        totalDr = totalDrUSD
        totalCr = totalCrUSD

        totalDrOFR = totalDr
        totalDrUSDOFR = totalDrUSD
        totalDrLLOFR = totalDrLL

        totalCrOFR = totalCr
        totalCrUSDOFR = totalCrUSD
        totalCrLLOFR = totalCrLL

        cursor.execute(
            """
            INSERT INTO journal_vouchers (
                date, jvNumber, jvType,
                totalDr, totalDrUSD, totalDrLL,
                totalDrOFR, totalDrUSDOFR, totalDrLLOFR,
                totalCr, totalCrUSD, totalCrLL,
                totalCrOFR, totalCrUSDOFR, totalCrLLOFR
            )
            VALUES (
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s
            )
            """,
            (
                OPENING_DATE, jv_number, JV_TYPE,
                float(round(totalDr, 2)), float(round(totalDrUSD, 2)), float(round(totalDrLL, 2)),
                float(round(totalDrOFR, 2)), float(round(totalDrUSDOFR, 2)), float(round(totalDrLLOFR, 2)),
                float(round(totalCr, 2)), float(round(totalCrUSD, 2)), float(round(totalCrLL, 2)),
                float(round(totalCrOFR, 2)), float(round(totalCrUSDOFR, 2)), float(round(totalCrLLOFR, 2)),
            ),
        )
        jv_id = cursor.lastrowid

        # insert details
        cursor.executemany(
            """
            INSERT INTO journal_voucher_details (
                journalVoucherId,
                accountId, supplierId, customerId,
                description,
                dr, drUSD, drLL, drOFR, drUSDOFR, drLLOFR,
                cr, crUSD, crLL, crOFR, crUSDOFR, crLLOFR,
                currency, exRateEUROToUSD, exRateUSD,
                docNbr
            )
            VALUES (
                %s,
                %s, %s, %s,
                %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s
            )
            """,
            [
                (
                    jv_id,
                    d["accountId"], d["supplierId"], d["customerId"],
                    d["description"],
                    d["dr"], d["drUSD"], d["drLL"], d["drOFR"], d["drUSDOFR"], d["drLLOFR"],
                    d["cr"], d["crUSD"], d["crLL"], d["crOFR"], d["crUSDOFR"], d["crLLOFR"],
                    d["currency"], d["exRateEUROToUSD"], d["exRateUSD"],
                    d["docNbr"],
                )
                for d in details
            ],
        )

        # ------------------------------------------------------------
        # [7/7] Commit
        # ------------------------------------------------------------
        print("\n[7/7] Committing...")
        conn.commit()

        print("\n" + "=" * 80)
        print("✅ IMPORT COMPLETED SUCCESSFULLY")
        print("=" * 80)
        print(f"JV ID:     {jv_id}")
        print(f"JV Number: {jv_number}")
        print(f"Details:   {len(details)}")
        print(f"Total DR USD: {float(round(totalDrUSD, 2)):,.2f}")
        print(f"Total CR USD: {float(round(totalCrUSD, 2)):,.2f}")

    except Exception as e:
        conn.rollback()
        print("\n" + "=" * 80)
        print("❌ IMPORT FAILED - ROLLED BACK")
        print("=" * 80)
        print(str(e))
        raise
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    import_opening_balances()
