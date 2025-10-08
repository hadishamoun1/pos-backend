#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Strip a leading thickness pattern "<number>[.<fraction>] ملم" and remove '*' from item names.

Examples:
  "10ملم برونز"             -> "برونز"
  "10.2ملم تريبلكس ابيض*"   -> "تريبلكس ابيض"
  "10ملم LOW-E N70 *"       -> "LOW-E N70"

Usage:
  # 0) No args: uses defaults (itameNamesCsv.csv -> items_cleaned.csv) in the script folder
  python strip_thickness.py

  # 1) Clean a whole CSV (expects a column named 'ItemName'):
  python strip_thickness.py items.csv            # writes items_cleaned.csv (next to input)
  python strip_thickness.py items.csv out.csv    # custom output path

  # 2) Test a single line:
  python strip_thickness.py --once "10ملم برونز"
"""

import csv
import re
import sys
from pathlib import Path

# --- Default paths (same folder as this script) ---
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT  = SCRIPT_DIR / "itameNamesCsv.csv"   # make sure this filename is correct on disk
DEFAULT_OUTPUT = SCRIPT_DIR / "items_cleaned.csv"

# Map Arabic-Indic digits to Western; also normalize Arabic decimal separator "٫" -> "."
_ARABIC_DIGITS = {ord(c): str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")}
_ARABIC_DEC_SEP = {ord("٫"): ".", ord("٬"): ""}  # decimal, thousands (strip thousands)

def normalize_digits(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return text.translate(_ARABIC_DIGITS).translate(_ARABIC_DEC_SEP)

# Remove a leading "<number>[.<fraction>] ملم" (with or without spaces), then trim
_THICKNESS_RE = re.compile(r"^\s*[\d]+(?:[.,]\d+)?\s*ملم\s*", flags=re.IGNORECASE)

def strip_thickness(s: str) -> str:
    if s is None:
        return ""
    s = normalize_digits(str(s))
    # remove all asterisks
    s = s.replace("*", " ")
    # drop leading thickness pattern
    s = _THICKNESS_RE.sub("", s)
    # collapse extra spaces and trim
    s = re.sub(r"\s+", " ", s).strip()
    return s

def clean_csv(in_path: Path, out_path: Path) -> None:
    with in_path.open("r", encoding="utf-8-sig", newline="") as f_in, \
         out_path.open("w", encoding="utf-8-sig", newline="") as f_out:  # write with BOM for Excel
        reader = csv.DictReader(f_in)
        if not reader.fieldnames:
            raise SystemExit("Input CSV has no header row.")
        fieldnames = list(reader.fieldnames)
        if "ItemName" not in fieldnames:
            # If "ItemName" not present, keep going but still create ItemNameClean from the first column
            print("WARNING: 'ItemName' column not found. Using first column for cleaning.")
            first_col = fieldnames[0]
        else:
            first_col = "ItemName"

        if "ItemNameClean" not in fieldnames:
            fieldnames.append("ItemNameClean")

        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        for row in reader:
            raw = row.get(first_col, "")
            row["ItemNameClean"] = strip_thickness(raw)
            writer.writerow(row)

    print(f"Done. Wrote: {out_path}")

def main():
    # Single-line test mode
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        sample = sys.argv[2] if len(sys.argv) > 2 else ""
        print(strip_thickness(sample))
        return

    # No args -> use defaults
    if len(sys.argv) == 1:
        in_path = DEFAULT_INPUT
        out_path = DEFAULT_OUTPUT
        if not in_path.exists():
            raise SystemExit(f"Default input file not found: {in_path}")
        clean_csv(in_path, out_path)
        return

    # Args provided: input (required), output (optional)
    in_path = Path(sys.argv[1])
    if not in_path.exists():
        raise SystemExit(f"Input file not found: {in_path}")
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else in_path.with_name(in_path.stem + "_cleaned.csv")
    clean_csv(in_path, out_path)

if __name__ == "__main__":
    main()
