import csv
import sys
import mysql.connector

# --- CONFIG ---
CSV_FILE_PATH = "subaccounts.csv"
FORCE_INSERT_ORPHANS = True  # see notes below
# ---------------

def normalize_keys(d):
    """lowercase+strip keys; strip values; None for empty strings"""
    out = {}
    for k, v in d.items():
        nk = (k or "").strip().lower()
        nv = (v.strip() if isinstance(v, str) else v)
        out[nk] = (nv if nv != "" else None)
    return out

def pick(d, *keys):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None

def main():
    # DB connection
    db = mysql.connector.connect(
        host="localhost",
        user="root",
        password="70631859HADI",
        database="new_schema2",
    )
    cur = db.cursor()

    # Cache existing accounts for FK-friendly ordering
    cur.execute("SELECT accountNumber FROM accounts")
    existing_accounts = {row[0] for row in cur.fetchall()}

    # Read CSV
    rows = []
    with open(CSV_FILE_PATH, mode="r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            r = normalize_keys(raw)

            rid = pick(r, "id", "account id", "accountid")
            acc_number = pick(r, "account number", "accountnumber", "account_code", "code")
            acc_name = pick(r, "account name", "accountname", "name")
            parent_number = pick(r, "parent account number", "parentnumber", "parent_account_number","parentaccountnumber" )
            arabic_name = pick(r, "arabic account name", "arabicaccountname", "arabic_name")

            # NEW: currencyId (accept various headers)
            currency_id_raw = pick(r, "currencyid", "currency id", "currency_id", "currency")
            currency_id = None
            if currency_id_raw is not None and str(currency_id_raw).strip() != "":
                try:
                    currency_id = int(str(currency_id_raw).strip())
                except ValueError:
                    print(f"WARNING: invalid currency id '{currency_id_raw}' for account {acc_number}; storing NULL")

            # Required: id + accountNumber
            if rid is None:
                print(f"SKIP (missing id): {raw}")
                continue
            try:
                rid = int(rid)
            except ValueError:
                print(f"SKIP (invalid id): {raw}")
                continue
            if not acc_number:
                print(f"SKIP (missing account number): {raw}")
                continue

            # Allow empty account name: store empty string if missing/None
            if acc_name is None:
                acc_name = ""

            rows.append({
                "id": rid,
                "accountNumber": acc_number,
                "accountName": acc_name,
                "parentNumber": parent_number,
                "arabicAccountName": arabic_name,
                "currencyId": currency_id,  # NEW
            })

    if not rows:
        print("No rows to import.")
        cur.close()
        db.close()
        return

    csv_accounts = {r["accountNumber"] for r in rows}

    # Include currencyId in the upsert
    upsert_sql = """
    INSERT INTO accounts (id, accountNumber, accountName, parentNumber, arabicAccountName, currencyId)
    VALUES (%s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
      -- keep id as in CSV (only meaningful if the duplicate key is on accountNumber)
      id = VALUES(id),
      accountNumber = VALUES(accountNumber),
      accountName = VALUES(accountName),
      parentNumber = VALUES(parentNumber),
      arabicAccountName = VALUES(arabicAccountName),
      currencyId = VALUES(currencyId)
    """

    # Insert parents first, then children
    pending = rows[:]
    inserted_now = set()
    passes = 0
    max_passes = len(pending) + 5

    while pending and passes < max_passes:
        passes += 1
        next_pending = []
        progress = False

        for r in pending:
            parent = r["parentNumber"]
            parent_ready = (
                not parent
                or parent in inserted_now
                or parent in existing_accounts
                or parent not in csv_accounts
            )

            if parent_ready:
                try:
                    cur.execute(
                        upsert_sql,
                        (
                            r["id"],
                            r["accountNumber"],
                            r["accountName"],
                            r["parentNumber"],
                            r["arabicAccountName"],
                            r["currencyId"],  # NEW
                        ),
                    )
                    inserted_now.add(r["accountNumber"])
                    progress = True
                except mysql.connector.Error as e:
                    if e.errno == 1452:  # FK fails (parentNumber or currencyId FK)
                        next_pending.append(r)
                    else:
                        print(f"FAILED (MySQL) {r}: {e}")
                except Exception as e:
                    print(f"FAILED (Unexpected) {r}: {e}")
            else:
                next_pending.append(r)

        if progress:
            db.commit()
            existing_accounts.update(inserted_now)
            inserted_now.clear()

        if not progress:
            break
        pending = next_pending

    if pending:
        print(f"{len(pending)} rows still pending due to missing/invalid parents or currencyId.")
        if FORCE_INSERT_ORPHANS:
            print("FORCING insert by disabling foreign key checks for remaining rows...")
            try:
                cur.execute("SET FOREIGN_KEY_CHECKS=0")
                for r in pending:
                    try:
                        cur.execute(
                            upsert_sql,
                            (
                                r["id"],
                                r["accountNumber"],
                                r["accountName"],
                                r["parentNumber"],
                                r["arabicAccountName"],
                                r["currencyId"],
                            ),
                        )
                    except Exception as e:
                        print(f"FAILED (forced) {r}: {e}")
                db.commit()
            finally:
                cur.execute("SET FOREIGN_KEY_CHECKS=1")
                db.commit()
        else:
            print("Left pending (not inserted):")
            for r in pending:
                print(r)

    print("Done.")
    cur.close()
    db.close()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
