// Research: candidate swing setups and filters. Run: SCAN_CACHE=1 npx tsx scripts/research2.ts
import { readFileSync, readdirSync } from "node:fs";
import { ema, sma } from "../src/lib/indicators";
import { detectSwing, simulate, type RawSignal } from "../src/lib/swing";
import type { Bar } from "../src/lib/types";
import { load } from "./research";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function rsi2(c: number[]): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let g = 0;
  let l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g + Math.max(d, 0)) / 2;
    l = (l + Math.max(-d, 0)) / 2;
    if (i > 5) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function supertrend(b: Bar[], atr: number[], m = 3): { line: number[]; dir: number[] } {
  const line = new Array<number>(b.length).fill(NaN);
  const dir = new Array<number>(b.length).fill(0);
  let up = NaN;
  let dn = NaN;
  let d = 1;
  for (let i = 15; i < b.length; i++) {
    const mid = (b[i].h + b[i].l) / 2;
    const bu = mid - m * atr[i];
    const bd = mid + m * atr[i];
    up = !Number.isFinite(up) || b[i - 1].c < up ? bu : Math.max(bu, up);
    dn = !Number.isFinite(dn) || b[i - 1].c > dn ? bd : Math.min(bd, dn);
    if (d === 1 && b[i].c < up) d = -1;
    else if (d === -1 && b[i].c > dn) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? up : dn;
  }
  return { line, dir };
}

type Tr = { setup: string; d: string; r: number; pct: number; rs: number; mktUp50: boolean; mktUp200: boolean; bu: number | null; index: boolean; days: number };

async function main() {
  const { nifty, stocks } = await load();
  // RS rank: 250-day return percentile within the universe, per date
  const byDate = new Map<string, number[]>();
  for (const s of stocks)
    for (let i = 250; i < s.bars.length; i++) {
      const d = s.bars[i].d;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(s.bars[i].c / s.bars[i - 250].c);
    }
  for (const v of byDate.values()) v.sort((a, b) => a - b);
  const rank = (d: string, x: number) => {
    const v = byDate.get(d)!;
    let k = 0;
    while (k < v.length && v[k] < x) k++;
    return k / Math.max(1, v.length - 1);
  };
  const nReg = new Map(nifty.bars.map((b, i) => [b.d, { up50: b.c > nifty.pre.sma50[i], up200: b.c > nifty.pre.sma200[i] }]));
  // futures build-up on the signal day (the file is out that evening, before the next-open entry)
  const fo = new Map<string, Record<string, { futClose: number; futPrev: number; oi: number; oiChg: number }>>();
  for (const f of readdirSync("cache/fo")) {
    const j = JSON.parse(readFileSync("cache/fo/" + f, "utf8"));
    if (j.stocks) fo.set(j.date, j.stocks);
  }
  const buOf = (d: string, sym: string): number | null => {
    const x = fo.get(d)?.[sym];
    if (!x) return null;
    const base = x.oi - x.oiChg;
    const oc = base > 0 ? (x.oiChg / base) * 100 : 0;
    if (Math.abs(oc) < 1) return 0;
    const up = x.futClose >= x.futPrev;
    return up ? (oc > 0 ? 2 : 1) : oc > 0 ? -2 : -1; // 2 long build-up, 1 short covering, -2 short build-up, -1 long unwinding
  };

  const trades: Tr[] = [];
  const all = [...stocks.map((s) => ({ s, index: false })), { s: nifty, index: true }];
  for (const { s, index } of all) {
    const { bars: b, pre: p } = s;
    const c = p.closes;
    const r2 = rsi2(c);
    const st = supertrend(b, p.atr);
    const e12 = ema(c, 12);
    const e26 = ema(c, 26);
    const macd = c.map((_, i) => e12[i] - e26[i]);
    const sig = ema(macd.map((x) => (Number.isFinite(x) ? x : 0)), 9);
    const s20 = sma(c, 20);
    const sd20 = c.map((_, i) => {
      if (i < 19) return NaN;
      let v = 0;
      for (let j = i - 19; j <= i; j++) v += (c[j] - s20[i]) ** 2;
      return Math.sqrt(v / 20);
    });
    const bw = c.map((_, i) => (4 * sd20[i]) / s20[i]);
    const busy: Record<string, number> = {};
    for (let i = 260; i < b.length - 1; i++) {
      const a = p.atr[i];
      const cands: (RawSignal & { name: string })[] = detectSwing(b, p, i, 1, index).map((x) => ({ ...x, name: x.setup as string }));
      const add = (name: string, dir: 1 | -1, stop: number, rMult: number, holdDays: number, exitCross5 = false) => cands.push({ name, setup: "pullback", dir, i, stop, rMult, holdDays, rvol: 1, note: "", exitCross5 });
      const avgVol = (p.prefV[i] - p.prefV[i - 20]) / 20;
      const rvol = index ? 9 : avgVol > 0 ? b[i].v / avgVol : 0;
      const clv = b[i].h > b[i].l ? (c[i] - b[i].l) / (b[i].h - b[i].l) : 0.5;
      let hi250 = 0;
      let hi20 = 0;
      let lo20 = Infinity;
      let lo250 = Infinity;
      for (let j = i - 250; j < i; j++) {
        hi250 = Math.max(hi250, b[j].h);
        lo250 = Math.min(lo250, b[j].l);
      }
      for (let j = i - 20; j < i; j++) {
        hi20 = Math.max(hi20, b[j].h);
        lo20 = Math.min(lo20, b[j].l);
      }
      const s200 = p.sma200[i];
      const s50 = p.sma50[i];
      // 52-week high breakout / low breakdown
      if (c[i] > hi250 && c[i - 1] <= hi250 && rvol >= 1.5 && clv >= 0.6) add("hi52", 1, c[i] - 2 * a, 2, 20);
      if (c[i] < lo250 && c[i - 1] >= lo250 && rvol >= 1.5 && clv <= 0.4) add("lo52_down", -1, c[i] + 2 * a, 2, 20);
      // Connors RSI(2)
      if (c[i] > s200 && r2[i] < 10) add("rsi2", 1, c[i] - 2.5 * a, 3, 7, true);
      if (c[i] > s200 && r2[i] < 5 && c[i] > s50) add("rsi2_strict", 1, c[i] - 2.5 * a, 3, 7, true);
      if (c[i] < s200 && r2[i] > 90) add("rsi2_short", -1, c[i] + 2.5 * a, 3, 7, true);
      if (c[i] < s200 && c[i] < s50 && r2[i] > 95) add("rsi2_short_strict", -1, c[i] + 2.5 * a, 3, 7, true);
      // Supertrend flips with the long-term trend
      if (st.dir[i] === 1 && st.dir[i - 1] === -1 && c[i] > s200) add("st_up", 1, Math.max(st.line[i], c[i] - 2.5 * a), 2, 15);
      if (st.dir[i] === -1 && st.dir[i - 1] === 1 && c[i] < s200) add("st_down", -1, Math.min(st.line[i], c[i] + 2.5 * a), 2, 15);
      // MACD cross
      if (macd[i] > sig[i] && macd[i - 1] <= sig[i - 1] && c[i] > s200 && macd[i] < 0) add("macd_up", 1, c[i] - 2 * a, 2, 15);
      if (macd[i] < sig[i] && macd[i - 1] >= sig[i - 1] && c[i] < s200 && macd[i] > 0) add("macd_down", -1, c[i] + 2 * a, 2, 15);
      // NR7 breakout in trend
      const rng = (j: number) => b[j].h - b[j].l;
      let nr7 = true;
      for (let j = i - 7; j < i - 1; j++) if (rng(j) <= rng(i - 1)) nr7 = false;
      if (nr7 && c[i] > b[i - 1].h && c[i] > s50 && s50 > s200) add("nr7_up", 1, Math.min(b[i - 1].l, c[i] - 0.75 * a), 2, 7);
      if (nr7 && c[i] < b[i - 1].l && c[i] < s50 && s50 < s200) add("nr7_down", -1, Math.max(b[i - 1].h, c[i] + 0.75 * a), 2, 7);
      // Bollinger squeeze breakout
      let minBw = Infinity;
      for (let j = i - 120; j < i - 5; j++) minBw = Math.min(minBw, bw[j]);
      let sq = false;
      for (let j = i - 5; j < i; j++) if (bw[j] <= minBw * 1.05) sq = true;
      if (sq && c[i] > s20[i] + 2 * sd20[i] && c[i] > s200 && rvol >= 1.3) add("squeeze_up", 1, c[i] - 1.5 * a, 2, 15);
      if (sq && c[i] < s20[i] - 2 * sd20[i] && c[i] < s200 && rvol >= 1.3) add("squeeze_down", -1, c[i] + 1.5 * a, 2, 15);
      // 20-day breakout / breakdown (Donchian), trend-aligned
      if (c[i] > hi20 && c[i - 1] <= hi20 && c[i] > s50 && s50 > s200 && rvol >= 1.5) add("don20_up", 1, c[i] - 2 * a, 2, 10);
      if (c[i] < lo20 && c[i - 1] >= lo20 && c[i] < s50 && s50 < s200 && rvol >= 1.5) add("don20_down", -1, c[i] + 2 * a, 2, 10);
      // overbought rally below the 200-day average
      if (c[i] < s200 && c[i] > c[i - 1] && c[i - 1] > c[i - 2] && c[i - 2] > c[i - 3] && p.rsi.rsi[i] > 60) add("up3_short", -1, c[i] + 2.5 * a, 3, 7, true);

      if (!cands.length) continue;
      const rs = index ? 0.5 : rank(b[i].d, c[i] / c[i - 250]);
      const reg = nReg.get(b[i].d);
      for (const x of cands) {
        if (i <= (busy[x.name] ?? -1)) continue;
        const tr = simulate(b, x, 0.0006);
        if (!tr) continue;
        busy[x.name] = tr.exitIdx;
        trades.push({ setup: x.name, d: b[i].d, r: tr.r, pct: tr.pct, rs, mktUp50: !!reg?.up50, mktUp200: !!reg?.up200, bu: index ? null : buOf(b[i].d, s.sym), index, days: tr.days });
      }
    }
  }
  const line = (name: string, t: Tr[]) => {
    const part = (a: Tr[]) => `${String(a.length).padStart(5)} ${mean(a.map((x) => x.r)).toFixed(3).padStart(6)}R ${mean(a.map((x) => x.pct)).toFixed(2).padStart(5)}% ${((100 * a.filter((x) => x.r > 0).length) / Math.max(1, a.length)).toFixed(0)}%`;
    console.log(`${name.padEnd(30)} all ${part(t)} | <2022 ${part(t.filter((x) => x.d < "2022"))} | 22-24 ${part(t.filter((x) => x.d >= "2022" && x.d < "2025"))} | 2025+ ${part(t.filter((x) => x.d >= "2025"))}`);
  };
  const names = [...new Set(trades.map((t) => t.setup))];
  for (const n of names) {
    const t = trades.filter((x) => x.setup === n && !x.index);
    const short = ["breakdown", "fade"].includes(n) || /down|short/.test(n);
    console.log("");
    line(n, t);
    line("  index (Nifty)", trades.filter((x) => x.setup === n && x.index));
    line("  RS top 30%", t.filter((x) => x.rs >= 0.7));
    line("  RS bottom 30%", t.filter((x) => x.rs <= 0.3));
    line("  Nifty > 50d", t.filter((x) => x.mktUp50));
    line("  Nifty < 50d", t.filter((x) => !x.mktUp50));
    line("  Nifty < 200d", t.filter((x) => !x.mktUp200));
    const good = short ? [-2, -1] : [2, 1];
    line("  build-up agrees", t.filter((x) => x.bu != null && good.includes(x.bu)));
    line("  build-up fresh", t.filter((x) => x.bu === (short ? -2 : 2)));
    line("  build-up against", t.filter((x) => x.bu != null && x.bu !== 0 && !good.includes(x.bu)));
  }
}
main();
