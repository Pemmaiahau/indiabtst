import type { LiveQuote } from "./client";
import type { ChainRow } from "./options";

// Column-name aliases, so exports from different sites work without editing.
const ALIASES: Record<keyof LiveQuote | "sym", string[]> = {
  sym: ["symbol", "ticker", "sym", "code", "scrip", "name"],
  c: ["last", "ltp", "last price", "last traded price", "price", "close", "latest"],
  o: ["open", "priceopen", "open price"],
  h: ["high", "day high", "high price"],
  l: ["low", "day low", "low price"],
  v: ["volume", "vol", "volume (shares)", "traded volume", "day volume"],
};

const INDEX_ALIASES: Record<string, string> = {
  NIFTY: "NIFTY",
  NIFTY_50: "NIFTY",
  NIFTY50: "NIFTY",
  NSEI: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  NIFTY_BANK: "BANKNIFTY",
  NIFTYBANK: "BANKNIFTY",
  NSEBANK: "BANKNIFTY",
  INDIAVIX: "INDIAVIX",
  INDIA_VIX: "INDIAVIX",
};

export function parseRows(text: string): string[][] {
  const delim = text.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const endCell = () => {
    row.push(cur);
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endCell();
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  endCell();
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function toNum(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  let t = s.replace(/[₹$,%\s]/g, "");
  if (!t || /^(n\/?a|#n\/a|-|–|null)$/i.test(t)) return undefined;
  let mult = 1;
  const suffix = t.slice(-1).toUpperCase();
  if ("KMB".includes(suffix)) {
    mult = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : 1e9;
    t = t.slice(0, -1);
  }
  const n = Number(t) * mult;
  return Number.isFinite(n) ? n : undefined;
}

/** "NSE:RELIANCE" -> RELIANCE, "INDEXNSE:NIFTY_50" -> NIFTY, "RELIANCE.NS" -> RELIANCE, "^NSEI" -> NIFTY */
export function normSym(s: string): string {
  const t = s.trim().toUpperCase().replace(/^[A-Z]+:/, "").replace(/^\^/, "").replace(/\.(NS|BO)$/, "").replace(/-EQ$/, "");
  const key = t.replace(/[\s-]+/g, "_");
  return INDEX_ALIASES[key] ?? INDEX_ALIASES[key.replace(/_/g, "")] ?? t;
}

export type ParseResult = { quotes: Record<string, LiveQuote>; columns: string[]; missing: string[]; rows: number; skipped: number; error?: string };

export function parseQuotes(text: string): ParseResult {
  const rows = parseRows(text.replace(/^﻿/, ""));
  const empty: ParseResult = { quotes: {}, columns: [], missing: [], rows: 0, skipped: 0 };
  if (rows.length < 2) return { ...empty, error: "The file has no data rows." };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[_*]+/g, " ").replace(/\s+/g, " "));
  const col: Partial<Record<keyof typeof ALIASES, number>> = {};
  for (const key of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    for (const alias of ALIASES[key]) {
      const i = header.indexOf(alias);
      if (i >= 0) {
        col[key] = i;
        break;
      }
    }
  }
  if (col.sym == null || col.c == null) {
    return { ...empty, error: `Could not find a ${col.sym == null ? "Symbol" : "Last/LTP/Price"} column. Columns seen: ${rows[0].join(", ")}` };
  }
  const quotes: Record<string, LiveQuote> = {};
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const sym = normSym(r[col.sym] ?? "");
    const c = toNum(r[col.c]);
    if (!sym || c == null || c <= 0) {
      skipped++;
      continue;
    }
    const q: LiveQuote = { c };
    for (const k of ["o", "h", "l", "v"] as const) {
      const v = col[k] != null ? toNum(r[col[k]!]) : undefined;
      if (v != null && v > 0) q[k] = v;
    }
    // guard against junk rows where high/low do not bracket the price
    if (q.h != null && q.l != null && (q.h < q.l || c > q.h * 1.001 || c < q.l * 0.999)) {
      delete q.h;
      delete q.l;
    }
    quotes[sym] = q;
  }
  const names = { o: "Open", h: "High", l: "Low", v: "Volume" } as const;
  return {
    quotes,
    columns: (Object.keys(col) as (keyof typeof ALIASES)[]).map((k) => rows[0][col[k]!].trim()),
    missing: (["o", "h", "l", "v"] as const).filter((k) => col[k] == null).map((k) => names[k]),
    rows: Object.keys(quotes).length,
    skipped,
  };
}

/**
 * Option-chain CSV as downloaded from the NSE website's option-chain page: one row per strike,
 * call columns to the left of a STRIKE column and put columns to the right, each side having
 * "OI" and "CHNG IN OI". Also accepts a simple file with columns Strike, Call OI, Call Chg OI, Put OI, Put Chg OI.
 */
export function parseOptionChain(text: string): { rows: ChainRow[]; error?: string } {
  const rows = parseRows(text.replace(/^﻿/, ""));
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const hi = rows.findIndex((r) => r.some((c) => /^strike( price)?$/.test(norm(c))));
  if (hi < 0) return { rows: [], error: "Could not find a STRIKE column. Use the CSV from the NSE option-chain page or the simple template." };
  const h = rows[hi].map(norm);
  const strikeCol = h.findIndex((c) => /^strike( price)?$/.test(c));
  let cOi: number, cChg: number, pOi: number, pChg: number;
  const named = (re: RegExp) => h.findIndex((c) => re.test(c));
  if (named(/^call oi$/) >= 0) {
    cOi = named(/^call oi$/);
    cChg = named(/^call (chg|change)( in)? oi$/);
    pOi = named(/^put oi$/);
    pChg = named(/^put (chg|change)( in)? oi$/);
  } else {
    const isOi = (c: string) => c === "oi" || c === "open interest";
    const isChg = (c: string) => /^(chng|chg|change) in oi$/.test(c);
    const left = h.map((c, i) => [c, i] as const).filter(([, i]) => i < strikeCol);
    const right = h.map((c, i) => [c, i] as const).filter(([, i]) => i > strikeCol);
    cOi = left.find(([c]) => isOi(c))?.[1] ?? -1;
    cChg = left.find(([c]) => isChg(c))?.[1] ?? -1;
    pOi = [...right].reverse().find(([c]) => isOi(c))?.[1] ?? -1;
    pChg = [...right].reverse().find(([c]) => isChg(c))?.[1] ?? -1;
  }
  if (cOi < 0 || pOi < 0) return { rows: [], error: "Found the STRIKE column but not the call and put OI columns." };
  const out: ChainRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const strike = toNum(r[strikeCol]);
    if (strike == null || strike <= 0) continue;
    out.push({ strike, callOi: toNum(r[cOi]) ?? 0, callChg: cChg >= 0 ? (toNum(r[cChg]) ?? 0) : 0, putOi: toNum(r[pOi]) ?? 0, putChg: pChg >= 0 ? (toNum(r[pChg]) ?? 0) : 0 });
  }
  if (out.length < 5) return { rows: [], error: "Fewer than 5 strikes were readable." };
  return { rows: out.sort((a, b) => a.strike - b.strike) };
}
