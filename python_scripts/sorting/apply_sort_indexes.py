#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import csv
import os
import sys
from decimal import Decimal, InvalidOperation

import pymysql

# ------------ Defaults (as requested) ------------
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "70631859HADI")
DB_NAME = os.getenv("DB_NAME", "new_schema2")
# ------------------------------------------------

ITEM_TABLE = "item"
THICKNESS_TABLE = "thickness"
ITEM_NAME_COL = "itemName"          # column in item table
THICKNESS_VALUE_COL = "thickness"   # column in thickness table
ITEM_SORT_COL = "sortIndex"         # new/target column
THICKNESS_SORT_COL = "sort_index"    # new/target column


def to_number(x):
    if x is None:
        return None
    if isinstance(x, (int, float, Decimal)):
        return float(x)
    s = str(x).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return None


def ensure_sort_columns(conn):
    """
    Ensure ITEM_TABLE and THICKNESS_TABLE each have a sortIndex INT column.
    """
    with conn.cursor() as cur:
        # item.sortIndex
        cur.execute("""
            SELECT COUNT(*) 
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s
        """, (DB_NAME, ITEM_TABLE, ITEM_SORT_COL))
        exists_item = cur.fetchone()[0] > 0

        if not exists_item:
            print(f"[DDL] Adding {ITEM_SORT_COL} to {ITEM_TABLE}…")
            cur.execute(f"ALTER TABLE `{ITEM_TABLE}` ADD COLUMN `{ITEM_SORT_COL}` INT NULL DEFAULT NULL")
        else:
            print(f"[DDL] {ITEM_TABLE}.{ITEM_SORT_COL} already exists")

        # thickness.sortIndex
        cur.execute("""
            SELECT COUNT(*) 
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s
        """, (DB_NAME, THICKNESS_TABLE, THICKNESS_SORT_COL))
        exists_th = cur.fetchone()[0] > 0

        if not exists_th:
            print(f"[DDL] Adding {THICKNESS_SORT_COL} to {THICKNESS_TABLE}…")
            cur.execute(f"ALTER TABLE `{THICKNESS_TABLE}` ADD COLUMN `{THICKNESS_SORT_COL}` INT NULL DEFAULT NULL")
        else:
            print(f"[DDL] {THICKNESS_TABLE}.{THICKNESS_SORT_COL} already exists")


def load_csv(path):
    """
    Expect columns: item_name_sort_index,name,thickness,thickness_sort_index
    - name: the item name (without thickness)
    - thickness: numeric (can be empty for rows that only set item sort)
    """
    item_sort = {}                 # name -> item sort index (int)
    thickness_sort = {}            # (name, thickness) -> thickness sort index (int)

    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        required = {"item_name_sort_index", "name", "thickness", "thickness_sort_index"}
        missing = required - set([c.strip() for c in reader.fieldnames or []])
        if missing:
            print(f"[ERR] CSV is missing required columns: {', '.join(missing)}", file=sys.stderr)
            sys.exit(1)

        for row in reader:
            name = (row.get("name") or "").strip()
            if not name:
                continue

            # item sort
            ins = row.get("item_name_sort_index")
            ins_num = to_number(ins)
            if ins_num is not None:
                # if duplicate names appear, keep the first or the smallest
                if name not in item_sort or int(ins_num) < item_sort[name]:
                    item_sort[name] = int(ins_num)

            # thickness sort
            ths = row.get("thickness")
            ths_num = to_number(ths)  # None if empty
            ts = row.get("thickness_sort_index")
            ts_num = to_number(ts)

            if ths_num is not None and ts_num is not None:
                key = (name, float(ths_num))
                if key not in thickness_sort or int(ts_num) < thickness_sort[key]:
                    thickness_sort[key] = int(ts_num)

    return item_sort, thickness_sort


def update_item_sort(conn, item_sort, dry_run=False):
    """
    UPDATE item.sortIndex WHERE itemName = :name
    """
    updated = 0
    with conn.cursor() as cur:
        for name, idx in item_sort.items():
            if dry_run:
                print(f"[DRY] UPDATE `{ITEM_TABLE}` SET {ITEM_SORT_COL}={idx} WHERE {ITEM_NAME_COL}='{name}'")
                updated += 1
                continue
            cur.execute(
                f"UPDATE `{ITEM_TABLE}` SET `{ITEM_SORT_COL}`=%s WHERE `{ITEM_NAME_COL}`=%s",
                (idx, name),
            )
            updated += cur.rowcount
    return updated


def update_thickness_sort(conn, thickness_sort, dry_run=False):
    """
    UPDATE thickness.sortIndex by joining item to match the correct parent name, and matching on thickness value.
    """
    updated = 0
    with conn.cursor() as cur:
        for (name, thickness_value), idx in thickness_sort.items():
            if dry_run:
                print(f"[DRY] UPDATE `{THICKNESS_TABLE}` t "
                      f"JOIN `{ITEM_TABLE}` i ON i.id=t.itemId "
                      f"SET t.`{THICKNESS_SORT_COL}`={idx} "
                      f"WHERE i.`{ITEM_NAME_COL}`='{name}' "
                      f"AND ABS(t.`{THICKNESS_VALUE_COL}` - {thickness_value}) < 0.0001")
                updated += 1
                continue

            # Parameterized (thickness compare with small epsilon)
            cur.execute(
                f"""
                UPDATE `{THICKNESS_TABLE}` t
                JOIN `{ITEM_TABLE}` i ON i.id = t.itemId
                SET t.`{THICKNESS_SORT_COL}` = %s
                WHERE i.`{ITEM_NAME_COL}` = %s
                  AND ABS(t.`{THICKNESS_VALUE_COL}` - %s) < 0.0001
                """,
                (idx, name, thickness_value),
            )
            updated += cur.rowcount
    return updated


def main():
    parser = argparse.ArgumentParser(description="Apply sort indexes to item and thickness tables.")
    parser.add_argument("--host", default=DB_HOST, help="DB host")
    parser.add_argument("--port", default=DB_PORT, type=int, help="DB port")
    parser.add_argument("--user", default=DB_USER, help="DB user")
    parser.add_argument("--password", default=DB_PASS, help="DB password")
    parser.add_argument("--database", default=DB_NAME, help="DB name")
    parser.add_argument("--file", required=True, help="CSV file with sort indexes")
    parser.add_argument("--dry-run", action="store_true", help="Print queries without updating")
    args = parser.parse_args()

    # Connect
    conn = pymysql.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.Cursor,
    )

    try:
        ensure_sort_columns(conn)

        # Load CSV
        item_sort, thickness_sort = load_csv(args.file)
        print(f"[CSV] Loaded {len(item_sort)} item names & {len(thickness_sort)} (name,thickness) rows.")

        # Apply updates
        it_upd = update_item_sort(conn, item_sort, dry_run=args.dry_run)
        th_upd = update_thickness_sort(conn, thickness_sort, dry_run=args.dry_run)

        print(f"[OK] Items updated: {it_upd}")
        print(f"[OK] Thickness rows updated: {th_upd}")

        if args.dry_run:
            conn.rollback()
            print("[DRY] Rolled back (no changes committed).")
        else:
            conn.commit()
            print("[COMMIT] Changes committed.")
    except Exception as e:
        conn.rollback()
        print(f"[ERR] {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
