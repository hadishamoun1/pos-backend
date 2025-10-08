#!/usr/bin/env python3
# -*- coding: utf-8 -*-

r"""
Import Items + Thicknesses from CSV into MySQL.

CSV columns expected (case-insensitive): ItemName, ItemType, Thick, SalesItemName
- ItemName        -> item.itemName
- ItemType        -> item.type  ('box' | 'sheet' | 'sqm' | 'unit')
- Thick           -> thickness.thickness (DECIMAL(5,2))
- SalesItemName   -> ignored (you can map later to ItemNameDescription if needed)

Behavior:
- Find-or-create Item by (itemName, type).
- For each Item, find-or-create Thickness by (itemId, thickness).
- Uses table names 'item' and 'thickness', and FK column 'itemId'.

Usage:
  python migrate_items_thickness.py path/to/items.csv
  # If no arg is given, it will look for items.csv next to this script.
"""

import csv
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import mysql.connector
from pathlib import Path

# ============ CONFIG ============
DB_HOST = "localhost"
DB_PORT = 3306
DB_USER = "root"
DB_PASS = "70631859HADI"
DB_NAME = "new_schema2"

# Default CSV next to the script (can pass a path as argv[1])
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CSV = SCRIPT_DIR / "Hadi-Export-Items-Main.csv"

# Table/column names (adjust if your actual tables/columns differ)
TABLE_ITEM = "item"
TABLE_THICKNESS = "thickness"
COL_THICK_ITEM_FK = "itemId"
# ================================


# ---- helpers ----
_ARABIC_DIGITS = {ord(c): str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")}
_ARABIC_DEC_SEP = {ord("٫"): ".", ord("٬"): ""}

def normalize_digits(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return text.translate(_ARABIC_DIGITS).translate(_ARABIC_DEC_SEP)

def parse_decimal_2dp(x) -> Decimal | None:
    if x is None:
        return None
    s = str(x).strip()
    if not s:
        return None
    s = normalize_digits(s)
    s = s.replace(",", ".")  # support "10,2"
    try:
        d = Decimal(s)
        return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None

def normalize_type(t: str) -> str | None:
    """
    Map various CSV strings to our canonical enum values.
    Supports: box, sheet, sqm, unit (added).
    """
    if not t:
        return None
    k = re.sub(r"\s+", "", str(t).strip().lower())
    if k in ("box",):
        return "box"
    if k in ("sheet", "sheets"):
        return "sheet"
    if k in ("sqm", "m2", "sqmtr", "squaremeter", "squaremeters"):
        return "sqm"
    if k in ("unit", "units", "piece", "pieces", "pc", "pcs"):
        return "unit"  # <-- NEW
    return None

def open_db():
    return mysql.connector.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS,
        database=DB_NAME, charset="utf8mb4"
    )

def get_or_create_item(cur, cache, item_name: str, item_type: str) -> int:
    key = (item_name, item_type)
    if key in cache:
        return cache[key]

    # Try find
    cur.execute(
        f"SELECT id FROM {TABLE_ITEM} WHERE itemName = %s AND type = %s LIMIT 1",
        (item_name, item_type),
    )
    row = cur.fetchone()
    if row:
        item_id = int(row[0])
        cache[key] = item_id
        return item_id

    # Create
    cur.execute(
        f"INSERT INTO {TABLE_ITEM} (itemName, type) VALUES (%s, %s)",
        (item_name, item_type),
    )
    item_id = cur.lastrowid
    cache[key] = item_id
    return item_id

def thickness_exists(cur, tcache, item_id: int, thick: Decimal) -> bool:
    key = (item_id, str(thick))
    if key in tcache:
        return True
    cur.execute(
        f"SELECT id FROM {TABLE_THICKNESS} WHERE {COL_THICK_ITEM_FK} = %s AND thickness = %s LIMIT 1",
        (item_id, str(thick)),
    )
    row = cur.fetchone()
    if row:
        tcache[key] = True
        return True
    return False

def insert_thickness(cur, tcache, item_id: int, thick: Decimal) -> None:
    cur.execute(
        f"INSERT INTO {TABLE_THICKNESS} ({COL_THICK_ITEM_FK}, thickness) VALUES (%s, %s)",
        (item_id, str(thick)),
    )
    tcache[(item_id, str(thick))] = True


def read_rows(csv_path: Path):
    rows = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit("CSV has no header row.")
        # normalize headers to lower/strip for robust access
        hdr = { (h or "").strip().lower(): h for h in reader.fieldnames }
        get = lambda r, *names: next((r.get(hdr[n]) for n in names if n in hdr), None)

        for i, raw in enumerate(reader, start=2):  # header = line 1
            item_name = get(raw, "itemname")
            item_type_raw = get(raw, "itemtype")
            thick_raw = get(raw, "thick")

            if not item_name:
                print(f"[row {i}] SKIP: ItemName is empty")
                continue

            item_type = normalize_type(item_type_raw)
            if not item_type:
                print(f"[row {i}] SKIP: ItemType '{item_type_raw}' not recognized (use box/sheet/sqm/unit)")
                continue

            thick = parse_decimal_2dp(thick_raw)
            if thick is None:
                print(f"[row {i}] SKIP: Thick '{thick_raw}' invalid")
                continue

            rows.append((item_name.strip(), item_type, thick))
    return rows


def main():
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not csv_path.exists():
        raise SystemExit(f"Input CSV not found: {csv_path}")

    rows = read_rows(csv_path)
    if not rows:
        print("No valid rows to import.")
        return

    db = open_db()
    cur = db.cursor()

    items_cache: dict[tuple[str,str], int] = {}
    thick_cache: dict[tuple[int,str], bool] = {}

    inserted_items = 0
    inserted_thick = 0
    skipped_thick = 0

    try:
        for item_name, item_type, thick in rows:
            before = items_cache.get((item_name, item_type))
            item_id = get_or_create_item(cur, items_cache, item_name, item_type)
            if before is None and items_cache.get((item_name, item_type)) == item_id and item_id != before:
                inserted_items += 1 if before is None else 0

            if thickness_exists(cur, thick_cache, item_id, thick):
                skipped_thick += 1
            else:
                insert_thickness(cur, thick_cache, item_id, thick)
                inserted_thick += 1
        db.commit()
    except mysql.connector.Error as e:
        db.rollback()
        print("MySQL error:", e)
        raise
    finally:
        cur.close()
        db.close()

    print(f"Done. Items created: {inserted_items}, Thickness rows created: {inserted_thick}, Thickness skipped (exists): {skipped_thick}")

if __name__ == "__main__":
    main()
