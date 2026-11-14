// Shared item search for the "Item Sales History" (POS) and "Item Purchase
// History" (Purchase Invoice) pages — both accept the same typed search:
// thickness ("8 ملم"), dimensions ("225*321") and item name tokens.
import { SelectQueryBuilder } from 'typeorm';

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
  '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
};

export const normalizeDigitsAll = (input: string) =>
  String(input || '').replace(/[٠-٩۰-۹]/g, d => ARABIC_INDIC_MAP[d] ?? d);

export const normalizeArabicAlef = (s: string) =>
  String(s || '').replace(/أ|إ|آ/g, 'ا');

export const parseItemQuery = (qRaw: string): {
  thickness?: number;
  length?: number;
  width?: number;
  nameTokens?: string[];
} => {
  if (!qRaw) return {};
  let working = normalizeDigitsAll(qRaw).trim().replace(/\s+/g, ' ');

  const thMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:ملم|مم|م)(?=$|\s|[-\/xX×*])/);
  let thickness: number | undefined;
  if (thMatch) {
    const th = Number((thMatch[1] || '').replace(',', '.'));
    if (Number.isFinite(th)) thickness = th;
    working = working.replace(thMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  const dimRe = /(\d{2,5})\s*[xX×*]\s*(\d{2,5})/;
  const dimMatch = working.match(dimRe);
  let lengthN: number | undefined;
  let widthN: number | undefined;
  if (dimMatch) {
    lengthN = Number(dimMatch[1]);
    widthN = Number(dimMatch[2]);
    working = working.replace(dimMatch[0], ' ').replace(/\s+/g, ' ').trim();
  }

  let nameTokens: string[] | undefined;
  if (working) {
    const tokens = working.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2);
    if (tokens.length) nameTokens = tokens;
  }

  return { thickness, length: lengthN, width: widthN, nameTokens };
};

// Applies the parsed search and the lone-length filter to a query that has
// the variant joined as `v`, its thickness as `t` and the item as `i`.
export const applyItemHistoryFilters = (
  qb: SelectQueryBuilder<any>,
  q?: string,
  length?: number,
) => {
  if (q) {
    const parsed = parseItemQuery(q);
    if (Number.isFinite(parsed.thickness)) {
      qb.andWhere('ROUND(t.thickness, 1) = ROUND(:pth, 1)', { pth: Number(parsed.thickness) });
    }
    if (Number.isFinite(parsed.length)) qb.andWhere('v.length = :plen', { plen: Number(parsed.length) });
    if (Number.isFinite(parsed.width)) qb.andWhere('v.width = :pwid', { pwid: Number(parsed.width) });
    if (parsed.nameTokens?.length) {
      parsed.nameTokens.forEach((tok, idx) => {
        const tokenNorm = `%${normalizeArabicAlef(tok)}%`;
        const tokenRaw = `%${tok}%`;
        qb.andWhere(
          `(
            REPLACE(REPLACE(REPLACE(i.itemName,'أ','ا'),'إ','ا'),'آ','ا') LIKE :tokN${idx}
            OR i.itemName LIKE :tokR${idx}
          )`,
          { [`tokN${idx}`]: tokenNorm, [`tokR${idx}`]: tokenRaw },
        );
      });
    }
  }

  // Matches the "single bare number" case from the POS Stock tab search
  // (e.g. typing just "225" without a *width pairs it against variant length).
  if (Number.isFinite(length)) {
    qb.andWhere('v.length = :plen2', { plen2: Number(length) });
  }
};
