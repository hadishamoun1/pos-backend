# decode_codes.py

import csv
from pathlib import Path

# ---------- Lookup tables (from your sheet) ----------
CATEGORY_NAMES = {
    "00": "Float",
    "02": "Translucent",
    "03": "Mirror",
    "01": "Reflective",
    "04": "Laminated",
    "05": "Extra Clear",
    "06": "Decorative",
    "07": "Figured Glass",
    "08": "Figured Acid",
}

CATEGORY_SUB_MAP = {
    "00": {"10": "Float", "11": "Float Jumbo", "12": "Float Small", "13": "Float Transition"},
    "02": {"10": "Wired", "20": "Nashiji", "30": "Acid Etched", "40": "Sand Blasted", "50": "Fire Rate"},
    "03": {"10": "Mirror Silver", "12": "Mirror Silver Small", "20": "Mirror Aluminum",
           "30": "Mirror Extra Clear", "40": "Mirror Antique"},
    "01": {"10": "Reflective", "15": "Reflective Titanium", "20": "Low E"},
    "04": {"10": "Laminated", "20": "Laminated Low E", "30": "Laminated Acoustic"},
    "05": {"10": "Extra Clear"},
    "06": {"10": "Painted Glass", "20": "Colored Glass"},
    "07": {"10": "Figured Normal"},
    "08": {"10": "Figured Acid", "30": "Figured Acid ديكور"},
}

COLOR_MAP = {
    "00": "Matt", "01": "Clear", "02": "Grey", "03": "Bronze", "04": "Green", "05": "Dark Green",
    "06": "Blue", "07": "Dark Blue", "08": "Blue-Green", "09": "Dark Grey", "10": "Opaque",
    "11": "Pink", "12": "Extra Clear", "13": "Amber", "14": "Silver", "15": "Gold",
    "16": "Violet", "17": "Other",
}

THICKNESS_MAP = {
    "020": 2.0, "027": 2.7, "030": 3.0, "040": 4.0, "050": 5.0, "055": 5.5, "060": 6.0,
    "080": 8.0, "082": 8.2, "100": 10.0, "102": 10.2, "120": 12.0, "122": 12.2,
    "150": 15.0, "162": 16.2, "190": 19.0,
}

def parse_code(code: str):
    r"""
    Format: C C S K K - T T T - s
            | | | \___ color ___/   thickness      subcategory second digit
            | | +-- subcategory first digit
            \ +---- category (2 digits)
    Example: 00101-055-4 -> category=00, color=01, subcategory=14, thickness=5.5
    """
    code = code.strip()
    parts = code.split("-")
    ok = len(parts) == 3 and len(parts[0]) == 5 and len(parts[1]) == 3 and len(parts[2]) == 1
    if not ok or not all(p.isdigit() for p in parts):
        return {"code": code, "error": "Invalid format"}

    b1, ttt, s2 = parts
    category = b1[:2]
    s1 = b1[2]
    color = b1[3:5]
    subcat = s1 + s2

    category_name = CATEGORY_NAMES.get(category, "Unknown")
    subcat_name = CATEGORY_SUB_MAP.get(category, {}).get(subcat, "Undefined for category")
    color_name = COLOR_MAP.get(color, "Unknown")
    thickness_mm = THICKNESS_MAP.get(ttt)
    if thickness_mm is None:
        try:
            thickness_mm = round(int(ttt) / 10.0, 1)  # fallback
        except ValueError:
            thickness_mm = None

    return {
        "code": code,
        "category_code": category, "category_name": category_name,
        "subcategory_code": subcat, "subcategory_name": subcat_name,
        "color_code": color, "color_name": color_name,
        "thickness_code": ttt, "thickness_mm": thickness_mm,
        "error": "",
    }

def read_codes_csv(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames and "code" in [h.strip().lower() for h in reader.fieldnames]:
            col = next(h for h in reader.fieldnames if h.strip().lower() == "code")
            return [row[col].strip() for row in reader if row.get(col)]
    # fallback: first column
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        rows = [r for r in reader if r]
    header_like = rows and not rows[0][0].strip().replace("-", "").isdigit()
    start = 1 if header_like else 0
    return [r[0].strip() for r in rows[start:] if r and r[0].strip()]

def write_decoded(records, path: Path):
    fieldnames = [
        "code",
        "category_code", "category_name",
        "subcategory_code", "subcategory_name",
        "color_code", "color_name",
        "thickness_code", "thickness_mm",
        "error",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(records)

def main():
    in_path = Path("codes.csv")
    out_path = Path("decoded_codes.csv")
    if not in_path.exists():
        print("Create 'codes.csv' with a 'code' column and run again.")
        return
    codes = read_codes_csv(in_path)
    results = [parse_code(c) for c in codes]
    write_decoded(results, out_path)
    print(f"Decoded {len(results)} codes -> {out_path.resolve()}")

if __name__ == "__main__":
    main()
