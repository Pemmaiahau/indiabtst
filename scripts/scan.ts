// Downloads free market data, scores Nifty / Bank Nifty futures and the F&O stocks
// (every stock that has futures), backtests every rule and writes public/data/*.json.
// Run: npm run scan          (SCAN_CACHE=1 reuses today's Yahoo downloads while developing)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BTST_RULES, SELL_MAX, scoreBtstDay } from "../src/lib/btst";
import { momentumClose, swingWhy, weakClose } from "../src/lib/reasons";
import { INDEX_RULES, LONG_AT, SHORT_AT, indexFeatures, indexScore } from "../src/lib/indexcall";
import { ctxAt, precompute, sma, type Pre } from "../src/lib/indicators";
import { viewOptions } from "../src/lib/options";
import { detectSwing, SETUPS, simulate, SWING_DIR, SWING_RULES } from "../src/lib/swing";
import type { Backtest, Bar, BtstInput, BtstRow, Bucket, Buildup, EconEvent, Extra, FoRead, FuturesRead, IndexCall, IndexCtx, Meta, OptionRead, Pulse, PulseComponent, Snapshot, SwingSetup, SwingSignal, TradeStats, Variant } from "../src/lib/types";
import { fetchChart, getText, pool, type Chart } from "./net";
import { loadBan, loadDelivery, loadFo, loadParticipants, nseBlocked, type FoDay, type Participant } from "./nse";

type U = { sym: string; name: string; sector: string; n50?: boolean };
const MAX_GAP = 15; // overnight moves beyond this (%) are demergers or bad ticks, not tradable gaps: left out of the tests
const OUT = "public/data";
const COST_FUT = 0.0006; // round trip in futures: brokerage, STT on the sell side, exchange fees, slippage
const COST_CASH = 0.0025; // round trip in delivery (cash) shares: 0.1% STT each side plus charges
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data));
const sign = (x: number) => (x >= 0 ? "+" : "");

const INDEX = {
  NIFTY: { y: "^NSEI", name: "Nifty 50", lot: 65 },
  BANKNIFTY: { y: "^NSEBANK", name: "Bank Nifty", lot: 30 },
} as const;
type IndexSym = keyof typeof INDEX;

const MACRO: Record<string, string> = {
  "^NSEI": "Nifty 50",
  "^NSEBANK": "Bank Nifty",
  "^INDIAVIX": "India VIX",
  "INR=X": "USD/INR",
  "BZ=F": "Brent crude",
  "^GSPC": "S&P 500 (last close)",
  "^IXIC": "Nasdaq (last close)",
  "ES=F": "S&P futures",
  "^N225": "Nikkei",
  "^HSI": "Hang Seng",
  "^TNX": "US 10-yr yield",
  "GC=F": "Gold",
};
const SECTORS: Record<string, string> = {
  "^NSEBANK": "Banks",
  "^CNXPSUBANK": "PSU banks",
  "^CNXIT": "IT",
  "^CNXAUTO": "Auto",
  "^CNXPHARMA": "Pharma",
  "^CNXFMCG": "FMCG",
  "^CNXMETAL": "Metals",
  "^CNXENERGY": "Energy",
  "^CNXREALTY": "Realty",
};

// ---------- dates, calendar, news ----------

const istDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
function nextWeekdays(from: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(from + "T12:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The Nasdaq calendar gives US Eastern times; convert to India time. */
function etToIst(date: string, time: string): { date: string; time: string } {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { date, time: "" };
  const noon = new Date(date + "T17:00:00Z");
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(noon).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const etHours = Number(off.replace("GMT", "")) || -5;
  const utc = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +m[1] - etHours, +m[2]);
  const ist = new Date(utc + 5.5 * 3600e3).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16) };
}

const HIGH_US = /\b(CPI|Nonfarm Payrolls|Fed Interest Rate Decision|FOMC (Statement|Press Conference|Economic Projections|Meeting Minutes)|Core PCE|PCE Price Index|GDP \(QoQ\)|Fed Chair .* (Speaks|Testifies))/i;
const HIGH_IN = /(Interest Rate Decision|^CPI|GDP|Union Budget)/i;
const MEDIUM_IN = /(WPI|PMI|Industrial Production|Trade Balance|FX Reserves|Cash Reserve|Reverse REPO|Infrastructure Output|Manufacturing Output|Inflation)/i;

async function fetchEcon(days: string[]): Promise<EconEvent[]> {
  const out: EconEvent[] = [];
  const clean = (s: string) => (s ?? "").replace(/&nbsp;/g, "").trim();
  for (const date of days) {
    try {
      // Nasdaq's endpoint is off by one: asking for day D returns the events of D-1, so ask for the following day.
      const q = new Date(date + "T12:00:00Z");
      q.setUTCDate(q.getUTCDate() + 1);
      const j = JSON.parse(await getText(`https://api.nasdaq.com/api/calendar/economicevents?date=${q.toISOString().slice(0, 10)}`, `econ_for_${date}`));
      for (const r of j?.data?.rows ?? []) {
        const name = clean(r.eventName);
        let impact: EconEvent["impact"] = "low";
        if (r.country === "India") impact = HIGH_IN.test(name) ? "high" : MEDIUM_IN.test(name) ? "medium" : "low";
        else if (r.country === "United States") impact = HIGH_US.test(name) ? "high" : "low";
        if (impact === "low") continue;
        const t = etToIst(date, clean(r.gmt));
        out.push({ date: t.date, time: t.time, country: r.country === "India" ? "India" : "US", name, impact, consensus: clean(r.consensus), previous: clean(r.previous), actual: clean(r.actual) });
      }
    } catch (e) {
      console.warn(`econ ${date}: ${e}`);
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

const POS = /\b(beats?|tops?|surges?|soars?|jumps?|rall(y|ies)|upgrades?|raises?|record|strong|outperform|buy rating|bullish|growth|wins?|approval|approved|partnership|buyback|order win|all-time high)\b/i;
const NEG = /\b(miss(es)?|falls?|drops?|plunges?|sinks?|slumps?|downgrades?|cuts?|lawsuit|probe|investigation|recall|weak|underperform|sell rating|bearish|layoffs?|warns?|warning|fraud|decline|tumbles?|slides?|penalty)\b/i;
export type NewsItem = { title: string; link: string; date: string; tone: "pos" | "neg" | "neutral" };
async function fetchNews(ySym: string): Promise<NewsItem[]> {
  try {
    const xml = await getText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ySym)}&region=IN&lang=en-IN`, `news_${ySym}_${istDate()}`, 2);
    const items: NewsItem[] = [];
    const un = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const pick = (tag: string) => un(m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      const title = pick("title");
      const date = new Date(pick("pubDate"));
      if (!title || isNaN(+date) || Date.now() - +date > 7 * 864e5) continue;
      const p = POS.test(title);
      const n = NEG.test(title);
      items.push({ title, link: pick("link"), date: date.toISOString(), tone: p && !n ? "pos" : n && !p ? "neg" : "neutral" });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  } catch {
    return [];
  }
}

// ---------- stats helpers ----------

function stats(vals: number[], curveVals?: number[], compound = false): TradeStats {
  const wins = vals.filter((v) => v > 0);
  const losses = vals.filter((v) => v <= 0);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let eq = compound ? 1 : 0;
  let peak = eq;
  let dd = 0;
  for (const v of curveVals ?? vals) {
    eq = compound ? eq * (1 + v / 100) : eq + v;
    if (eq > peak) peak = eq;
    dd = Math.max(dd, compound ? (1 - eq / peak) * 100 : peak - eq);
  }
  return {
    n: vals.length,
    winRate: vals.length ? r2((wins.length / vals.length) * 100) : 0,
    avg: vals.length ? r3(sum(vals) / vals.length) : 0,
    avgWin: wins.length ? r2(sum(wins) / wins.length) : 0,
    avgLoss: losses.length ? r2(sum(losses) / losses.length) : 0,
    profitFactor: losses.length && sum(losses) !== 0 ? r2(sum(wins) / -sum(losses)) : 0,
    total: r2(compound ? (eq - 1) * 100 : eq),
    maxDD: r2(dd),
  };
}
function downsample(curve: [string, number][], max = 260): [string, number][] {
  if (curve.length <= max) return curve;
  const step = curve.length / max;
  const out: [string, number][] = [];
  for (let i = 0; i < max; i++) out.push(curve[Math.floor(i * step)]);
  out.push(curve[curve.length - 1]);
  return out;
}
function byYear(rows: { date: string; v: number }[]) {
  const m = new Map<string, number[]>();
  for (const r of rows) m.set(r.date.slice(0, 4), [...(m.get(r.date.slice(0, 4)) ?? []), r.v]);
  return [...m.entries()].sort().map(([year, v]) => ({ year, n: v.length, avg: r3(mean(v)), winRate: r2((v.filter((x) => x > 0).length / v.length) * 100), total: r2(v.reduce((a, b) => a + b, 0)) }));
}
/** One position per day: daily[] holds that day's return (0 when flat); trades[] only the days traded. */
function variant(name: string, days: { date: string; v: number | null }[]): Variant {
  let eq = 1;
  const curve: [string, number][] = [];
  for (const d of days) {
    eq *= 1 + (d.v ?? 0) / 100;
    curve.push([d.date, r2((eq - 1) * 100)]);
  }
  return { name, stats: stats(days.filter((d) => d.v != null).map((d) => d.v!), days.map((d) => d.v ?? 0), true), curve: downsample(curve) };
}
function bucketize(rows: { s: number; v: number }[], edges: [string, number, number][]): Bucket[] {
  return edges.map(([bucket, lo, hi]) => {
    const v = rows.filter((r) => r.s >= lo && r.s < hi).map((r) => r.v);
    return { bucket, n: v.length, avg: r3(mean(v)), winRate: v.length ? r2((v.filter((x) => x > 0).length / v.length) * 100) : 0 };
  });
}

// ---------- derivatives reads ----------

function buildupOf(priceChg: number, oiChgPct: number): Buildup {
  if (Math.abs(oiChgPct) < 1) return "Flat";
  if (priceChg >= 0) return oiChgPct > 0 ? "Long build-up" : "Short covering";
  return oiChgPct > 0 ? "Short build-up" : "Long unwinding";
}
const bullish = (b: Buildup) => (b === "Long build-up" || b === "Short covering" ? 1 : b === "Flat" ? 0 : -1);

function optionRead(day: FoDay, prev: FoDay | undefined, sym: string): OptionRead | null {
  const x = day.index[sym];
  if (!x || !x.callOi) return null;
  const p = prev?.index[sym];
  const pcrPrev = p && p.optExpiry === x.optExpiry ? p.pcr : null;
  const v = viewOptions({ spot: x.spot, pcr: x.pcr, pcrPrev, callOiChg: x.callOiChg, putOiChg: x.putOiChg, callWall: x.callWall, putWall: x.putWall, maxPain: x.maxPain });
  return { asOf: day.date, expiry: x.optExpiry, pcr: x.pcr, pcrPrev, pcrAll: x.pcrAll, maxPain: x.maxPain, callWall: x.callWall, putWall: x.putWall, callOiChg: x.callOiChg, putOiChg: x.putOiChg, view: v.view, points: v.points };
}

// ---------- main ----------

type Series = { bars: Bar[]; pre: Pre; idxOf: Map<string, number> };
type Stock = U & Series;
const series = (bars: Bar[]): Series => ({ bars, pre: precompute(bars), idxOf: new Map(bars.map((b, j) => [b.d, j])) });

/** Latest value strictly before `date` in a date-sorted list. */
function before<T>(list: [string, T][], date: string): T | null {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m][0] < date) lo = m + 1;
    else hi = m;
  }
  return lo ? list[lo - 1][1] : null;
}

function indexCtxAt(s: Series, i: number, vixPrev: number, fiiRatio: number | null): IndexCtx {
  const { bars, pre } = s;
  return {
    prevClose: bars[i - 1].c,
    sum19: pre.prefC[i] - pre.prefC[i - 19],
    sum49: pre.prefC[i] - pre.prefC[i - 49],
    sum199: pre.prefC[i] - pre.prefC[i - 199],
    close5ago: bars[i - 5].c,
    avgGain: pre.rsi.gain[i - 1],
    avgLoss: pre.rsi.loss[i - 1],
    ovnSum19: pre.prefOvn[i] - pre.prefOvn[i - 19],
    vixPrev,
    fiiRatio,
  };
}

async function main() {
  const t0 = Date.now();
  const universe: U[] = JSON.parse(readFileSync("data/universe.json", "utf8"));
  const notes: string[] = [];
  const failed: string[] = [];

  console.log(`fetching ${universe.length} stocks and market symbols from Yahoo...`);
  const macroSyms = [...new Set([...Object.keys(MACRO), ...Object.keys(SECTORS)])];
  const macro = new Map<string, Chart>();
  await pool(macroSyms, 6, async (s) => {
    try {
      macro.set(s, await fetchChart(s, "10y"));
    } catch {
      notes.push(`${MACRO[s] ?? SECTORS[s]} unavailable`);
    }
  });
  const niftyChart = macro.get("^NSEI");
  const bankChart = macro.get("^NSEBANK");
  const vixChart = macro.get("^INDIAVIX");
  if (!niftyChart || !bankChart) throw new Error("Nifty / Bank Nifty data unavailable; aborting scan");
  const charts = await pool(universe, 6, async (u) => {
    try {
      return await fetchChart(`${u.sym}.NS`, "10y");
    } catch {
      failed.push(u.sym);
      return null;
    }
  });

  // session state from the Nifty chart
  const now = Date.now() / 1000;
  const barDate = niftyChart.bars[niftyChart.bars.length - 1].d;
  const live = now >= niftyChart.regStart && now < niftyChart.regEnd && barDate === istDate();
  const volFrac = live ? clamp((now - niftyChart.regStart) / (niftyChart.regEnd - niftyChart.regStart), 0.05, 1) : 1;
  const nextSession = nextWeekdays(barDate, 2)[1];

  const stocks: Stock[] = [];
  charts.forEach((c, i) => {
    if (!c) return;
    const u = universe[i];
    if (c.bars.length < 260) return void notes.push(`${u.sym}: under 1 year of history, skipped`);
    if (c.bars[c.bars.length - 1].d !== barDate) return void failed.push(u.sym);
    stocks.push({ ...u, ...series(c.bars) });
  });
  console.log(`loaded ${stocks.length} stocks, ${failed.length} failed; bar date ${barDate} (${live ? "LIVE " + Math.round(volFrac * 100) + "% of session" : "closed"})`);
  if (stocks.length < universe.length * 0.8) throw new Error("Too many symbols failed to download; aborting so old data is kept.");

  const idx: Record<IndexSym, Series> = { NIFTY: series(niftyChart.bars), BANKNIFTY: series(bankChart.bars) };
  if (bankChart.bars[bankChart.bars.length - 1].d !== barDate) notes.push("Bank Nifty prices are a session behind Nifty.");
  const vixList: [string, number][] = (vixChart?.bars ?? []).map((b) => [b.d, b.c]);
  const vixOn = new Map(vixList);
  if (!vixChart) notes.push("India VIX unavailable: the VIX part of the index score is left out.");

  // ----- NSE end-of-day files (cached; degrade gracefully when NSE is unreachable)
  const tradeDates = niftyChart.bars.map((b) => b.d);
  let participants: Record<string, Participant | null> = {};
  let fo: Record<string, FoDay> = {};
  try {
    participants = await loadParticipants(tradeDates.slice(-1250));
    fo = await loadFo(tradeDates.filter((d) => d >= "2024-07-08"), undefined, 12);
  } catch (e) {
    console.warn(`NSE files: ${e}`);
  }
  if (nseBlocked()) notes.push("NSE is temporarily refusing downloads from this address, so futures, options and FII positioning may be a few sessions old.");
  const fiiList: [string, number][] = Object.entries(participants)
    .filter(([, p]) => p && p.fiiFutLong + p.fiiFutShort > 0)
    .map(([d, p]) => [d, p!.fiiFutLong / (p!.fiiFutLong + p!.fiiFutShort)] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const fiiAsOf = fiiList.length ? fiiList[fiiList.length - 1][0] : null;
  const foDates = Object.keys(fo).sort();
  const foAsOf = foDates.length ? foDates[foDates.length - 1] : null;
  const foLast = foAsOf ? fo[foAsOf] : null;
  const foPrev = foDates.length > 1 ? fo[foDates[foDates.length - 2]] : undefined;
  const foStale = !foAsOf || tradeDates.indexOf(barDate) - tradeDates.indexOf(foAsOf) > 2;
  if (!foAsOf) notes.push("No NSE futures/options file available yet: derivative reads are missing.");
  else if (foStale) notes.push(`Futures and options data is from ${foAsOf}, more than two sessions old.`);
  console.log(`NSE: FII positioning to ${fiiAsOf ?? "none"}, F&O files ${foDates.length} days to ${foAsOf ?? "none"}`);

  const stockFo = (sym: string): FoRead | undefined => {
    const s = foLast?.stocks[sym];
    if (!s || !foAsOf) return undefined;
    const base = s.oi - s.oiChg;
    const oiChgPct = base > 0 ? (s.oiChg / base) * 100 : 0;
    return { lot: s.lot, oiChgPct: r2(oiChgPct), buildup: buildupOf(s.futClose - s.futPrev, oiChgPct), pcr: s.pcr, asOf: foAsOf };
  };

  // ----- context that is not part of a score: F&O ban list, delivery %, 12-month strength rank, 52-week high
  const ban = nseBlocked() ? null : await loadBan();
  if (!ban) notes.push("NSE's F&O ban list was unavailable: check it yourself before taking a stock-futures trade.");
  const banSet = new Set(ban?.syms ?? []);
  let delivery: Record<string, Record<string, number>> = {};
  try {
    delivery = await loadDelivery(tradeDates.slice(-11), new Set(universe.map((u) => u.sym)));
  } catch (e) {
    console.warn(`delivery data: ${e}`);
  }
  const delivDates = Object.keys(delivery).sort();
  const delivAsOf = delivDates.length ? delivDates[delivDates.length - 1] : null;
  const ret250 = new Map(stocks.map((s) => [s.sym, s.bars[s.bars.length - 1].c / s.bars[s.bars.length - 251].c - 1]));
  const sortedRet = [...ret250.values()].sort((a, b) => a - b);
  const extra = new Map<string, Extra>();
  for (const s of stocks) {
    const n = s.bars.length - 1;
    let hi = 0;
    for (let j = n - 250; j <= n; j++) hi = Math.max(hi, s.bars[j].h);
    const r = ret250.get(s.sym)!;
    const earlier = delivDates.slice(0, -1).map((d) => delivery[d][s.sym]).filter((v) => v != null);
    extra.set(s.sym, {
      n50: !!s.n50,
      rs: r3(sortedRet.filter((v) => v < r).length / Math.max(1, sortedRet.length - 1)),
      ret250: r2(r * 100),
      dist52: r2((1 - s.bars[n].c / hi) * 100),
      ban: banSet.has(s.sym),
      deliv: delivAsOf ? (delivery[delivAsOf][s.sym] ?? null) : null,
      delivAvg: earlier.length >= 5 ? r2(mean(earlier)) : null,
      delivAsOf,
    });
  }
  const nf = idx.NIFTY;
  const niftyAbove200 = nf.bars[nf.bars.length - 1].c > nf.pre.sma200[nf.bars.length - 1];
  console.log(`context: ban list ${ban ? `${ban.asOf} (${ban.syms.length} stocks)` : "unavailable"}, delivery to ${delivAsOf ?? "none"} (${delivDates.length} days)`);

  // ----- index calls
  const calls: IndexCall[] = (Object.keys(INDEX) as IndexSym[]).map((sym) => {
    const s = idx[sym];
    const i = s.bars.length - 1;
    const day = s.bars[i].d;
    const vixNow = vixOn.get(day) ?? null;
    const ctx = indexCtxAt(s, i, before(vixList, day) ?? 0, before(fiiList, day));
    const features = indexFeatures(ctx, s.bars[i], vixNow);
    const score = indexScore(features);
    const nextCtx = live ? null : indexCtxAt(s, i + 1, vixNow ?? ctx.vixPrev, before(fiiList, nextSession));
    const ovn: number[] = [];
    for (let j = Math.max(1, i - 250); j <= i; j++) ovn.push(Math.abs(s.bars[j].o / s.bars[j - 1].c - 1));
    ovn.sort((a, b) => a - b);
    const f = foLast?.index[sym];
    let futures: FuturesRead | null = null;
    if (f && foAsOf) {
      const k = s.idxOf.get(foAsOf);
      const priceChg = k ? s.bars[k].c - s.bars[k - 1].c : 0;
      const base = f.futOi - f.futOiChg;
      const oiChgPct = base > 0 ? (f.futOiChg / base) * 100 : 0;
      futures = { asOf: foAsOf, expiry: f.nearExpiry, lot: f.lot, futClose: f.futClose, premium: r2(f.futClose - f.spot), oiChgPct: r2(oiChgPct), buildup: buildupOf(priceChg, oiChgPct), expiries: f.expiries };
    }
    const options = foLast ? optionRead(foLast, foPrev, sym) : null;
    const view = (futures ? bullish(futures.buildup) : 0) + (options ? (options.view === "Bullish" ? 1 : options.view === "Bearish" ? -1 : 0) : 0);
    const want = score.call === "LONG" ? 1 : score.call === "SHORT" ? -1 : 0;
    const confirm: IndexCall["confirm"] = !futures && !options ? "No data" : want === 0 || view === 0 ? "Neutral" : Math.sign(view) === want ? "Confirms" : "Conflicts";
    const expiries = new Set([...(f?.expiries ?? []), f?.optExpiry ?? ""]);
    return {
      sym,
      name: INDEX[sym].name,
      features,
      score,
      ctx,
      nextCtx,
      atr: r2(s.pre.atr[i]),
      badNight: r2(ovn[Math.floor(ovn.length * 0.95)] * s.bars[i].c),
      lot: f?.lot ?? INDEX[sym].lot,
      lotIsEstimate: !f,
      futures,
      options,
      confirm,
      expiryNext: expiries.has(nextSession) || (live && expiries.has(barDate)),
    };
  });

  // ----- stock BTST scan
  const inputs: BtstInput[] = stocks.map((s) => {
    const i = s.bars.length - 1;
    return { sym: s.sym, name: s.name, sector: s.sector, ctx: ctxAt(s.bars, s.pre, i), bar: s.bars[i] };
  });
  const btstRows: BtstRow[] = scoreBtstDay(inputs, volFrac)
    .map((r) => ({ ...r, fo: stockFo(r.sym), ex: extra.get(r.sym) }))
    .sort((a, b) => b.score - a.score);

  // ----- backtest (run before the swing scan so every signal can quote how its setup tested in a market like today's)
  console.log("backtesting...");
  const backtest = runBacktest(stocks, idx, vixList, fiiList, fo, live);
  const tested = (setup: SwingSetup, dir: 1 | -1, kind: "stock" | "index") => {
    const b = backtest.swing.find((x) => x.setup === setup)!;
    const withTrend = dir === 1 ? niftyAbove200 : !niftyAbove200;
    return { all: kind === "index" ? b.index : b.stocks, regime: kind === "index" ? null : withTrend ? b.withTrend : b.againstTrend, recent: kind === "index" ? null : b.recent };
  };

  // ----- swing scan: stocks and both indices, signals from the last 3 sessions that are still valid
  const swing: SwingSignal[] = [];
  const scanSwing = (sym: string, name: string, sector: string, s: Series, kind: "stock" | "index", lot?: number) => {
    const n = s.bars.length;
    for (let i = n - 1; i >= n - 3; i--) {
      for (const sig of detectSwing(s.bars, s.pre, i, i === n - 1 ? volFrac : 1, kind === "index")) {
        const b = s.bars[i];
        const last = s.bars[n - 1].c;
        const risk = Math.abs(b.c - sig.stop);
        if (i < n - 1 && (sig.dir * (last - sig.stop) <= 0 || sig.dir * (last - b.c) > risk)) continue; // stopped out or ran away
        const fo = kind === "stock" ? stockFo(sym) : undefined;
        const ex = kind === "stock" ? extra.get(sym) : undefined;
        const rsi = Math.round(s.pre.rsi.rsi[i]);
        swing.push({
          ...swingWhy({ setup: sig.setup, dir: sig.dir, note: sig.note, kind, rsi, ex, fo, niftyAbove200, tested: tested(sig.setup, sig.dir, kind) }),
          ex,
          sym,
          name,
          sector,
          kind,
          setup: sig.setup,
          dir: sig.dir,
          date: b.d,
          close: r2(b.c),
          stop: r2(sig.stop),
          target: r2(b.c + sig.dir * sig.rMult * risk),
          riskPct: r2((risk / b.c) * 100),
          atrPct: r2((s.pre.atr[i] / b.c) * 100),
          rsi,
          rvol: r2(sig.rvol),
          holdDays: sig.holdDays,
          note: sig.note,
          lot,
          fo,
        });
      }
    }
  };
  for (const c of calls) scanSwing(c.sym, c.name, "Index", idx[c.sym], "index", c.lot);
  for (const s of stocks) scanSwing(s.sym, s.name, s.sector, s, "stock", foLast?.stocks[s.sym]?.lot);
  swing.sort((a, b) => (a.kind === b.kind ? b.date.localeCompare(a.date) : a.kind === "index" ? -1 : 1));

  // ----- calendar, pulse, news
  const econ = await fetchEcon(nextWeekdays(istDate(), 5));
  const latestP = fiiAsOf ? participants[fiiAsOf]! : null;
  const pulse = buildPulse(macro, btstRows, stocks, econ, calls, fiiList, latestP, fiiAsOf, nextSession);
  const newsSyms = [...new Set([...btstRows.slice(0, 12).map((r) => r.sym), ...swing.filter((s) => s.kind === "stock").slice(0, 12).map((s) => s.sym)])];
  const news: Record<string, NewsItem[]> = {};
  await pool(newsSyms, 4, async (s) => {
    const n = await fetchNews(`${s}.NS`);
    if (n.length) news[s] = n;
  });

  // ----- write
  const meta: Meta = { generatedAt: new Date().toISOString(), barDate, session: live ? "live" : "closed", volFrac: r2(volFrac), symbols: stocks.length, failed, notes, foAsOf, fiiAsOf, ban: ban?.syms ?? [], banAsOf: ban?.asOf ?? null, niftyAbove200 };
  rmSync(`${OUT}/stocks`, { recursive: true, force: true });
  mkdirSync(`${OUT}/stocks`, { recursive: true });
  const roundCtx = <T extends object>(c: T): T => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v])) as T;
  // `stocks` holds the context for scoring quotes of `barDate`; after the close `next` holds it for the following session.
  const snapshot: Snapshot = { meta, stocks: {}, next: live ? null : {} };
  for (const inp of inputs) snapshot.stocks[inp.sym] = { name: inp.name, sector: inp.sector, ctx: roundCtx(inp.ctx) };
  if (!live) {
    for (const s of stocks) {
      const ext = [...s.bars, s.bars[s.bars.length - 1]]; // placeholder bar so ctxAt can look "before" the next session
      snapshot.next![s.sym] = { name: s.name, sector: s.sector, ctx: roundCtx(ctxAt(ext, precompute(ext), ext.length - 1)) };
    }
  }
  const slim = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? r3(v) : v])) as T;
  write("meta.json", meta);
  write("pulse.json", pulse);
  write("index.json", { meta, calls: calls.map((c) => ({ ...c, ctx: roundCtx(c.ctx), nextCtx: c.nextCtx && roundCtx(c.nextCtx), features: slim(c.features) })) });
  write("btst.json", { meta, rows: btstRows.map(slim) });
  write("swing.json", { meta, signals: swing });
  write("snapshot.json", snapshot);
  write("calendar.json", { econ });
  write("news.json", news);
  write("backtest.json", backtest);
  const dump = (sym: string, name: string, sector: string, bars: Bar[]) => write(`stocks/${sym}.json`, { sym, name, sector, bars: bars.slice(-420).map((b) => [b.d, r2(b.o), r2(b.h), r2(b.l), r2(b.c), b.v]) });
  for (const s of stocks) dump(s.sym, s.name, s.sector, s.bars);
  for (const c of calls) dump(c.sym, c.name, "Index", idx[c.sym].bars);
  console.log(
    `done in ${Math.round((Date.now() - t0) / 1000)}s: pulse ${pulse.score} (${pulse.label}); ` +
      calls.map((c) => `${c.sym} ${c.score.score} ${c.score.call}`).join(", ") +
      `; ${btstRows.filter((r) => r.score >= 65).length} stock BTST candidates >= 65; ${swing.length} swing signals`,
  );
}

function buildPulse(macro: Map<string, Chart>, rows: BtstRow[], stocks: Stock[], econ: EconEvent[], calls: IndexCall[], fiiList: [string, number][], p: Participant | null, fiiAsOf: string | null, nextSession: string): Pulse {
  const last = (s: string, back = 0) => {
    const b = macro.get(s)?.bars;
    return b && b.length > back ? b[b.length - 1 - back].c : NaN;
  };
  const chg = (s: string, n = 1) => (last(s) / last(s, n) - 1) * 100;
  const comps: PulseComponent[] = [];
  const add = (name: string, value: string, score: number, max: number, note: string) => comps.push({ name, value: Number.isFinite(score) ? value : "data unavailable", score: Number.isFinite(score) ? r2(score) : 0, max, note });

  const trendOf = (s: string) => {
    const closes = macro.get(s)?.bars.map((b) => b.c) ?? [];
    const n = closes.length - 1;
    return { c: closes[n], s20: sma(closes, 20)[n], s50: sma(closes, 50)[n], s200: sma(closes, 200)[n] };
  };
  const nf = trendOf("^NSEI");
  const bn = trendOf("^NSEBANK");
  const sg = (b: boolean) => (b ? 1 : -1);
  const up = (b: boolean) => (b ? "above" : "below");
  add("Index trend", `Nifty ${up(nf.c > nf.s20)} 20d, ${up(nf.c > nf.s50)} 50d, ${up(nf.c > nf.s200)} 200d; Bank Nifty ${up(bn.c > bn.s50)} 50d`, 4 * sg(nf.c > nf.s20) + 5 * sg(nf.c > nf.s50) + 6 * sg(nf.c > nf.s200) + 3 * sg(bn.c > bn.s20) + 3 * sg(bn.c > bn.s50) + 4 * sg(bn.c > bn.s200), 25, "Nifty and Bank Nifty versus their 20/50/200-day averages");

  const vix = last("^INDIAVIX");
  const vix5 = chg("^INDIAVIX", 5);
  add("India VIX", `${vix.toFixed(1)} (${sign(vix5)}${vix5.toFixed(0)}% in 5 days)`, (vix < 13 ? 8 : vix < 16 ? 4 : vix < 20 ? 0 : vix < 25 ? -6 : -10) - 5 * clamp(vix5 / 15), 15, "Low and falling volatility favours carrying positions overnight");

  const adv = rows.filter((r) => r.chg > 0).length;
  const dec = rows.filter((r) => r.chg < 0).length;
  const pc = (f: (r: BtstRow) => boolean) => Math.round((rows.filter(f).length / Math.max(1, rows.length)) * 100);
  const above50 = pc((r) => r.above50);
  let newLow20 = 0;
  for (const s of stocks) {
    const n = s.bars.length - 1;
    let lo = Infinity;
    for (let j = n - 20; j < n; j++) lo = Math.min(lo, s.bars[j].l);
    if (s.bars[n].c < lo) newLow20++;
  }
  const breadth = { adv, dec, above20: pc((r) => r.above20), above50, above200: pc((r) => r.above200), newHigh20: rows.filter((r) => r.distHigh <= 0).length, newLow20 };
  add("Breadth (F&O stocks)", `${above50}% above 50d, ${adv} up / ${dec} down`, 9 * clamp((above50 - 50) / 25) + 6 * clamp((adv / Math.max(1, adv + dec) - 0.5) / 0.25), 15, "How many of the stocks with futures take part in the move");

  const us = (chg("^GSPC") + chg("^IXIC")) / 2;
  const fut = chg("ES=F");
  const asia = [chg("^N225"), chg("^HSI")].filter(Number.isFinite);
  const as = asia.length ? mean(asia) : NaN;
  add("Global cues", `US last close ${sign(us)}${us.toFixed(2)}%, S&P futures ${sign(fut)}${fut.toFixed(2)}%, Asia ${sign(as)}${as.toFixed(2)}%`, 8 * clamp(us / 1) + 7 * clamp((Number.isFinite(fut) ? fut : 0) / 0.6) + 5 * clamp((Number.isFinite(as) ? as : 0) / 1), 20, "Wall Street's last session, US futures now and today's Asian markets");

  const inr5 = chg("INR=X", 5);
  const oil5 = chg("BZ=F", 5);
  add("Rupee and crude", `USD/INR ${last("INR=X").toFixed(2)} (${sign(inr5)}${inr5.toFixed(1)}%/5d), Brent ${sign(oil5)}${oil5.toFixed(1)}%/5d`, -5 * clamp(inr5 / 0.8) - 5 * clamp(Math.max(0, oil5) / 8), 10, "A fast-weakening rupee or a crude spike pressures Indian stocks");

  let fii: Pulse["fii"] = null;
  if (p && fiiAsOf) {
    const ratio = fiiList[fiiList.length - 1][1];
    const ratio5 = fiiList.length > 5 ? fiiList[fiiList.length - 6][1] : null;
    fii = { asOf: fiiAsOf, ratio: r3(ratio), ratio5ago: ratio5 == null ? null : r3(ratio5), long: p.fiiFutLong, short: p.fiiFutShort, clientRatio: r3(p.clientFutLong / (p.clientFutLong + p.clientFutShort)) };
    add("FII index futures", `${Math.round(ratio * 100)}% long (${ratio5 == null ? "" : `${sign(ratio - ratio5)}${Math.round((ratio - ratio5) * 100)} pts in 5 sessions, `}as of ${fiiAsOf})`, 10 * clamp((ratio - 0.4) / 0.15) + (ratio5 == null ? 0 : 5 * clamp((ratio - ratio5) / 0.05)), 15, "Share of foreign investors' index-futures contracts that are long, from NSE's daily participant file");
  } else add("FII index futures", "", NaN, 15, "NSE participant file unavailable");

  const risky = econ.filter((e) => e.impact === "high" && e.date === nextSession);
  const expiry = calls.some((c) => c.expiryNext);
  const riskNames = [...(expiry ? ["Index expiry next session"] : []), ...risky.slice(0, 3).map((e) => `${e.country}: ${e.name}`)];
  add("Event risk", riskNames.length ? riskNames.join(", ") : "No major event next session", -Math.min(8, riskNames.length * 4), 8, "Expiry days and major data or central-bank events can gap the market");

  const score = Math.round(clamp(comps.reduce((a, c) => a + c.score, 0), -100, 100));
  const label = score >= 25 ? "Risk-on" : score <= -25 ? "Risk-off" : "Neutral";
  const advice =
    label === "Risk-on"
      ? "Conditions favour overnight and swing longs. Take the best-scoring setups; shorts need a clear breakdown."
      : label === "Neutral"
        ? "Mixed conditions. Be selective on both sides: top scores only, fewer positions."
        : "Conditions are against long trades. Avoid overnight longs; short setups and cash are the better side.";
  const tiles = Object.entries(MACRO)
    .filter(([s]) => macro.has(s))
    .map(([s, name]) => ({ name, sym: s, last: r2(last(s)), chg: r2(chg(s)), chg5: r2(chg(s, 5)) }));
  const sectors = Object.entries(SECTORS)
    .filter(([s]) => macro.has(s))
    .map(([s, sector]) => ({ sector, chg: r2(chg(s)), chg5: r2(chg(s, 5)), chg20: r2(chg(s, 20)) }))
    .sort((a, b) => b.chg - a.chg);
  return { score, label, advice, components: comps, tiles, sectors, breadth, events: econ, fii };
}

function runBacktest(stocks: Stock[], idx: Record<IndexSym, Series>, vixList: [string, number][], fiiList: [string, number][], fo: Record<string, FoDay>, live: boolean): Backtest {
  const vixOn = new Map(vixList);
  const cut = live ? 2 : 1; // ignore the unfinished bar

  // ----- index futures overnight
  const index = (Object.keys(INDEX) as IndexSym[]).map((sym) => {
    const s = idx[sym];
    const rows: { date: string; s: number; ovn: number }[] = [];
    for (let i = 201; i < s.bars.length - cut; i++) {
      const d = s.bars[i].d;
      const f = indexFeatures(indexCtxAt(s, i, before(vixList, d) ?? 0, before(fiiList, d)), s.bars[i], vixOn.get(d) ?? null);
      rows.push({ date: d, s: indexScore(f).score, ovn: (s.bars[i + 1].o / s.bars[i].c - 1) * 100 });
    }
    const c = COST_FUT * 100;
    const long = (r: (typeof rows)[0]) => (r.s >= LONG_AT ? r.ovn - c : null);
    const short = (r: (typeof rows)[0]) => (r.s <= SHORT_AT ? -r.ovn - c : null);
    return {
      sym,
      name: INDEX[sym].name,
      from: rows[0].date,
      to: rows[rows.length - 1].date,
      rules: INDEX_RULES,
      variants: [
        variant(`Buy when score is ${LONG_AT}+`, rows.map((r) => ({ date: r.date, v: long(r) }))),
        variant(`Sell short when score is ${SHORT_AT} or lower`, rows.map((r) => ({ date: r.date, v: short(r) }))),
        variant("Both sides", rows.map((r) => ({ date: r.date, v: long(r) ?? short(r) }))),
        variant("Baseline: buy every night", rows.map((r) => ({ date: r.date, v: r.ovn - c }))),
      ],
      buckets: bucketize(rows.map((r) => ({ s: r.s, v: r.ovn })), [["-60 or lower", -101, -59.999], ["-60 to -30 (short zone)", -59.999, SHORT_AT + 0.001],["-30 to 0", SHORT_AT + 0.001, 0], ["0 to 30", 0, LONG_AT], ["30 to 60 (buy zone)", LONG_AT, 60], ["60 and above", 60, 101]]),
      byYear: byYear(rows.filter((r) => r.s >= LONG_AT).map((r) => ({ date: r.date, v: r.ovn - c }))),
    };
  });

  // ----- stock BTST
  const cal = idx.NIFTY.bars.map((b) => b.d);
  const niftyScore = new Map<string, number>();
  {
    const s = idx.NIFTY;
    for (let i = 201; i < s.bars.length; i++) {
      const d = s.bars[i].d;
      niftyScore.set(d, indexScore(indexFeatures(indexCtxAt(s, i, before(vixList, d) ?? 0, before(fiiList, d)), s.bars[i], vixOn.get(d) ?? null)).score);
    }
  }
  type Day = { date: string; top: number[]; all: number[]; mkt: number; sell: number[]; conv: number[]; convSell: number[] };
  const days: Day[] = [];
  const scored: { s: number; v: number }[] = [];
  for (let t = 201; t < cal.length - cut; t++) {
    const date = cal[t];
    const inputs: BtstInput[] = [];
    const nextOpen = new Map<string, number>();
    for (const s of stocks) {
      const i = s.idxOf.get(date);
      if (i == null || i < 201 || i + 1 >= s.bars.length) continue;
      if (Math.abs(s.bars[i + 1].o / s.bars[i].c - 1) * 100 > MAX_GAP) continue;
      inputs.push({ sym: s.sym, name: "", sector: s.sector, ctx: ctxAt(s.bars, s.pre, i), bar: s.bars[i] });
      nextOpen.set(s.sym, s.bars[i + 1].o);
    }
    if (inputs.length < 25) continue;
    const rows = scoreBtstDay(inputs);
    const gross = (r: BtstRow) => (nextOpen.get(r.sym)! / r.price - 1) * 100;
    const short = (r: BtstRow) => -gross(r);
    for (const r of rows) scored.push({ s: r.score, v: gross(r) });
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    days.push({
      date,
      top: sorted.filter((r) => r.score >= 65).slice(0, 3).map(gross),
      all: rows.map(gross),
      mkt: niftyScore.get(date) ?? 0,
      sell: sorted.filter((r) => r.score <= SELL_MAX).slice(-3).map(short),
      conv: rows.filter(momentumClose).sort((a, b) => b.chg - a.chg).slice(0, 3).map(gross),
      convSell: rows.filter(weakClose).sort((a, b) => a.chg - b.chg).slice(0, 3).map(short),
    });
  }
  const dayVar = (name: string, pick: (d: Day) => number[], cost: number) => {
    const v = variant(name, days.map((d) => { const p = pick(d); return { date: d.date, v: p.length ? mean(p) - cost * 100 : null }; }));
    const trades = days.flatMap((d) => pick(d).map((x) => x - cost * 100));
    return { ...v, stats: { ...stats(trades), total: v.stats.total, maxDD: v.stats.maxDD } };
  };
  const btst = {
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    rules: BTST_RULES,
    variants: [
      dayVar("Top 3 scoring 65+, via stock futures (0.06% cost)", (d) => d.top, COST_FUT),
      dayVar("Same, only when the Nifty overnight score is above 0", (d) => (d.mkt > 0 ? d.top : []), COST_FUT),
      dayVar("Top 3 scoring 65+, via delivery shares (0.25% cost)", (d) => d.top, COST_CASH),
      dayVar("Baseline: every F&O stock every night (futures cost)", (d) => [mean(d.all)], COST_FUT),
    ],
    sell: [
      dayVar(`Sell the 3 lowest scores (${SELL_MAX} or less) at the close, buy back at the open`, (d) => d.sell, COST_FUT),
      dayVar(`Same, only when the Nifty overnight score is ${SHORT_AT} or lower`, (d) => (d.mkt <= SHORT_AT ? d.sell : []), COST_FUT),
    ],
    conventional: [
      dayVar("Textbook BTST: up 2%+, close at the high, 1.5x volume, 20-day high (top 3 by gain)", (d) => d.conv, COST_FUT),
      dayVar("Textbook STBT: down 2%+, close at the low, 1.5x volume, below 20/50-day averages (short)", (d) => d.convSell, COST_FUT),
      dayVar(`Textbook STBT, only when the Nifty overnight score is ${SHORT_AT} or lower`, (d) => (d.mkt <= SHORT_AT ? d.convSell : []), COST_FUT),
    ],
    buckets: bucketize(scored, [["Score under 30", -1, 30], ["30 to 45", 30, 45], ["45 to 55", 45, 55], ["55 to 65", 55, 65], ["65 to 75", 65, 75], ["75 and above", 75, 101]]),
    byYear: byYear(days.flatMap((d) => d.top.map((v) => ({ date: d.date, v: v - COST_FUT * 100 })))).map((y) => ({ ...y, total: r2(y.total / 3) })),
    conventionalByYear: byYear(days.flatMap((d) => d.conv.map((v) => ({ date: d.date, v: v - COST_FUT * 100 })))).map((y) => ({ ...y, total: r2(y.total / 3) })),
  };

  // ----- swing (stocks and indices)
  type Tr = { exit: string; r: number; pct: number; days: number; index: boolean; withTrend: boolean };
  const trades = Object.fromEntries(SETUPS.map((k) => [k, [] as Tr[]])) as Record<SwingSetup, Tr[]>;
  const nUp = new Map(idx.NIFTY.bars.map((b, j) => [b.d, b.c > idx.NIFTY.pre.sma200[j]]));
  const run = (s: Series, isIndex: boolean) => {
    const busy = Object.fromEntries(SETUPS.map((k) => [k, -1])) as Record<SwingSetup, number>;
    for (let i = 260; i < s.bars.length - cut; i++) {
      for (const sig of detectSwing(s.bars, s.pre, i, 1, isIndex)) {
        if (i <= busy[sig.setup]) continue;
        const tr = simulate(s.bars, sig, COST_FUT);
        if (!tr) continue;
        busy[sig.setup] = tr.exitIdx;
        const up = nUp.get(s.bars[i].d) ?? true;
        trades[sig.setup].push({ exit: tr.exitDate, r: tr.r, pct: tr.pct, days: tr.days, index: isIndex, withTrend: sig.dir === 1 ? up : !up });
      }
    }
  };
  const recentFrom = `${Number(cal[cal.length - 1].slice(0, 4)) - 1}`;
  for (const s of stocks) run(s, false);
  for (const k of Object.keys(idx) as IndexSym[]) run(idx[k], true);
  const swing = SETUPS.map((setup) => {
    const tr = trades[setup].sort((a, b) => a.exit.localeCompare(b.exit));
    let eq = 0;
    return {
      setup,
      dir: SWING_DIR[setup],
      rules: SWING_RULES[setup],
      stocks: stats(tr.filter((t) => !t.index).map((t) => t.r)),
      index: stats(tr.filter((t) => t.index).map((t) => t.r)),
      withTrend: stats(tr.filter((t) => !t.index && t.withTrend).map((t) => t.r)),
      againstTrend: stats(tr.filter((t) => !t.index && !t.withTrend).map((t) => t.r)),
      recent: stats(tr.filter((t) => !t.index && t.exit >= recentFrom).map((t) => t.r)),
      avgHold: r2(mean(tr.map((t) => t.days))),
      avgPct: r2(mean(tr.map((t) => t.pct))),
      curve: downsample(tr.map((t) => [t.exit, r2((eq += t.r))] as [string, number])),
      byYear: byYear(tr.map((t) => ({ date: t.exit, v: t.r }))),
    };
  });

  // ----- does the option put/call ratio say anything about the next night? (only as much history as is cached)
  let options: Backtest["options"] = null;
  const s = idx.NIFTY;
  const pcrRows: { date: string; s: number; v: number }[] = [];
  for (const d of Object.keys(fo).sort()) {
    const i = s.idxOf.get(d);
    const x = fo[d].index.NIFTY;
    // the file for day d is published after the close, so it can only inform the NEXT day's close-to-open trade
    if (i == null || !x?.pcr || i + 2 >= s.bars.length) continue;
    pcrRows.push({ date: d, s: x.pcr, v: (s.bars[i + 2].o / s.bars[i + 1].c - 1) * 100 });
  }
  if (pcrRows.length >= 60) {
    const sorted = [...pcrRows].sort((a, b) => a.s - b.s);
    const t = Math.floor(sorted.length / 3);
    const lo = sorted[t].s;
    const hi = sorted[2 * t].s;
    options = {
      days: pcrRows.length,
      from: pcrRows[0].date,
      to: pcrRows[pcrRows.length - 1].date,
      rows: bucketize(pcrRows, [[`Low put/call ratio (under ${lo.toFixed(2)})`, 0, lo], [`Middle (${lo.toFixed(2)} to ${hi.toFixed(2)})`, lo, hi], [`High (above ${hi.toFixed(2)})`, hi, 99]]),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    caveats: [
      "Index rules are tested on the spot index (free futures history is not available). A future tracks the index closely, but its close and open differ slightly from the index's.",
      "Stock results use today's list of stocks with futures for the whole period (survivorship bias: stocks that fell out of the list are missing), which flatters long results and penalises short results.",
      `Overnight moves larger than ${MAX_GAP}% (demergers, bad ticks) are left out of the stock overnight tests.`,
      "Futures build-up, delivery percentage and the F&O ban list are shown as context only: the free history is too short to test them.",
      "Assumes you trade at the official close and the next official open. Real fills near 3:20 PM and at 9:15 AM will differ, and gaps can exceed any stop.",
      "Costs: 0.06% per round trip for futures, 0.25% for delivery shares. Taxes are not included.",
      "FII positioning is only in the score from August 2023 (as far back as the cached NSE files go).",
      "The score weights were chosen after studying this same period, so future results will probably be weaker. Past results do not predict future results.",
    ],
    index,
    btst,
    swing,
    options,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
