#!/usr/bin/env python3
import csv
import sys
from decimal import Decimal, InvalidOperation
from datetime import datetime
import mysql.connector
from mysql.connector import IntegrityError

# ===================== CONFIG =====================
DB = dict(
    host="localhost",
    user="root",
    password="70631859HADI",
    database="new_schema2",
)

# CSV file paths
JOURNAL_VOUCHERS_CSV = "jvlastc.csv"
JOURNAL_VOUCHER_DETAILS_CSV = "jvdetailslastc.csv"

# If your dates are primarily day/month/year (e.g. 1/2/2018 = 1 Feb),
# set this to True. Otherwise leave False (MM/DD/YYYY preferred).
PREFER_DMY = False

# Commit every N rows for performance
BATCH_SIZE_V = 5000
BATCH_SIZE_D = 5000

# Stop when details reference missing vouchers? (recommended = False)
# False → stop & report; True → skip missing and continue
CONTINUE_ON_MISSING = False

# Clear destination tables before import? (Danger: deletes data)
CLEAR_FIRST = False

REPORT_MISSING_FK = "missing_jv_ids_report.csv"
# ==================================================


# ---------- helpers ----------
def normalize_keys(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        nk = (k or "").strip().lower()
        if isinstance(v, str):
            v = v.strip()
            v = v if v != "" else None
        out[nk] = v
    return out


def pick(d: dict, *keys):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def dec(x):
    if x is None:
        return Decimal("0")
    try:
        return Decimal(str(x).replace(",", "").strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def int_or_none(x):
    if x is None:
        return None
    s = str(x).strip()
    return int(s) if s.isdigit() else None


def to_iso_date(s: str | None) -> str | None:
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    # drop time
    if " " in s:
        s = s.split()[0]

    sn = (
        s.replace("\\", "/")
         .replace(".", "/")
         .replace("-", "/")
         .strip()
    )

    dmy = ["%d/%m/%Y", "%d/%m/%y"]
    mdy = ["%m/%d/%Y", "%m/%d/%y"]
    ymd = ["%Y/%m/%d", "%Y-%m-%d"]

    fmts = (dmy + mdy + ymd) if PREFER_DMY else (mdy + dmy + ymd)

    for fmt in fmts:
        for candidate in (s, sn):
            try:
                return datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                pass
    return None


def write_missing_report(rows):
    with open(REPORT_MISSING_FK, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["reason", "journalVoucherId", "accountId", "docNbr"])
        for r in rows:
            w.writerow([r["reason"], r["journalVoucherId"], r["accountId"], r["docNbr"]])


def main():
    # ---------- DB ----------
    db = mysql.connector.connect(**DB)
    cur = db.cursor()

    if CLEAR_FIRST:
        print("⚠️  CLEAR_FIRST=True → deleting existing data…")
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        cur.execute("TRUNCATE TABLE journal_voucher_details")
        cur.execute("TRUNCATE TABLE journal_vouchers")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")
        db.commit()
        print("   Cleared.")

    # ---------- SQL ----------
    # NOTE: This upsert is keyed **only by PRIMARY KEY (id)**.
    # jvNumber duplicates are allowed (you must drop the unique index beforehand).
    upsert_vouchers = """
    INSERT INTO journal_vouchers
      (id, date, jvNumber, totalDr, totalDrUSD, totalDrLL, totalDrOFR, totalDrUSDOFR, totalDrLLOFR,
       totalCr, totalCrUSD, totalCrLL, totalCrOFR, totalCrUSDOFR, totalCrLLOFR, jvType)
    VALUES
      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
      date=VALUES(date),
      jvNumber=VALUES(jvNumber),
      totalDr=VALUES(totalDr), totalDrUSD=VALUES(totalDrUSD), totalDrLL=VALUES(totalDrLL),
      totalDrOFR=VALUES(totalDrOFR), totalDrUSDOFR=VALUES(totalDrUSDOFR), totalDrLLOFR=VALUES(totalDrLLOFR),
      totalCr=VALUES(totalCr), totalCrUSD=VALUES(totalCrUSD), totalCrLL=VALUES(totalCrLL),
      totalCrOFR=VALUES(totalCrOFR), totalCrUSDOFR=VALUES(totalCrUSDOFR), totalCrLLOFR=VALUES(totalCrLLOFR),
      jvType=VALUES(jvType)
    """

    insert_details = """
    INSERT INTO journal_voucher_details
      (accountId, description, dr, drUSD, drLL, drOFR, drUSDOFR, drLLOFR,
       cr, crUSD, crLL, crOFR, crUSDOFR, crLLOFR, currency, exRateEUROToUSD, exRateUSD, docNbr, journalVoucherId)
    VALUES
      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    # ---------- 1) Load JOURNAL VOUCHERS ----------
    with open(JOURNAL_VOUCHERS_CSV, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        batch = []
        total = 0
        warn_dates = 0

        for raw in reader:
            r = normalize_keys(raw)

            rid = int_or_none(pick(r, "id"))
            if rid is None:
                # must have id to keep the mapping for details
                continue

            jv_number = pick(r, "jvnumber")
            iso_date = to_iso_date(pick(r, "date"))
            if pick(r, "date") and iso_date is None:
                warn_dates += 1  # will store NULL

            vals = (
                rid,
                iso_date,
                jv_number,
                dec(pick(r, "totaldr")),
                dec(pick(r, "totaldrusd")),
                dec(pick(r, "totaldrll")),
                dec(pick(r, "totaldrofr")),
                dec(pick(r, "totaldrusdofr")),
                dec(pick(r, "totaldrllofr")),
                dec(pick(r, "totalcr")),
                dec(pick(r, "totalcrusd")),
                dec(pick(r, "totalcrll")),
                dec(pick(r, "totalcrofr")),
                dec(pick(r, "totalcrusdofr")),
                dec(pick(r, "totalcrllofr")),
                pick(r, "jvtype"),
            )

            batch.append(vals)
            total += 1
            if len(batch) >= BATCH_SIZE_V:
                cur.executemany(upsert_vouchers, batch)
                db.commit()
                batch.clear()

        if batch:
            cur.executemany(upsert_vouchers, batch)
            db.commit()
            batch.clear()

        print(f"✅ Upserted {total:,} journal vouchers.")
        if warn_dates:
            print(f"⚠️  {warn_dates} JV rows had unrecognized dates → stored as NULL (they won't match date filters).")

    # ---------- 2) Voucher IDs present in DB ----------
    cur.execute("SELECT id FROM journal_vouchers")
    db_voucher_ids = {row[0] for row in cur.fetchall()}
    print(f"ℹ️  Voucher IDs found in DB: {len(db_voucher_ids):,}")

    # ---------- 3) Prefight DETAILS ----------
    missing_rows = []
    details_rows_for_insert = []

    with open(JOURNAL_VOUCHER_DETAILS_CSV, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            r = normalize_keys(raw)

            account_id = int_or_none(pick(r, "accountid"))
            jv_id = int_or_none(pick(r, "journalvoucherid"))

            if jv_id is None or jv_id not in db_voucher_ids:
                missing_rows.append({
                    "reason": "journalVoucherId missing/not in DB",
                    "journalVoucherId": pick(r, "journalvoucherid"),
                    "accountId": account_id,
                    "docNbr": pick(r, "docnbr"),
                })
                continue

            details_rows_for_insert.append((
                account_id,
                pick(r, "description"),
                dec(pick(r, "dr")),
                dec(pick(r, "drusd")),
                dec(pick(r, "drll")),
                dec(pick(r, "drofr")),
                dec(pick(r, "drusdofr")),
                dec(pick(r, "drllofr")),
                dec(pick(r, "cr")),
                dec(pick(r, "crusd")),
                dec(pick(r, "crll")),
                dec(pick(r, "crofr")),
                dec(pick(r, "crusdofr")),
                dec(pick(r, "crllofr")),
                pick(r, "currency"),
                dec(pick(r, "exrateeurotousd")),
                dec(pick(r, "exrateusd")),
                pick(r, "docnbr"),
                jv_id,
            ))

    if missing_rows:
        write_missing_report(missing_rows)
        print(f"❗ {len(missing_rows):,} detail rows reference voucher IDs not present in DB.")
        print(f"   → Sample written to: {REPORT_MISSING_FK}")
        if not CONTINUE_ON_MISSING:
            print("⛔ Stopping because CONTINUE_ON_MISSING=False.")
            cur.close()
            db.close()
            sys.exit(2)
        else:
            print("➡️  Continuing; missing-FK rows will be skipped.")

    # ---------- 4) Insert DETAILS ----------
    total_details = 0
    batch = []
    try:
        for vals in details_rows_for_insert:
            batch.append(vals)
            total_details += 1
            if len(batch) >= BATCH_SIZE_D:
                cur.executemany(insert_details, batch)
                db.commit()
                batch.clear()
        if batch:
            cur.executemany(insert_details, batch)
            db.commit()
            batch.clear()
    except IntegrityError as e:
        print("⚠️ Batch insert failed due to an FK error. Falling back to row-by-row to locate offending rows…")
        db.rollback()
        for vals in batch:
            try:
                cur.execute(insert_details, vals)
            except IntegrityError as ee:
                print(f"  → FK error on detail row (jvId={vals[-1]}, accountId={vals[0]}, docNbr={vals[-2]}): {ee}")
            else:
                db.commit()

    print(f"✅ Inserted {total_details:,} journal voucher details (skipped {len(missing_rows):,}).")

    # ---------- Done ----------
    cur.close()
    db.close()
    print("🎉 Done.")

    print("\nRemember:")
    print(" - `jvNumber` must NOT be unique if duplicates exist in your source.")
    print(" - This script guarantees details reference the exact voucher `id` from CSV,")
    print("   provided those voucher IDs were imported successfully.")
    print("\nHelpful indexes (run once if not present):")
    print("  CREATE INDEX idx_jvd_account  ON journal_voucher_details (accountId);")
    print("  CREATE INDEX idx_jvd_jv       ON journal_voucher_details (journalVoucherId);")
    print("  CREATE INDEX idx_jv_date      ON journal_vouchers (date);")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
