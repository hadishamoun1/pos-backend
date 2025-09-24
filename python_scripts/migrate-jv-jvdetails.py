import csv
import sys
from decimal import Decimal, InvalidOperation
from datetime import datetime
import mysql.connector

# ===================== CONFIG =====================
DB = dict(
    host="localhost",
    user="root",
    password="70631859HADI",
    database="new_schema2",
)

JOURNAL_VOUCHERS_CSV = "jvlastc.csv"
JOURNAL_VOUCHER_DETAILS_CSV = "jvdetailslastc.csv"

# If your CSV is day/month/year (e.g. 1/2/2018 = 1 Feb), set this True.
PREFER_DMY = False
# ==================================================


def normalize_keys(d):
    """lowercase+strip keys; strip values; None for empty strings"""
    out = {}
    for k, v in d.items():
        nk = (k or "").strip().lower()
        if isinstance(v, str):
            v = v.strip()
            v = v if v != "" else None
        out[nk] = v
    return out


def pick(d, *keys):
    """first present key from d"""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def dec(x) -> Decimal:
    """safe decimal from csv cell"""
    if x is None:
        return Decimal("0")
    try:
        return Decimal(str(x).replace(",", "").strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def to_iso_date(s: str | None) -> str | None:
    """Parse a variety of common CSV date formats to YYYY-MM-DD for MySQL DATE."""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None

    # Build formats list with preference
    dmy = ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"]
    mdy = ["%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y"]
    ymd = ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"]

    date_formats = (dmy + mdy + ymd) if PREFER_DMY else (mdy + dmy + ymd)

    s_norm = (
        s.replace("\\", "/")
         .replace(".", "/")
         .replace("-", "/")
         .replace("  ", " ")
         .strip()
    )

    for fmt in date_formats:
        # Try raw, then normalized variant
        try:
            d = datetime.strptime(s, fmt).date()
            return d.isoformat()
        except ValueError:
            pass
        try:
            d = datetime.strptime(s_norm, fmt.replace("-", "/").replace(".", "/")).date()
            return d.isoformat()
        except ValueError:
            pass

    # If numeric Excel serials ever appear, you could add a handler here.
    raise ValueError(f"Unrecognized date format: {s!r}")


def main():
    # ---------- DB ----------
    db = mysql.connector.connect(**DB)
    cur = db.cursor()

    # ---------- Upserts ----------
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

    upsert_details = """
    INSERT INTO journal_voucher_details
      (accountId, description, dr, drUSD, drLL, drOFR, drUSDOFR, drLLOFR,
       cr, crUSD, crLL, crOFR, crUSDOFR, crLLOFR, currency, exRateEUROToUSD, exRateUSD, docNbr, journalVoucherId)
    VALUES
      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    # ---------- Load JOURNAL VOUCHERS ----------
    with open(JOURNAL_VOUCHERS_CSV, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        count = 0
        for raw in reader:
            r = normalize_keys(raw)

            rid = pick(r, "id")
            jv_number = pick(r, "jvnumber", "jv number", "jv no", "jv_no")
            # date conversion (THIS IS THE FIX)
            raw_date = pick(r, "date")
            try:
                iso_date = to_iso_date(raw_date)
            except ValueError as e:
                print(f"SKIP JV (bad date {raw_date!r}): {e}")
                continue

            vals = (
                int(rid) if (rid and str(rid).strip().isdigit()) else None,
                iso_date,
                jv_number,
                dec(pick(r, "totaldr")),
                dec(pick(r, "totaldrusd")),
                dec(pick(r, "totaldrll")),
                dec(pick(r, "totaldrofr")),
                dec(pick(r, "totaldrusdo fr", "totaldrusdofr", "totaldrusdo fr".replace(" ", ""))),
                dec(pick(r, "totaldrl lofr", "totald rllofr", "totaldrl lofr".replace(" ", ""), "totaldrl lofr", "totaldrl l ofr", "totaldrl lofr", "totaldrl      ofr", "totaldrllofr")),
                dec(pick(r, "totalcr")),
                dec(pick(r, "totalcrusd")),
                dec(pick(r, "totalcrll")),
                dec(pick(r, "totalcrofr")),
                dec(pick(r, "totalcrusdo fr", "totalcrusdofr", "totalcrusd ofr".replace(" ", ""))),
                dec(pick(r, "totalcrl lofr", "totalcrllofr")),
                pick(r, "jvtype"),
            )

            # The weird picks above try to be resilient to accidental spaces in header names.
            # If your headers are clean, feel free to simplify them to direct keys.

            cur.execute(upsert_vouchers, vals)
            count += 1

        db.commit()
        print(f"Upserted {count} journal vouchers.")

    # ---------- Load JOURNAL VOUCHER DETAILS ----------
    with open(JOURNAL_VOUCHER_DETAILS_CSV, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        batch = 0
        for raw in reader:
            r = normalize_keys(raw)

            vals = (
                # accountId (int or None)
                int(pick(r, "accountid")) if (pick(r, "accountid") and str(pick(r, "accountid")).strip().isdigit()) else None,
                pick(r, "description"),
                dec(pick(r, "dr")),
                dec(pick(r, "drusd")),
                dec(pick(r, "drll")),
                dec(pick(r, "drofr")),
                dec(pick(r, "drusdofr")),
                dec(pick(r, "drl lofr", "drl lofr".replace(" ", ""), "drllofr")),
                dec(pick(r, "cr")),
                dec(pick(r, "crusd")),
                dec(pick(r, "crll")),
                dec(pick(r, "crofr")),
                dec(pick(r, "crusdofr")),
                dec(pick(r, "crllofr")),
                pick(r, "currency"),
                dec(pick(r, "exrateeurotousd")),
                dec(pick(r, "exrateusd")),
                pick(r, "docnbr", "doc nbr", "doc_no", "docno"),
                int(pick(r, "journalvoucherid")) if (pick(r, "journalvoucherid") and str(pick(r, "journalvoucherid")).strip().isdigit()) else None,
            )

            cur.execute(upsert_details, vals)
            batch += 1
            if batch % 1000 == 0:
                db.commit()
        db.commit()
        print(f"Inserted {batch} journal voucher details.")

    cur.close()
    db.close()
    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
