// Research harness: factor sorts behind the scoring weights. Not part of the scan.
// Run: SCAN_CACHE=1 npx tsx scripts/research.ts [overnight|swing|oi]
import { readFileSync } from "node:fs";
import { indexFeatures, indexScore } from "../src/lib/indexcall";
import { precompute, type Pre } from "../src/lib/indicators";
import type { Bar } from "../src/lib/types";
import { fetchChart, pool } from "./net";

type S = { sym: string; n50: boolean; bars: Bar[]; pre: Pre; idx: Map<string, number> };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f3 = (x: number) => (Number.isFinite(x) ? (x >= 0 ? " " : "") + x.toFixed(3) : "  n/a ");

export async function load() {
  const universe: { sym: string; n50?: boolean }[] = JSON.parse(readFileSync("data/universe.json", "utf8"));
  const mk = (sym: string, n50: boolean, bars: Bar[]): S => ({ sym, n50, bars, pre: precompute(bars), idx: new Map(bars.map((b, i) => [b.d, i])) });
  const nifty = mk("NIFTY", false, (await fetchChart("^NSEI", "10y")).bars);
  const vix = new Map((await fetchChart("^INDIAVIX", "10y")).bars.map((b) => [b.d, b.c]));
  const stocks = (
    await pool(universe, 6, async (u) => {
      try {
        const c = await fetchChart(`${u.sym}.NS`, "10y");
        return c.bars.length > 300 ? mk(u.sym, !!u.n50, c.bars) : null;
      } catch {
        return null;
      }
    })
  ).filter((x): x is S => !!x);
  return { nifty, vix, stocks };
}

export type Rec = { d: string; sym: string; n50: boolean; f: Record<string, number>; ovn: number; fwd5: number; fwd10: number; mkt: number; mktUp: number };

export function records(nifty: S, vix: Map<string, number>, stocks: S[]): Rec[] {
  // market regime per date
  const reg = new Map<string, { score: number; up200: number; up50: number; r20: number }>();
  const nb = nifty.bars;
  let vprev = 0;
  for (let i = 201; i < nb.length; i++) {
    const p = nifty.pre;
    const ctx = { prevClose: nb[i - 1].c, sum19: p.prefC[i] - p.prefC[i - 19], sum49: p.prefC[i] - p.prefC[i - 49], sum199: p.prefC[i] - p.prefC[i - 199], close5ago: nb[i - 5].c, avgGain: p.rsi.gain[i - 1], avgLoss: p.rsi.loss[i - 1], ovnSum19: p.prefOvn[i] - p.prefOvn[i - 19], vixPrev: vix.get(nb[i - 1].d) ?? vprev, fiiRatio: null };
    vprev = ctx.vixPrev;
    const sc = indexScore(indexFeatures(ctx, nb[i], vix.get(nb[i].d) ?? null)).score;
    reg.set(nb[i].d, { score: sc, up200: nb[i].c > p.sma200[i] ? 1 : 0, up50: nb[i].c > p.sma50[i] ? 1 : 0, r20: nb[i].c / nb[i - 20].c - 1 });
  }
  const out: Rec[] = [];
  for (const s of stocks) {
    const { bars: b, pre: p } = s;
    for (let i = 260; i < b.length - 11; i++) {
      const r = reg.get(b[i].d);
      if (!r) continue;
      const c = b[i].c;
      const ovn = (b[i + 1].o / c - 1) * 100;
      if (Math.abs(ovn) > 15) continue; // demergers and bad ticks
      let hi250 = 0;
      let hi20 = 0;
      let lo20 = Infinity;
      for (let j = i - 250; j < i; j++) hi250 = Math.max(hi250, b[j].h);
      for (let j = i - 20; j < i; j++) (hi20 = Math.max(hi20, b[j].h)), (lo20 = Math.min(lo20, b[j].l));
      const avgVol = (p.prefV[i] - p.prefV[i - 20]) / 20;
      out.push({
        d: b[i].d,
        sym: s.sym,
        n50: s.n50,
        ovn,
        fwd5: (b[i + 5].c / b[i + 1].o - 1) * 100,
        fwd10: (b[i + 10].c / b[i + 1].o - 1) * 100,
        mkt: r.score,
        mktUp: r.up200,
        f: {
          chg: (c / b[i - 1].c - 1) * 100,
          intraday: (c / b[i].o - 1) * 100,
          gap: (b[i].o / b[i - 1].c - 1) * 100,
          clv: b[i].h > b[i].l ? (c - b[i].l) / (b[i].h - b[i].l) : 0.5,
          rvol: avgVol > 0 ? b[i].v / avgVol : 1,
          atrPct: (p.atr[i] / c) * 100,
          ovn60: (p.prefOvn[i + 1] - p.prefOvn[i - 59]) * 100,
          intr20: (p.prefIntr[i + 1] - p.prefIntr[i - 19]) * 100,
          rsi: p.rsi.rsi[i],
          ret5: (c / b[i - 5].c - 1) * 100,
          ret20: (c / b[i - 20].c - 1) * 100,
          ret60: (c / b[i - 60].c - 1) * 100,
          ret250: (c / b[i - 250].c - 1) * 100,
          rs20: (c / b[i - 20].c - 1) * 100 - r.r20 * 100,
          dist52: (c / hi250 - 1) * 100,
          vs20h: (c / hi20 - 1) * 100,
          vs20l: (c / lo20 - 1) * 100,
          vs50: (c / p.sma50[i] - 1) * 100,
          vs200: (c / p.sma200[i] - 1) * 100,
        },
      });
    }
  }
  return out;
}

/** Cross-sectional quintile sort per day; prints mean outcome per quintile for several sub-samples. */
function sort(recs: Rec[], key: string, outcome: (r: Rec) => number, label: string) {
  const byDay = new Map<string, Rec[]>();
  for (const r of recs) (byDay.get(r.d) ?? byDay.set(r.d, []).get(r.d)!).push(r);
  const q: number[][][] = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => [])); // sample x quintile
  for (const [d, rs] of byDay) {
    if (rs.length < 20) continue;
    rs.sort((a, b) => a.f[key] - b.f[key]);
    rs.forEach((r, k) => {
      const qi = Math.min(4, Math.floor((k / rs.length) * 5));
      const v = outcome(r);
      q[0][qi].push(v);
      q[d < "2022-01-01" ? 1 : 2][qi].push(v);
      if (d >= "2025-01-01") q[3][qi].push(v);
    });
  }
  console.log(`${(key + " -> " + label).padEnd(22)} all: ${q[0].map((x) => f3(mean(x))).join(" ")} | <2022: ${q[1].map((x) => f3(mean(x))).join(" ")} | 2022+: ${q[2].map((x) => f3(mean(x))).join(" ")} | 2025+: ${q[3].map((x) => f3(mean(x))).join(" ")}`);
}

export function rule(recs: Rec[], name: string, pick: (r: Rec) => boolean, outcome: (r: Rec) => number, cost: number) {
  const sel = recs.filter(pick);
  const part = (a: Rec[]) => {
    const v = a.map((r) => outcome(r) - cost);
    return `${String(v.length).padStart(6)} ${f3(mean(v))} ${(100 * v.filter((x) => x > 0).length / Math.max(1, v.length)).toFixed(0)}%`;
  };
  console.log(`${name.padEnd(58)} all ${part(sel)} | <2022 ${part(sel.filter((r) => r.d < "2022-01-01"))} | 2022-24 ${part(sel.filter((r) => r.d >= "2022-01-01" && r.d < "2025-01-01"))} | 2025+ ${part(sel.filter((r) => r.d >= "2025-01-01"))}`);
}

async function main() {
  const mode = process.argv[2] ?? "overnight";
  const { nifty, vix, stocks } = await load();
  const recs = records(nifty, vix, stocks);
  console.log(`${stocks.length} stocks, ${recs.length} stock-days, ${recs[0].d}..`);
  const keys = Object.keys(recs[0].f);
  if (mode === "overnight") {
    console.log("mean next overnight return % by cross-sectional quintile (low .. high)");
    for (const k of keys) sort(recs, k, (r) => r.ovn, "ovn");
    console.log("\n-- in weak markets only (Nifty overnight score <= -30)");
    for (const k of keys) sort(recs.filter((r) => r.mkt <= -30), k, (r) => r.ovn, "ovn");
    console.log("\n-- Nifty below its 200-day average");
    for (const k of keys) sort(recs.filter((r) => !r.mktUp), k, (r) => r.ovn, "ovn");
  } else if (mode === "swing") {
    console.log("mean forward return %, next open to close 5 / 10 sessions later, by quintile");
    for (const k of keys) sort(recs, k, (r) => r.fwd5, "5d");
    for (const k of keys) sort(recs, k, (r) => r.fwd10, "10d");
    console.log("\n-- Nifty below its 200-day average");
    for (const k of keys) sort(recs.filter((r) => !r.mktUp), k, (r) => r.fwd10, "10d");
  }
}
if (/research.ts$/.test(process.argv[1] ?? "")) main();

