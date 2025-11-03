import re
import argparse
import os
from typing import Tuple, List, Optional

# --- optional pandas import: used if available (for Excel or convenience) ---
try:
    import pandas as pd  # type: ignore
except Exception:
    pd = None  # script still works without pandas (CSV fallback below)

import csv

# =========================
# Parsing helpers (unchanged)
# =========================
THICKNESS_RE = re.compile(r'(\d+(?:\.\d+)?)\s*م?ل?م')  # matches 4ملم, 5.5ملم, 8 مم, etc.
ORIGIN_RE = re.compile(r'\(([^)]+)\)')
MULTISPACE_RE = re.compile(r'\s{2,}')

def extract_fields(text: str) -> Tuple[str, str, str, str]:
    if not isinstance(text, str):
        return "", "", "", ""

    # thickness
    tmatch = THICKNESS_RE.search(text)
    thickness = tmatch.group(1) if tmatch else ""

    # origin
    omatch = ORIGIN_RE.search(text)
    origin = omatch.group(1).strip() if omatch else ""

    # remove origin
    text_wo_origin = (text[:omatch.start()] + text[omatch.end():]) if omatch else text

    # remove thickness token
    if tmatch:
        s, e = tmatch.span()
        text_wo_both = (text_wo_origin[:s] + text_wo_origin[e:]).strip()
    else:
        text_wo_both = text_wo_origin.strip()

    # normalize spaces/punctuation
    text_wo_both = MULTISPACE_RE.sub(" ", text_wo_both).replace("  ", " ").strip()
    text_wo_both = text_wo_both.strip("-–—،.() ")

    item_name = text_wo_both
    item_with_thickness = f"{thickness}ملم {item_name}".strip() if thickness else item_name
    return thickness, item_name, origin, item_with_thickness

# =========================
# CSV/Excel reading (robust)
# =========================
def try_read_with_pandas(path: str, encoding: str) -> Optional["pd.DataFrame"]:
    if pd is None:
        return None

    ext = os.path.splitext(path.lower())[1]
    try:
        if ext in (".xlsx", ".xls"):
            # Excel support requires pandas
            return pd.read_excel(path, dtype=str)
        # 1) best-effort auto-delimiter
        return pd.read_csv(path, encoding=encoding, dtype=str, sep=None, engine="python")
    except Exception:
        # 2) common fallbacks
        for sep in [",", ";", "\t", "|"]:
            try:
                return pd.read_csv(path, encoding=encoding, dtype=str, sep=sep)
            except Exception:
                continue
    return None

def coerce_to_iname_df(df: "pd.DataFrame") -> "pd.DataFrame":
    cols_lower = [c.strip().lower() for c in df.columns]
    if "i_name" in cols_lower:
        # normalize exact column name to 'i_name'
        actual = df.columns[cols_lower.index("i_name")]
        if actual != "i_name":
            df = df.rename(columns={actual: "i_name"})
        return df[["i_name"]].copy()

    # If only one non-empty column, use it as i_name
    non_empty_cols = [c for c in df.columns if df[c].astype(str).str.strip().ne("").any()]
    if len(non_empty_cols) == 1:
        return df.rename(columns={non_empty_cols[0]: "i_name"})[["i_name"]].copy()

    # Otherwise join all columns into i_name
    df = df.fillna("")
    joined = df.apply(lambda r: " ".join([str(x).strip() for x in r.tolist() if str(x).strip() != ""]).strip(), axis=1)
    return pd.DataFrame({"i_name": joined})

def read_csv_fallback_without_pandas(path: str, encoding: str) -> List[str]:
    """
    Pure-csv fallback: try to read with sniffer; if that still yields multiple columns,
    join all columns into one i_name string.
    Returns a list of i_name strings.
    """
    # First try: use csv.Sniffer to detect delimiter
    with open(path, "r", encoding=encoding, newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample)
            reader = csv.reader(f, dialect)
        except Exception:
            # fallback to common delimiters
            f.seek(0)
            reader = csv.reader(f)

        rows = list(reader)

    if not rows:
        return []

    # If header has i_name use DictReader pass
    header = rows[0]
    header_lc = [h.strip().lower() for h in header]
    if "i_name" in header_lc:
        idx = header_lc.index("i_name")
        # collect that column; if row too short, treat as empty
        result = []
        for r in rows[1:]:
            val = r[idx] if idx < len(r) else ""
            # If there are extra columns, join them too (we don't want to lose text split by commas)
            if len(r) > 1:
                others = [x for j, x in enumerate(r) if j != idx and str(x).strip() != ""]
                if others:
                    val = " ".join([val] + others).strip()
            result.append(val)
        return result

    # No header or no i_name column: join all columns in each row
    result = []
    for r in rows:
        s = " ".join([str(x).strip() for x in r if str(x).strip() != ""]).strip()
        if s and s.lower() != "i_name":
            result.append(s)
    return result

def load_items_column(path: str, encoding_candidates: List[str]) -> List[str]:
    # Try several encodings (Excel on Windows Arabic often is cp1256)
    for enc in encoding_candidates:
        # Try pandas route (if available)
        pdf = try_read_with_pandas(path, enc)
        if pdf is not None:
            try:
                pdf = pdf.fillna("")
                pdf = coerce_to_iname_df(pdf)
                return pdf["i_name"].astype(str).tolist()
            except Exception:
                pass

        # Pure-csv fallback
        try:
            items = read_csv_fallback_without_pandas(path, enc)
            if items:
                return items
        except Exception:
            continue

    raise ValueError(
        "Could not read the input file. "
        "Tried encodings: " + ", ".join(encoding_candidates)
    )

# =========================
# Main processing
# =========================
def process_file(input_path: str, output_path: str, encoding: str = "utf-8-sig") -> None:
    # Try multiple encodings to be safe
    encoding_candidates = [encoding, "utf-8", "cp1256", "windows-1256"]
    items = load_items_column(input_path, encoding_candidates)

    # Build output rows
    out_rows = []
    for raw in items:
        thickness, item_name, origin, itemname_with_thickness = extract_fields(str(raw))
        out_rows.append({
            "i_name": raw,
            "thickness": thickness,
            "item_name": item_name,
            "origin": origin,
            "itemname_with_thickness": itemname_with_thickness,
        })

    # Write with pandas if available, else csv
    if pd is not None:
        df = pd.DataFrame(out_rows)
        df.to_csv(output_path, index=False, encoding="utf-8-sig")
    else:
        # pure csv
        fieldnames = ["i_name", "thickness", "item_name", "origin", "itemname_with_thickness"]
        with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(out_rows)

def main():
    ap = argparse.ArgumentParser(description="Parse Arabic glass item names into structured columns (robust CSV/Excel reader).")
    ap.add_argument("input_path", help="Path to input .csv or .xlsx. If CSV, should contain a column 'i_name' (or multiple columns will be joined).")
    ap.add_argument("output_csv", help="Path to output CSV file.")
    ap.add_argument("--encoding", default="utf-8-sig", help="Preferred file encoding to try first (default: utf-8-sig).")
    args = ap.parse_args()

    process_file(args.input_path, args.output_csv, encoding=args.encoding)

if __name__ == "__main__":
    main()
