import { rsiFrom } from "./indicators";
import type { IndexCtx, IndexFeatures, IndexScore } from "./types";

// Overnight (BTST) score for Nifty / Bank Nifty futures, -100..+100.
// Built from what ~9 years of index data showed for the close -> next-open move (scripts/research.ts):
// a strong close (up from the open, near the day's high), a falling India VIX, a short-term uptrend
// and a recent habit of gapping up all led to better nights; FII index-futures positioning helped too.
// Weak closes did NOT reliably lead to down nights, so a low score means "no trade" far more often
// than "short" (see the backtest for what the short bucket actually did).
export const INDEX_PARTS: Record<string, { label: string; max: number }> = {
  strength: { label: "Close strength (open-to-close move, close near day high)", max: 40 },
  vix: { label: "India VIX change today (falling is good)", max: 15 },
  trend: { label: "Short-term trend (vs 20-day average, 5-day move)", max: 20 },
  habit: { label: "Recent overnight gaps (last 20 nights)", max: 10 },
  fii: { label: "FII index-futures positioning (previous day)", max: 15 },
};
export const LONG_AT = 30;
export const SHORT_AT = -30;

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

export function indexFeatures(ctx: IndexCtx, bar: { o?: number; h?: number; l?: number; c: number }, vixNow: number | null): IndexFeatures {
  const c = bar.c;
  const hasOpen = bar.o != null && bar.o > 0;
  const d = c - ctx.prevClose;
  const g = (ctx.avgGain * 13 + Math.max(d, 0)) / 14;
  const l = (ctx.avgLoss * 13 + Math.max(-d, 0)) / 14;
  return {
    price: c,
    dayChg: (c / ctx.prevClose - 1) * 100,
    intraday: hasOpen ? (c / bar.o! - 1) * 100 : null,
    clv: bar.h != null && bar.l != null && bar.h > bar.l ? Math.max(0, Math.min(1, (c - bar.l) / (bar.h - bar.l))) : null,
    vixChg: vixNow != null && ctx.vixPrev > 0 ? (vixNow / ctx.vixPrev - 1) * 100 : null,
    vix: vixNow,
    dist20: (c / ((ctx.sum19 + c) / 20) - 1) * 100,
    ret5: (c / ctx.close5ago - 1) * 100,
    ovn20: (hasOpen ? ctx.ovnSum19 + (bar.o! / ctx.prevClose - 1) : (ctx.ovnSum19 * 20) / 19) * 100,
    fiiRatio: ctx.fiiRatio,
    rsi: rsiFrom(g, l),
    above50: c > (ctx.sum49 + c) / 50,
    above200: c > (ctx.sum199 + c) / 200,
  };
}

export function indexScore(f: IndexFeatures): IndexScore {
  const parts: Record<string, number> = {};
  let max = 0;
  const add = (k: string, v: number | null) => {
    if (v == null || !Number.isFinite(v)) return;
    parts[k] = Math.round(v * 10) / 10;
    max += INDEX_PARTS[k].max;
  };
  // without the open/high/low (thin uploads) fall back to the day change
  const move = f.intraday ?? f.dayChg;
  add("strength", 20 * clamp(move / 0.6) + 20 * clamp(((f.clv ?? (move > 0 ? 0.7 : 0.3)) - 0.5) / 0.4));
  add("vix", f.vixChg == null ? null : -15 * clamp(f.vixChg / 5));
  add("trend", 10 * clamp(f.dist20 / 1.5) + 10 * clamp(f.ret5 / 2));
  add("habit", 10 * clamp((f.ovn20 - 1.5) / 2));
  add("fii", f.fiiRatio == null ? null : 15 * clamp((f.fiiRatio - 0.4) / 0.15));
  const raw = Object.values(parts).reduce((a, v) => a + v, 0);
  const score = max ? Math.round((raw / max) * 100) : 0;
  return { score, parts, call: score >= LONG_AT ? "LONG" : score <= SHORT_AT ? "SHORT" : "NONE" };
}

export const INDEX_RULES =
  `Score -100 to +100 at the close: close strength (40), India VIX change today (15), short-term trend (20), recent overnight gaps (10), ` +
  `FII index-futures positioning (15). Buy futures at the close when the score is ${LONG_AT}+ and sell at the next open; ` +
  `the short side triggers at ${SHORT_AT} or lower. Tested on the spot index, which the future tracks closely.`;
