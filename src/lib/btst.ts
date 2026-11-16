import { rsiFrom } from "./indicators";
import type { BtstInput, BtstRow } from "./types";

// F&O stocks (every stock with futures), buy at the close and sell at the next open.
// Weights follow what ~9 years of this universe showed (research during the build), consistently in both halves:
// stocks that habitually gap up, that trade weak during the day, that closed near the day's low,
// volatile names and unusually active names earned the most overnight.
// No overnight SHORT list exists on purpose: even the weakest group rose overnight on average.
export const BTST_WEIGHTS = { overnight: 25, intraday: 20, dip: 20, volatility: 20, volume: 15 };
/** Stocks scoring this or less form the overnight sell (STBT) watch list. */
export const SELL_MAX = 25;
export const BTST_PARTS: Record<string, string> = {
  overnight: "Habit of gapping up (last 60 nights)",
  intraday: "Weak during the day (last 20 sessions)",
  dip: "Closed in the lower part of today's range",
  volatility: "Volatility rank (bigger movers earn more overnight)",
  volume: "Unusually active today",
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function ranker(vals: number[]): (v: number) => number {
  const s = [...vals].sort((a, b) => a - b);
  return (v) => {
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < v) lo = m + 1;
      else hi = m;
    }
    return s.length > 1 ? lo / (s.length - 1) : 0.5;
  };
}

/**
 * Score every stock for one day. Cross-sectional (ranks are computed inside the supplied
 * universe), so pass the whole universe. `volFrac` = fraction of the session elapsed
 * (1 after the close); used to project partial-day volume to a full day.
 */
export function scoreBtstDay(inputs: BtstInput[], volFrac = 1): BtstRow[] {
  const frac = Math.max(0.1, Math.min(1, volFrac));
  const base = inputs
    .filter((x) => x.bar.c > 0 && x.ctx.prevClose > 0)
    .map((x) => {
      const { ctx, bar } = x;
      const c = bar.c;
      const chg = (c / ctx.prevClose - 1) * 100;
      const hasRange = bar.h != null && bar.l != null && bar.h >= bar.l;
      const clv = hasRange ? (bar.h! > bar.l! ? clamp01((c - bar.l!) / (bar.h! - bar.l!)) : 0.5) : null;
      const rvol = bar.v != null && ctx.avgVol20 > 0 ? bar.v / frac / ctx.avgVol20 : null;
      const d = c - ctx.prevClose;
      const g = (ctx.avgGain * 13 + Math.max(d, 0)) / 14;
      const l = (ctx.avgLoss * 13 + Math.max(-d, 0)) / 14;
      const hasOpen = bar.o != null && bar.o > 0;
      return {
        x,
        c,
        chg,
        clv,
        rvol,
        intraday: hasOpen ? (c / bar.o! - 1) * 100 : null,
        // without today's open, fall back to scaling the prior-days sums to the full window
        ovn60: (hasOpen ? ctx.ovnSum59 + (bar.o! / ctx.prevClose - 1) : (ctx.ovnSum59 * 60) / 59) * 100,
        intr20: (hasOpen ? ctx.intrSum19 + (c / bar.o! - 1) : (ctx.intrSum19 * 20) / 19) * 100,
        atrPct: (ctx.atr14 / c) * 100,
        rsi: rsiFrom(g, l),
        ret20: (c / ctx.close20ago - 1) * 100,
        sma20: (ctx.sum19 + c) / 20,
        sma50: (ctx.sum49 + c) / 50,
        sma200: (ctx.sum199 + c) / 200,
      };
    });

  const atrPct = ranker(base.map((b) => b.atrPct));
  const ovnPct = ranker(base.map((b) => b.ovn60));
  const intrPct = ranker(base.map((b) => b.intr20));
  const volPct = ranker(base.map((b) => b.rvol ?? 1));
  const dayPct = ranker(base.map((b) => b.intraday ?? b.chg));

  const W = BTST_WEIGHTS;
  return base.map((b) => {
    const { x, c } = b;
    const atrRank = atrPct(b.atrPct);
    const ovnRank = ovnPct(b.ovn60);
    const intrRank = intrPct(b.intr20);
    const parts: Record<string, number> = {};
    parts.overnight = W.overnight * clamp01((ovnRank - 0.3) / 0.6);
    parts.intraday = W.intraday * clamp01((0.7 - intrRank) / 0.6);
    // close location when we have the range, otherwise today's move ranked against the universe
    parts.dip = W.dip * (b.clv != null ? clamp01((0.6 - b.clv) / 0.5) : clamp01((0.6 - dayPct(b.intraday ?? b.chg)) / 0.5));
    parts.volatility = W.volatility * clamp01((atrRank - 0.3) / 0.6);
    let max = W.overnight + W.intraday + W.dip + W.volatility;
    if (b.rvol != null) {
      parts.volume = W.volume * clamp01((volPct(b.rvol) - 0.3) / 0.6);
      max += W.volume;
    }
    const raw = Object.values(parts).reduce((a, v) => a + v, 0);
    for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;
    return {
      sym: x.sym,
      name: x.name,
      sector: x.sector,
      price: c,
      chg: b.chg,
      clv: b.clv,
      rvol: b.rvol,
      rsi: b.rsi,
      above20: c > b.sma20,
      above50: c > b.sma50,
      above200: c > b.sma200,
      ret20: b.ret20,
      distHigh: (x.ctx.high20 / c - 1) * 100,
      intraday: b.intraday,
      ovn60: b.ovn60,
      intr20: b.intr20,
      atrRank,
      ovnRank,
      intrRank,
      atrPct: b.atrPct,
      score: Math.round((raw / max) * 1000) / 10,
      parts,
    };
  });
}

export const BTST_RULES =
  "Buy at the close, sell at the next open. Score 0-100: habit of gapping up over the last 60 nights (25), weak intraday trading over the " +
  "last 20 sessions (20), closing in the lower part of today's range (20), volatility rank (20) and unusually high volume today (15). " +
  "Ranks are within the stocks that have futures (about 200).";
