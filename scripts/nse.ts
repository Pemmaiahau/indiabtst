// NSE end-of-day files (free, published after the close): F&O bhavcopy and participant-wise open interest.
// Parsed results are kept in ./cache so each day is downloaded only once.
import { unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CACHE = join(process.cwd(), "cache");
const HOST = "https://nsearchives.nseindia.com";

// NSE blocks an IP address for a while (HTTP 403) when it sees too many requests.
// Once that happens we stop asking for the rest of this run instead of making it worse.
let blocked = false;
export const nseBlocked = () => blocked;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getBytes(url: string, tries = 3): Promise<Uint8Array | null> {
  for (let t = 0; t < tries; t++) {
    try {
      if (blocked) throw new Error("blocked by NSE");
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return null; // holiday or not published yet
      if (res.status === 403) blocked = true;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (blocked || t === tries - 1) throw new Error(`${url}: ${e}`);
      await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
    }
  }
  return null;
}

function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------- participant-wise open interest ----------

export type Participant = {
  fiiFutLong: number;
  fiiFutShort: number;
  clientFutLong: number;
  clientFutShort: number;
  proFutLong: number;
  proFutShort: number;
  fiiCallLong: number;
  fiiCallShort: number;
  fiiPutLong: number;
  fiiPutShort: number;
};

function parseParticipant(text: string): Participant | null {
  const rows = text.split(/\r?\n/).map(splitCsv);
  const get = (who: string) => rows.find((r) => r[0]?.trim().toUpperCase() === who)?.map((x) => Number(x));
  const fii = get("FII");
  const cl = get("CLIENT");
  const pro = get("PRO");
  if (!fii || !cl || !pro || !(fii[1] >= 0)) return null;
  return { fiiFutLong: fii[1], fiiFutShort: fii[2], clientFutLong: cl[1], clientFutShort: cl[2], proFutLong: pro[1], proFutShort: pro[2], fiiCallLong: fii[5], fiiPutLong: fii[6], fiiCallShort: fii[7], fiiPutShort: fii[8] };
}

// ---------- F&O bhavcopy ----------

export type IndexFo = {
  spot: number;
  lot: number;
  nearExpiry: string;
  futClose: number; // near-month futures close
  futOi: number; // all expiries, in contracts-equivalent units as published
  futOiChg: number;
  futVol: number;
  optExpiry: string; // nearest option expiry
  callOi: number;
  putOi: number;
  callOiChg: number;
  putOiChg: number;
  pcr: number; // put OI / call OI, nearest expiry
  pcrAll: number; // all expiries
  maxPain: number;
  callWall: number; // strike with the most call OI (resistance)
  putWall: number; // strike with the most put OI (support)
  expiries: string[];
};
export type StockFo = { lot: number; futClose: number; futPrev: number; oi: number; oiChg: number; pcr: number | null };
export type FoDay = { date: string; index: Record<string, IndexFo>; stocks: Record<string, StockFo> };

const INDEXES = ["NIFTY", "BANKNIFTY"];

function parseFo(date: string, csv: string): FoDay {
  const lines = csv.split(/\r?\n/);
  const h = lines[0].split(",");
  const ix = (k: string) => h.indexOf(k);
  const [cTp, cSym, cXp, cStrike, cOpt, cClose, cPrev, cUnd, cSettle, cOi, cOiChg, cVol, cLot] = ["FinInstrmTp", "TckrSymb", "XpryDt", "StrkPric", "OptnTp", "ClsPric", "PrvsClsgPric", "UndrlygPric", "SttlmPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "NewBrdLotQty"].map(ix);
  if (cTp < 0 || cOi < 0) throw new Error("unexpected F&O bhavcopy columns");

  type Fut = { xp: string; close: number; prev: number; oi: number; oiChg: number; vol: number; lot: number; und: number };
  type Opt = { xp: string; strike: number; cp: string; oi: number; oiChg: number };
  const futs = new Map<string, Fut[]>();
  const opts = new Map<string, Opt[]>();
  const stockOpt = new Map<string, { c: number; p: number }>();
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(",");
    if (r.length < h.length) continue;
    const tp = r[cTp];
    const sym = r[cSym];
    if (tp === "IDF" || tp === "STF") {
      if (tp === "IDF" && !INDEXES.includes(sym)) continue;
      const arr = futs.get(sym) ?? [];
      arr.push({ xp: r[cXp], close: +r[cSettle] || +r[cClose], prev: +r[cPrev], oi: +r[cOi], oiChg: +r[cOiChg], vol: +r[cVol], lot: +r[cLot], und: +r[cUnd] });
      futs.set(sym, arr);
    } else if (tp === "IDO" && INDEXES.includes(sym)) {
      const arr = opts.get(sym) ?? [];
      arr.push({ xp: r[cXp], strike: +r[cStrike], cp: r[cOpt], oi: +r[cOi], oiChg: +r[cOiChg] });
      opts.set(sym, arr);
    } else if (tp === "STO") {
      const s = stockOpt.get(sym) ?? { c: 0, p: 0 };
      if (r[cOpt] === "CE") s.c += +r[cOi];
      else s.p += +r[cOi];
      stockOpt.set(sym, s);
    }
  }

  const out: FoDay = { date, index: {}, stocks: {} };
  for (const [sym, list] of futs) {
    list.sort((a, b) => a.xp.localeCompare(b.xp));
    const near = list[0];
    const oi = list.reduce((a, f) => a + f.oi, 0);
    const oiChg = list.reduce((a, f) => a + f.oiChg, 0);
    if (!INDEXES.includes(sym)) {
      const so = stockOpt.get(sym);
      out.stocks[sym] = { lot: near.lot, futClose: near.close, futPrev: near.prev, oi, oiChg, pcr: so && so.c > 0 ? Math.round((so.p / so.c) * 1000) / 1000 : null };
      continue;
    }
    const o = opts.get(sym) ?? [];
    const expiries = [...new Set(o.map((x) => x.xp))].sort();
    const optExpiry = expiries[0] ?? "";
    const nearOpts = o.filter((x) => x.xp === optExpiry);
    const sum = (arr: Opt[], cp: string, k: "oi" | "oiChg") => arr.filter((x) => x.cp === cp).reduce((a, x) => a + x[k], 0);
    const callOi = sum(nearOpts, "CE", "oi");
    const putOi = sum(nearOpts, "PE", "oi");
    const strikes = [...new Set(nearOpts.map((x) => x.strike))].sort((a, b) => a - b);
    // max pain: the expiry price at which option buyers collectively get the least
    let maxPain = 0;
    let best = Infinity;
    for (const s of strikes) {
      let pay = 0;
      for (const x of nearOpts) pay += x.oi * (x.cp === "CE" ? Math.max(0, s - x.strike) : Math.max(0, x.strike - s));
      if (pay < best) (best = pay), (maxPain = s);
    }
    const wall = (cp: string) => nearOpts.filter((x) => x.cp === cp).reduce((b, x) => (x.oi > b.oi ? x : b), { oi: -1, strike: 0 } as { oi: number; strike: number }).strike;
    out.index[sym] = {
      spot: near.und,
      lot: near.lot,
      nearExpiry: near.xp,
      futClose: near.close,
      futOi: oi,
      futOiChg: oiChg,
      futVol: list.reduce((a, f) => a + f.vol, 0),
      optExpiry,
      callOi,
      putOi,
      callOiChg: sum(nearOpts, "CE", "oiChg"),
      putOiChg: sum(nearOpts, "PE", "oiChg"),
      pcr: callOi > 0 ? Math.round((putOi / callOi) * 1000) / 1000 : 0,
      pcrAll: sum(o, "CE", "oi") > 0 ? Math.round((sum(o, "PE", "oi") / sum(o, "CE", "oi")) * 1000) / 1000 : 0,
      maxPain,
      callWall: wall("CE"),
      putWall: wall("PE"),
      expiries: [...new Set(list.map((f) => f.xp))],
    };
  }
  return out;
}

// ---------- cached loaders ----------

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Participant OI for each date (null = no file that day). Only missing dates are downloaded. */
export async function loadParticipants(dates: string[], onProgress?: (n: number) => void): Promise<Record<string, Participant | null>> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, "participant.json");
  const store = loadJson<Record<string, Participant | null>>(file, {});
  const todo = dates.filter((d) => !(d in store));
  let done = 0;
  let failures = 0;
  const work = async () => {
    while (todo.length && failures < 8 && !blocked) {
      const d = todo.pop()!;
      await pause(500); // stay polite: NSE throttles bursts
      const [y, m, dd] = d.split("-");
      try {
        const bytes = await getBytes(`${HOST}/content/nsccl/fao_participant_oi_${dd}${m}${y}.csv`);
        store[d] = bytes ? parseParticipant(new TextDecoder().decode(bytes)) : null;
      } catch {
        failures++;
      }
      if (++done % 100 === 0) onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: 2 }, work));
  // never cache "missing" for the most recent days: the file may simply not be published yet
  for (const d of dates.slice(-3)) if (store[d] === null) delete store[d];
  writeFileSync(file, JSON.stringify(store));
  if (failures) console.warn(`participant OI: ${failures} downloads failed${blocked ? " (NSE is blocking this address for now)" : ""}; they will be retried on the next run`);
  return store;
}

/** Parsed F&O bhavcopy per date (missing dates are simply absent). */
export async function loadFo(dates: string[], onProgress?: (n: number) => void, maxDownloads = Infinity): Promise<Record<string, FoDay>> {
  const dir = join(CACHE, "fo");
  mkdirSync(dir, { recursive: true });
  const out: Record<string, FoDay> = {};
  const todo: string[] = [];
  for (const d of dates) {
    const f = join(dir, `${d}.json`);
    if (existsSync(f)) {
      const v = loadJson<FoDay | { missing: true }>(f, { missing: true });
      if (!("missing" in v)) out[d] = v;
    } else todo.push(d);
  }
  const recent = new Set(dates.slice(-3));
  let done = 0;
  let failures = 0;
  const work = async () => {
    while (todo.length && failures < 6 && !blocked && done < maxDownloads) {
      const d = todo.pop()!; // newest first, so a partial run still has the latest days
      await pause(1200);
      try {
        const bytes = await getBytes(`${HOST}/content/fo/BhavCopy_NSE_FO_0_0_0_${d.replace(/-/g, "")}_F_0000.csv.zip`);
        if (!bytes) {
          if (!recent.has(d)) writeFileSync(join(dir, `${d}.json`), JSON.stringify({ missing: true }));
        } else {
          const files = unzipSync(bytes);
          const day = parseFo(d, new TextDecoder().decode(Object.values(files)[0]));
          writeFileSync(join(dir, `${d}.json`), JSON.stringify(day));
          out[d] = day;
        }
      } catch (e) {
        failures++;
        console.warn(String(e));
      }
      if (++done % 25 === 0) onProgress?.(done);
    }
  };
  await work(); // one at a time: these are large files
  if (failures) console.warn(`F&O bhavcopy: ${failures} downloads failed${blocked ? " (NSE is blocking this address for now)" : ""}; they will be retried on the next run`);
  return out;
}

// ---------- F&O ban list ----------

/** Stocks in the F&O ban period (no new futures positions) for the trade date in the file. null = unavailable. */
export async function loadBan(): Promise<{ asOf: string; syms: string[] } | null> {
  try {
    await pause(800);
    const bytes = await getBytes(`${HOST}/content/fo/fo_secban.csv`, 2);
    if (!bytes) return null;
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const asOf = lines[0]?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/)?.[1] ?? "";
    if (!asOf) return null;
    const syms = lines.slice(1).map((l) => l.split(",").pop()!.trim().toUpperCase()).filter((s) => /^[A-Z0-9&-]+$/.test(s));
    return { asOf, syms };
  } catch (e) {
    console.warn(`F&O ban list: ${e}`);
    return null;
  }
}

// ---------- delivery percentage (cash-market bhavcopy) ----------

/**
 * Delivery % per symbol for the most recent `dates`, from NSE's full cash bhavcopy. Only `syms` are kept.
 * Stored in cache/delivery.json; at most `maxDownloads` files are fetched per run.
 */
export async function loadDelivery(dates: string[], syms: Set<string>, maxDownloads = 12): Promise<Record<string, Record<string, number>>> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, "delivery.json");
  const store = loadJson<Record<string, Record<string, number> | null>>(file, {});
  const todo = dates.filter((d) => !(d in store));
  const recent = new Set(dates.slice(-3));
  let done = 0;
  let failures = 0;
  while (todo.length && failures < 3 && !blocked && done < maxDownloads) {
    const d = todo.pop()!; // newest first
    done++;
    await pause(1200);
    const [y, m, dd] = d.split("-");
    try {
      const bytes = await getBytes(`${HOST}/products/content/sec_bhavdata_full_${dd}${m}${y}.csv`);
      if (!bytes) {
        if (!recent.has(d)) store[d] = null;
        continue;
      }
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      const h = lines[0].split(",").map((x) => x.trim());
      const cSym = h.indexOf("SYMBOL");
      const cSer = h.indexOf("SERIES");
      const cDel = h.indexOf("DELIV_PER");
      if (cSym < 0 || cDel < 0) throw new Error("unexpected cash bhavcopy columns");
      const day: Record<string, number> = {};
      for (let i = 1; i < lines.length; i++) {
        const r = lines[i].split(",").map((x) => x.trim());
        if (r[cSer] !== "EQ" || !syms.has(r[cSym])) continue;
        const v = Number(r[cDel]);
        if (Number.isFinite(v)) day[r[cSym]] = v;
      }
      store[d] = day;
    } catch (e) {
      failures++;
      console.warn(String(e));
    }
  }
  // keep the file small: only the dates asked for
  const keep = new Set(dates);
  const out: Record<string, Record<string, number>> = {};
  const saved: Record<string, Record<string, number> | null> = {};
  for (const [d, v] of Object.entries(store)) {
    if (!keep.has(d)) continue;
    saved[d] = v;
    if (v) out[d] = v;
  }
  writeFileSync(file, JSON.stringify(saved));
  return out;
}
