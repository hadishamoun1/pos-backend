"""
Trial Balance → Opening Balance Journal Voucher (JV) Migrator (MySQL) — TYPE G

✅ Creates a **G-type** JV from the SAME CSV file.
✅ NO auto-create: it only looks up accounts/suppliers/customers. If missing → prints list and exits.
✅ JV number format matches your NestJS createJournalVoucher():
   - G type => JVG{YY}-###   (3 digits)
✅ IMPORTANT for your request:
   - We fill **ONLY OFR columns** (drOFR/drUSDOFR/drLLOFR, crOFR/crUSDOFR/crLLOFR)
   - Base columns are set to **0** (dr/drUSD/drLL/cr/crUSD/crLL = 0) to satisfy NOT NULL columns
   - Header totals: base totals are **0**, OFR totals are computed normally
✅ Description: always "Opening Balance"

CSV expected columns:
  AccountNumber, AccountDescription, DrUSD, CrUSD, DrLBP, CrLBP, ExRate, AccCur (AccCur used only if you want later)

"""

import csv
import sys
from decimal import Decimal, ROUND_HALF_UP
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
CSV_FILE_PATH = "trial-balance-G.csv"
OPENING_DATE = "2026-01-01"
JV_TYPE = "G"  # ✅ G type
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


Q2 = Decimal("0.01")


def money2(d: Decimal) -> Decimal:
    return (d or Decimal("0")).quantize(Q2, rounding=ROUND_HALF_UP)


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
    Matches NestJS:
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
        try:
            last_seq = int(last.replace(series_prefix, ""))
        except Exception:
            last_seq = 0
        next_seq = last_seq + 1

    return f"{series_prefix}{str(next_seq).zfill(3)}"


def get_account_id_by_number_or_arabic(cursor, account_number_full: str, account_number_extracted: str, arabic_name: str):
    """
    Match accounts by:
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
def import_opening_balances_g():
    print("=" * 80)
    print("OPENING BALANCE JV MIGRATION — TYPE G (OFR ONLY)")
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
        # [4/7] PRE-FLIGHT
        # ------------------------------------------------------------
        print("\n[4/7] Preflight: checking accounts/suppliers/customers exist...")

        missing_accounts = set()
        missing_suppliers = set()
        missing_customers = set()

        account_cache = {}
        supplier_cache = {}
        customer_cache = {}

        income_summary_id = get_account_id_by_number_or_arabic(
            cursor, INCOME_SUMMARY_ACCOUNT, INCOME_SUMMARY_ACCOUNT, ""
        )
        if not income_summary_id:
            missing_accounts.add((INCOME_SUMMARY_ACCOUNT, "Income Summary"))

        for row in rows:
            account_number_full = (row.get("AccountNumber") or "").strip()
            account_number = extract_account_number(account_number_full)
            desc = (row.get("AccountDescription") or "").strip()

            dr_usd = to_decimal(row.get("DrUSD"))
            cr_usd = to_decimal(row.get("CrUSD"))
            if dr_usd == 0 and cr_usd == 0:
                continue

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

        print("✓ Preflight OK.")
        print("\n[4/7] Processing rows (OFR only)...")

        # ------------------------------------------------------------
        # REAL BUILD: details (BASE = 0, OFR filled)
        # ------------------------------------------------------------
        details = []
        total_dr_usd_ofr = Decimal("0")
        total_cr_usd_ofr = Decimal("0")

        for idx, row in enumerate(rows, start=1):
            account_number_full = (row.get("AccountNumber") or "").strip()
            account_number = extract_account_number(account_number_full)
            desc = (row.get("AccountDescription") or "").strip()

            if account_number == INCOME_SUMMARY_ACCOUNT or account_number_full == INCOME_SUMMARY_ACCOUNT:
                continue

            dr_usd = to_decimal(row.get("DrUSD"))
            cr_usd = to_decimal(row.get("CrUSD"))
            dr_lbp = to_decimal(row.get("DrLBP"))
            cr_lbp = to_decimal(row.get("CrLBP"))
            ex_rate = to_decimal(row.get("ExRate"))

            if dr_usd == 0 and cr_usd == 0:
                continue

            ex_rate_usd = ex_rate if ex_rate > 0 else DEFAULT_EXRATE_USD_TO_LBP

            # ✅ OFR amounts derived from CSV USD (and LBP for LL columns if provided)
            drUSDOFR = dr_usd
            crUSDOFR = cr_usd

            # For OFR "drOFR/crOFR": keep them equal to USD OFR as you requested (common for G in your system)
            drOFR = drUSDOFR
            crOFR = crUSDOFR

            # OFR LL amounts
            drLLOFR = dr_lbp if dr_lbp != 0 else (drUSDOFR * ex_rate_usd)
            crLLOFR = cr_lbp if cr_lbp != 0 else (crUSDOFR * ex_rate_usd)

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
                    account_id = get_account_id_by_number_or_arabic(cursor, account_number_full, account_number, desc)
                if not account_id:
                    raise Exception(f"Row {idx}: account missing unexpectedly: {account_number} | {desc}")

            details.append(
                {
                    "accountId": account_id,
                    "supplierId": supplier_id,
                    "customerId": customer_id,
                    "description": "Opening Balance",

                    # ✅ BASE columns MUST be present (NOT NULL) => set to 0 for G
                    "dr": "0.00",
                    "drUSD": "0.00",
                    "drLL": "0.00",
                    "cr": "0.00",
                    "crUSD": "0.00",
                    "crLL": "0.00",

                    # ✅ OFR columns filled
                    "drOFR": str(money2(drOFR)),
                    "drUSDOFR": str(money2(drUSDOFR)),
                    "drLLOFR": str(money2(drLLOFR)),
                    "crOFR": str(money2(crOFR)),
                    "crUSDOFR": str(money2(crUSDOFR)),
                    "crLLOFR": str(money2(crLLOFR)),

                    "currency": "USD",
                    "exRateEUROToUSD": "0.00",
                    "exRateUSD": str(money2(ex_rate_usd)),
                    "docNbr": None,
                }
            )

            total_dr_usd_ofr += drUSDOFR
            total_cr_usd_ofr += crUSDOFR

        print(f"✓ Built {len(details)} JV details rows.")

        # ------------------------------------------------------------
        # [5/7] Balancing entry (OFR-only)
        # ------------------------------------------------------------
        print("\n[5/7] Calculating balancing (OFR-only)...")
        diff = total_cr_usd_ofr - total_dr_usd_ofr  # if >0 => need extra DR (OFR)
        print(f"  Total DR USDOFR: {money2(total_dr_usd_ofr):,.2f}")
        print(f"  Total CR USDOFR: {money2(total_cr_usd_ofr):,.2f}")
        print(f"  Difference:      {money2(abs(diff)):,.2f}")

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

                    # base zeros
                    "dr": "0.00",
                    "drUSD": "0.00",
                    "drLL": "0.00",
                    "cr": "0.00",
                    "crUSD": "0.00",
                    "crLL": "0.00",

                    # OFR balance
                    "drOFR": str(money2(amt)) if need_debit else "0.00",
                    "drUSDOFR": str(money2(amt)) if need_debit else "0.00",
                    "drLLOFR": str(money2(amt_ll)) if need_debit else "0.00",
                    "crOFR": "0.00" if need_debit else str(money2(amt)),
                    "crUSDOFR": "0.00" if need_debit else str(money2(amt)),
                    "crLLOFR": "0.00" if need_debit else str(money2(amt_ll)),

                    "currency": "USD",
                    "exRateEUROToUSD": "0.00",
                    "exRateUSD": str(money2(ex_rate_usd)),
                    "docNbr": None,
                }
            )
            print(f"✓ Added Income Summary balancing row (OFR {'DR' if need_debit else 'CR'} {money2(amt):,.2f} USD)")
        else:
            print("✓ Already balanced.")

        # ------------------------------------------------------------
        # [6/7] Insert JV header + details
        #   - Base totals = 0
        #   - OFR totals filled
        # ------------------------------------------------------------
        print("\n[6/7] Inserting Journal Voucher...")

        totalDrOFR = sum(Decimal(d["drOFR"]) for d in details)
        totalDrUSDOFR = sum(Decimal(d["drUSDOFR"]) for d in details)
        totalDrLLOFR = sum(Decimal(d["drLLOFR"]) for d in details)

        totalCrOFR = sum(Decimal(d["crOFR"]) for d in details)
        totalCrUSDOFR = sum(Decimal(d["crUSDOFR"]) for d in details)
        totalCrLLOFR = sum(Decimal(d["crLLOFR"]) for d in details)

        # Base totals must be 0 for G
        totalDr = Decimal("0.00")
        totalDrUSD = Decimal("0.00")
        totalDrLL = Decimal("0.00")
        totalCr = Decimal("0.00")
        totalCrUSD = Decimal("0.00")
        totalCrLL = Decimal("0.00")

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
                str(money2(totalDr)), str(money2(totalDrUSD)), str(money2(totalDrLL)),
                str(money2(totalDrOFR)), str(money2(totalDrUSDOFR)), str(money2(totalDrLLOFR)),
                str(money2(totalCr)), str(money2(totalCrUSD)), str(money2(totalCrLL)),
                str(money2(totalCrOFR)), str(money2(totalCrUSDOFR)), str(money2(totalCrLLOFR)),
            ),
        )
        jv_id = cursor.lastrowid

        cursor.executemany(
            """
            INSERT INTO journal_voucher_details (
                journalVoucherId,
                accountId, supplierId, customerId,
                description,
                dr, drUSD, drLL,
                drOFR, drUSDOFR, drLLOFR,
                cr, crUSD, crLL,
                crOFR, crUSDOFR, crLLOFR,
                currency, exRateEUROToUSD, exRateUSD,
                docNbr
            )
            VALUES (
                %s,
                %s, %s, %s,
                %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s
            )
            """,
            [
                (
                    jv_id,
                    d["accountId"], d["supplierId"], d["customerId"],
                    d["description"],
                    d["dr"], d["drUSD"], d["drLL"],
                    d["drOFR"], d["drUSDOFR"], d["drLLOFR"],
                    d["cr"], d["crUSD"], d["crLL"],
                    d["crOFR"], d["crUSDOFR"], d["crLLOFR"],
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
        print("✅ IMPORT COMPLETED SUCCESSFULLY (G / OFR only)")
        print("=" * 80)
        print(f"JV ID:     {jv_id}")
        print(f"JV Number: {jv_number}")
        print(f"Details:   {len(details)}")
        print(f"Total DR USDOFR: {money2(totalDrUSDOFR):,.2f}")
        print(f"Total CR USDOFR: {money2(totalCrUSDOFR):,.2f}")

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
    import_opening_balances_g()
