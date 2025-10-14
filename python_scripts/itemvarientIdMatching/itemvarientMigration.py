#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
CSV -> DB (MySQL) loader for ItemVariant with thicknessId lookup using (ItemName + inferred type + thickness).

For every CSV row:
  - Infer type from CSV:
      sheetsPerBox > 0        -> "box"
      else if length & width  -> "sheet"
      else                    -> "sqm"
  - Find item.id where item.itemName == CSV.ItemName AND item.type == inferredType
  - Find thickness.id where thickness.thickness == CSV.thickness AND thickness.itemId == item.id
  - Fill CSV.thicknessId with that id (if found)
  - Write corrected CSV "<name>_with_thicknessId.csv"
  - Insert/UPSERT into `item_variant` (selected columns) unless --dry-run

CSV columns expected (names are normalized, spaces/underscores ignored):
  id, length, width, sheetsPerBox, origin, itemNameDescriptionId, thicknessId, thickness, ItemName

Usage:
  python itemvarientMigration.py                     # uses DEFAULT_CSV path below
  python itemvarientMigration.py <variants.csv>
  python itemvarientMigration.py <variants.csv> --dry-run

Env vars for DB:
  DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
"""

import os
import re
import sys
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path
import mysql.connector

ITEM_TABLE       = "item"
THICKNESS_TABLE  = "thickness"
ITEMVAR_TABLE    = "item_variant"

SPACE_RE = re.compile(r"\s+")

# 👇 Default CSV (change if needed)
DEFAULT_CSV = Path(__file__).with_name("Hadi-Export-Items-VariantWithThicknessFinal.csv")


def canon(s: str) -> str:
    """normalize header/column names for matching (remove spaces/underscore/case)."""
    if s is None:
        return ""
    s2 = s.strip().lower()
    s2 = s2.replace("_", "")
    s2 = SPACE_RE.sub("", s2)
    return s2


def to_decimal_or_none(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    s = s.replace(",", "")
    try:
        if re.fullmatch(r"\d+", s):
            return Decimal(int(s))
        return Decimal(s)
    except InvalidOperation:
        return None


def to_int_or_zero(v):
    if v is None:
        return 0
    s = str(v).strip()
    if s == "":
        return 0
    try:
        return int(Decimal(s))
    except Exception:
        return 0


def norm_text(v):
    if v is None:
        return ""
    return SPACE_RE.sub(" ", str(v).replace("\t", " ")).strip()


def has_number(v) -> bool:
    """True if value parses to a Decimal > 0."""
    d = to_decimal_or_none(v)
    return d is not None and d > 0


def has_any(v) -> bool:
    """True if non-empty string after trim (for presence checks)."""
    if v is None:
        return False
    return norm_text(v) != ""


def infer_type_from_row(length, width, sheets_per_box) -> str:
    """
    Rules:
      - if sheetsPerBox > 0 => 'box'
      - else if length and width present (non-empty) => 'sheet'
      - else => 'sqm'
    """
    if has_number(sheets_per_box):
        return "box"
    if has_any(length) and has_any(width):
        return "sheet"
    return "sqm"


def load_items_map(cur):
    """
    Build map: (itemName_norm, type_norm) -> item.id
    Detects actual column names in `item` table for id, itemName, type.
    """
    cur.execute(f"SHOW COLUMNS FROM `{ITEM_TABLE}`")
    item_cols = [r[0] for r in cur.fetchall()]
    item_id_col = item_name_col = item_type_col = None
    for c in item_cols:
        cc = canon(c)
        if cc == "id":
            item_id_col = c
        elif cc == "itemname":
            item_name_col = c
        elif cc == "type":
            item_type_col = c
    if not item_id_col or not item_name_col or not item_type_col:
        raise SystemExit(f"❌ Could not detect id/itemName/type columns in `{ITEM_TABLE}`. Found: {item_cols}")

    cur.execute(f"SELECT `{item_id_col}`, `{item_name_col}`, `{item_type_col}` FROM `{ITEM_TABLE}`")
    mapping = {}
    for iid, nm, ty in cur.fetchall():
        key = (norm_text(nm), norm_text(ty).lower())
        if key and key not in mapping:
            mapping[key] = iid
    return mapping


def detect_thickness_cols(cur):
    """
    Detect column names in `thickness` table for: id, thickness (numeric), itemId (FK).
    """
    cur.execute(f"SHOW COLUMNS FROM `{THICKNESS_TABLE}`")
    cols = [r[0] for r in cur.fetchall()]
    t_id = t_val = t_item = None
    for c in cols:
        cc = canon(c)
        if cc == "id":
            t_id = c
        elif cc == "thickness":
            t_val = c
        elif cc in ("itemid", "item_id"):
            t_item = c
    if not (t_id and t_val and t_item):
        raise SystemExit(
            f"❌ Could not detect needed columns in `{THICKNESS_TABLE}` (need id, thickness, itemId). Found: {cols}"
        )
    return t_id, t_val, t_item


def load_thickness_map_with_item(cur):
    """
    Build map keyed by (itemId:int, thickness:Decimal) -> thickness.id
    """
    t_id, t_val, t_item = detect_thickness_cols(cur)
    cur.execute(f"SELECT `{t_id}`, `{t_val}`, `{t_item}` FROM `{THICKNESS_TABLE}`")
    mapping = {}
    for tid, thickness_v, item_id in cur.fetchall():
        d = to_decimal_or_none(thickness_v)
        if d is None or item_id is None:
            continue
        key = (int(item_id), d)
        if key not in mapping:
            mapping[key] = int(tid)
    return mapping


def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    # Use DEFAULT_CSV when no path is provided
    if args:
        in_path = Path(args[0]).expanduser().resolve()
    else:
        in_path = DEFAULT_CSV.resolve()

    if not in_path.exists():
        print(f"❌ CSV not found: {in_path}")
        sys.exit(66)

    out_path = in_path.with_name(in_path.stem + "_with_thicknessId.csv")

    # --- DB connect ---
    DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
    DB_PORT = int(os.getenv("DB_PORT", "3306"))
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASS = os.getenv("DB_PASS", "70631859HADI")
    DB_NAME = os.getenv("DB_NAME", "new_schema2")

    try:
        conn = mysql.connector.connect(
            host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS, database=DB_NAME
        )
        cur = conn.cursor()
    except mysql.connector.Error as e:
        print(f"❌ MySQL connection failed: {e}")
        sys.exit(1)

    try:
        # 1) Load (itemName, type) -> itemId
        item_map = load_items_map(cur)
        if not item_map:
            print("⚠️  No rows found in `item` table. ItemName/type matching will fail.")

        # 2) Load (itemId, thicknessDecimal) -> thicknessId
        thick_map = load_thickness_map_with_item(cur)
        if not thick_map:
            print("⚠️  No rows found in `thickness` table. thicknessId lookups will fail.")

        # 3) Read CSV; detect columns
        with in_path.open("r", encoding="utf-8-sig", newline="") as f_in:
            reader = csv.DictReader(f_in, skipinitialspace=True, restkey="__EXTRA__")
            if not reader.fieldnames:
                print("❌ CSV has no header row.")
                sys.exit(65)

            headers_raw = list(reader.fieldnames)
            cmap = {h: canon(h) for h in headers_raw}

            # locate columns (tolerant to spacing/underscores)
            def find(colname):
                for raw, c in cmap.items():
                    if c == colname:
                        return raw
                return None

            col_id    = find("id")
            col_len   = find("length")
            col_wid   = find("width")
            col_spb   = find("sheetsperbox")
            col_org   = find("origin")
            col_desc  = find("itemnamedescriptionid")  # itemNameDescriptionId
            col_tid   = find("thicknessid")
            col_th    = find("thickness")
            col_iname = find("itemname")               # CSV ItemName

            required = [
                ("id", col_id),
                ("length", col_len),
                ("width", col_wid),
                ("sheetsPerBox", col_spb),
                ("origin", col_org),
                ("itemNameDescriptionId", col_desc),
                ("thickness", col_th),
                ("ItemName", col_iname),
            ]
            missing_req = [n for n, raw in required if raw is None]
            if missing_req:
                print(f"❌ Required columns missing in CSV header: {missing_req}")
                print(f"   Detected: {headers_raw}")
                sys.exit(65)
            if col_tid is None:
                # if not present, we will add it on output and insert
                col_tid = "thicknessId"
                headers_raw.append(col_tid)

            # 4) Process rows
            fixed_rows = []
            to_insert  = []

            filled = 0
            missing_item = 0
            missing_thickness = 0

            for row in reader:
                rid   = to_int_or_zero(row.get(col_id))
                leng  = row.get(col_len)
                wid   = row.get(col_wid)
                spb_v = row.get(col_spb)
                org   = norm_text(row.get(col_org))
                desc  = to_int_or_zero(row.get(col_desc))
                iname = norm_text(row.get(col_iname))
                thval = to_decimal_or_none(row.get(col_th))

                # For DB insert, we also want numeric strings
                leng_dec = to_decimal_or_none(leng) or Decimal(0)
                wid_dec  = to_decimal_or_none(wid)  or Decimal(0)
                spb_int  = to_int_or_zero(spb_v)

                # infer type from this row
                inferred_type = infer_type_from_row(leng, wid, spb_v)

                # If thicknessId missing/zero -> compute via (ItemName, inferred_type, thickness)
                tid_val = row.get(col_tid, "")
                tid = to_int_or_zero(tid_val) if str(tid_val).strip() != "" else 0

                if tid == 0:
                    item_id = item_map.get((iname, inferred_type))
                    if item_id is None:
                        # Can't match item (name+type)
                        missing_item += 1
                        row[col_tid] = ""  # keep blank in CSV
                    else:
                        key = (int(item_id), thval) if thval is not None else None
                        if key and key in thick_map:
                            tid = int(thick_map[key])
                            row[col_tid] = str(tid)
                            filled += 1
                        else:
                            # didn't find thickness for that item
                            row[col_tid] = ""
                            missing_thickness += 1

                fixed_rows.append(row)

                # Prepare DB row for upsert
                to_insert.append((
                    rid if rid != 0 else None,     # id (Optional)
                    tid if tid != 0 else None,     # thicknessId
                    str(leng_dec),                 # length
                    str(wid_dec),                  # width
                    spb_int,                       # sheetsPerBox
                    org,                           # origin
                    desc if desc != 0 else None    # itemNameDescriptionId
                ))

        # 5) Write corrected CSV
        with out_path.open("w", encoding="utf-8-sig", newline="") as f_out:
            writer = csv.DictWriter(f_out, fieldnames=headers_raw, extrasaction="ignore")
            writer.writeheader()
            for r in fixed_rows:
                r.pop(None, None)
                r.pop("__EXTRA__", None)
                writer.writerow(r)

        print(f"✅ Wrote corrected CSV: {out_path}")
        print(f"   thicknessId filled: {filled} | missing item(name+type): {missing_item} | missing (item+thickness) match: {missing_thickness}")

        if dry_run:
            print("💡 Dry run: skipped DB insert.")
            return

        # 6) Insert / upsert into item_variant
        insert_sql = f"""
        INSERT INTO `{ITEMVAR_TABLE}`
          (`id`, `thicknessId`, `length`, `width`, `sheetsPerBox`, `origin`, `itemNameDescriptionId`)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          `thicknessId`=VALUES(`thicknessId`),
          `length`=VALUES(`length`),
          `width`=VALUES(`width`),
          `sheetsPerBox`=VALUES(`sheetsPerBox`),
          `origin`=VALUES(`origin`),
          `itemNameDescriptionId`=VALUES(`itemNameDescriptionId`);
        """

        prepared = []
        skipped = 0
        for row in to_insert:
            _id, _tid, _len, _wid, _spb, _org, _desc = row
            if _org == "":
                skipped += 1
                continue
            prepared.append(row)

        if not prepared:
            print("⚠️ Nothing to insert. (All rows skipped due to missing mandatory fields.)")
            return

        cur.executemany(insert_sql, prepared)
        conn.commit()
        print(f"🚀 Insert/Upsert completed. Rows affected: {cur.rowcount} (prepared: {len(prepared)}, skipped: {skipped})")

    except mysql.connector.Error as e:
        conn.rollback()
        print(f"❌ DB error: {e}")
        sys.exit(2)
    finally:
        try:
            cur.close()
        except Exception:
            pass
        conn.close()


if __name__ == "__main__":
    main()
