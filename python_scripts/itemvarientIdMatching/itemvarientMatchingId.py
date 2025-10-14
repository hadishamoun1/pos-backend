#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
CSV -> CSV linker:
For every row R:
  - Find base row B where B.itemNumber == R.ItemNumberForVarients
  - Set R['itemdescription id'] = B.id
Writes a new file alongside the input: <name>_linked.csv
"""

import csv
import re
import sys
from pathlib import Path

# Default filename (your case)
DEFAULT_BASENAME = "Stock Item Codes - Item Description - Category - matching-varient-id"

SPACE_RE = re.compile(r"\s+")

# Normalize header names to detect columns even if they have spaces/typos/mixed case
def canon(h: str) -> str:
    if h is None:
        return ""
    s = SPACE_RE.sub("", h).strip().lower()
    s = s.replace("variants", "varients")        # treat both as same
    s = s.replace("decription", "description")   # handle common typo
    return s

def main():
    # Resolve input CSV
    if len(sys.argv) >= 2:
        in_path = Path(sys.argv[1]).expanduser()
    else:
        # try basename and basename.csv next to script
        here = Path(__file__).resolve().parent
        cand = [here / DEFAULT_BASENAME, here / f"{DEFAULT_BASENAME}.csv"]
        in_path = next((p for p in cand if p.exists()), None)
        if not in_path:
            print(f"❌ CSV not found. Pass a path or place '{DEFAULT_BASENAME}.csv' next to this script.")
            sys.exit(66)

    if not in_path.exists():
        print(f"❌ CSV not found: {in_path}")
        sys.exit(66)

    out_path = in_path.with_name(in_path.stem + "_linked.csv")

    # Read, normalize headers, and build mapping itemNumber -> id
    with in_path.open("r", encoding="utf-8-sig", newline="") as f_in:
        reader = csv.DictReader(f_in, skipinitialspace=True, restkey="__EXTRA__")

        if not reader.fieldnames:
            print("❌ CSV has no header row.")
            sys.exit(65)

        raw_headers = list(reader.fieldnames)
        # Map raw header -> canonical token
        header_map = {h: canon(h) for h in raw_headers}

        # Find the key columns (tolerant)
        def find_header(target):
            for raw, c in header_map.items():
                if c == target:
                    return raw
            return None

        col_id_raw   = find_header("id")
        col_item_raw = find_header("itemnumber")
        col_var_raw  = find_header("itemnumberforvarients")  # variants/varients unified above
        col_fk_raw   = (find_header("itemdescriptionid") or
                        find_header("itemdescription_id") or
                        find_header("itemdecriptionid") or
                        find_header("itemdecription_id"))

        missing = [name for name, raw in [
            ("id", col_id_raw),
            ("itemNumber", col_item_raw),
            ("ItemNumberForVarients", col_var_raw),
        ] if raw is None]

        if missing:
            print(f"❌ Required columns missing: {missing}")
            print(f"   Detected headers: {raw_headers}")
            sys.exit(65)

        # If FK column is missing, we'll create one named exactly 'itemdescription id'
        created_fk_header = False
        if col_fk_raw is None:
            col_fk_raw = "itemdescription id"
            created_fk_header = True

        # Build base map: itemNumber -> id (strings trimmed)
        def norm_val(v):
            if v is None:
                return ""
            s = str(v).replace("\t", " ").strip()
            s = SPACE_RE.sub(" ", s)
            return s.replace("\ufeff", "")

        base_map = {}
        rows = []
        for row in reader:
            # keep a copy for second pass
            rows.append(row)
            item_num = norm_val(row.get(col_item_raw, ""))
            rid      = norm_val(row.get(col_id_raw, ""))
            if item_num and rid:
                base_map[item_num] = rid

    # Prepare writer headers: keep original order, ensure FK column present once
    out_headers = list(raw_headers)
    if created_fk_header and col_fk_raw not in out_headers:
        out_headers.append(col_fk_raw)

    # Write output CSV with BOM for Excel friendliness
    with out_path.open("w", encoding="utf-8-sig", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=out_headers, extrasaction="ignore")
        writer.writeheader()

        linked = 0
        missing = 0
        for row in rows:
            # Clean up odd keys
            row.pop(None, None)
            row.pop("__EXTRA__", None)

            variant_key = norm_val(row.get(col_var_raw, ""))
            if variant_key:
                base_id = base_map.get(variant_key)
                if base_id:
                    row[col_fk_raw] = base_id
                    linked += 1
                else:
                    # no matching base itemNumber found
                    row[col_fk_raw] = row.get(col_fk_raw, "")  # keep as-is/blank
                    missing += 1
            # If there is no variant value, leave FK as-is (maybe it's a base row)

            writer.writerow(row)

    print(f"✅ Wrote: {out_path}")
    print(f"   Linked rows: {linked} | Missing base matches: {missing}")

if __name__ == "__main__":
    main()
