import type { Pre } from "./indicators";
import type { Bar, SwingSetup } from "./types";

export type RawSignal = {
  setup: SwingSetup;
  dir: 1 | -1; // 1 = buy, -1 = sell short (futures)
  i: number;
  stop: number; // price level, based on the signal bar
  rMult: number; // target = entry + dir * rMult * |entry - stop|
  holdDays: number;
  rvol: number;
  note: string;
  exitCross5?: boolean; // also exit at the first close back across the 5-day average
};

export const SWING_RULES: Record<SwingSetup, string> = {
  bounce:
    "Oversold bounce (buy): above the 200-day average, down 3+ closes in a row with RSI under 35. Enter next open, " +
    "exit at the first close back above the 5-day average or after 7 sessions, stop 2.5 ATR below.",
  pullback:
    "Pullback (buy): uptrend (price > rising 50-day > 200-day) that made a 20-day high in the last 15 sessions, pulled back to the 20-day EMA " +
    "and turned up. Enter next open, stop under the pullback low, target 2x risk, exit after 10 sessions.",
  breakout:
    "Breakout (buy): uptrend closing above a tight 30-session base (depth under 20%) with a strong close" +
    " (and 1.5x volume for stocks). Enter next open, stop 1.5 ATR below, target 2x risk, exit after 15 sessions.",
  gap:
    "Catalyst gap (buy): opens 3%+ higher on 2x volume and holds the gap into the close, above the 50-day average. " +
    "Enter next open, stop under the gap-day low, target 2x risk, exit after 10 sessions.",
  breakdown:
    "Breakdown (short): downtrend (price < falling 50-day < 200-day) closing below a 30-session base with a weak close" +
    " (and 1.5x volume for stocks). Enter next open, stop 1.5 ATR above, target 2x risk, exit after 15 sessions.",
  high52:
    "52-week high breakout (buy): first close above the highest high of the last 250 sessions, in the top part of the day's range" +
    " (and 1.5x volume for stocks). Enter next open, stop 2 ATR below, target 2x risk, exit after 20 sessions.",
  supertrend:
    "Supertrend turn (buy): the Supertrend (14, 3) flips from down to up while price is above the 200-day average. " +
    "Enter next open, stop at the Supertrend line (at most 2.5 ATR away), target 2x risk, exit after 15 sessions.",
  macd:
    "MACD turn (buy): MACD (12, 26, 9) crosses above its signal line from below zero while price is above the 200-day average: " +
    "a dip in a long-term uptrend that is turning. Enter next open, stop 2 ATR below, target 2x risk, exit after 15 sessions.",
  stdown:
    "Supertrend turn (short): the Supertrend (14, 3) flips from up to down while price is below the 200-day average. " +
    "Enter next open, stop at the Supertrend line (at most 2.5 ATR away), target 2x risk, exit after 15 sessions.",
  fade:
    "Rally fade (short): downtrend that made a 20-day low in the last 15 sessions, bounced to the 20-day EMA and turned down. " +
    "Enter next open, stop above the bounce high, target 2x risk, exit after 10 sessions.",
};

export const SWING_LABEL: Record<SwingSetup, string> = {
  bounce: "Oversold bounce",
  pullback: "Pullback to 20 EMA",
  breakout: "Base breakout",
  gap: "Catalyst gap",
  breakdown: "Breakdown",
  fade: "Rally fade",
  high52: "52-week high breakout",
  supertrend: "Supertrend turn up",
  macd: "MACD turn up",
  stdown: "Supertrend turn down",
};
export const SWING_DIR: Record<SwingSetup, 1 | -1> = { bounce: 1, pullback: 1, breakout: 1, gap: 1, high52: 1, supertrend: 1, macd: 1, breakdown: -1, fade: -1, stdown: -1 };
export const SETUPS: SwingSetup[] = ["high52", "supertrend", "macd", "bounce", "pullback", "breakout", "gap", "stdown", "breakdown", "fade"];

/** Keep the risk (distance to the stop) between minAtr and maxAtr. */
function stopAt(close: number, raw: number, atr: number, dir: 1 | -1, minAtr = 0.75, maxAtr = 2.5): number {
  const risk = Math.max(minAtr * atr, Math.min(maxAtr * atr, dir * (close - raw)));
  return close - dir * risk;
}

/**
 * Detect setups completing on bar i (signal at the close of i, entry at the open of i+1).
 * `isIndex` skips the volume conditions (index volume is not meaningful).
 */
export function detectSwing(bars: Bar[], pre: Pre, i: number, volFrac = 1, isIndex = false): RawSignal[] {
  if (i < 260) return [];
  const b = bars[i];
  const p = bars[i - 1];
  const a = pre.atr[i];
  const s50 = pre.sma50[i];
  const s200 = pre.sma200[i];
  const e20 = pre.ema20[i];
  if (!(a > 0) || !(s200 > 0)) return [];
  const avgVol = (pre.prefV[i] - pre.prefV[i - 20]) / 20;
  const rvol = isIndex ? 1 : avgVol > 0 ? b.v / Math.max(0.1, volFrac) / avgVol : 0;
  const volOk = (x: number) => isIndex || rvol >= x;
  const clv = b.h > b.l ? (b.c - b.l) / (b.h - b.l) : 0.5;
  const rsi = pre.rsi.rsi[i];
  const up = b.c > s50 && s50 > s200 && s50 > pre.sma50[i - 10];
  const down = b.c < s50 && s50 < s200 && s50 < pre.sma50[i - 10];
  const out: RawSignal[] = [];

  let hh = 0;
  let ll = Infinity;
  for (let j = i - 30; j < i; j++) {
    if (bars[j].h > hh) hh = bars[j].h;
    if (bars[j].l < ll) ll = bars[j].l;
  }
  const depth = (hh - ll) / b.c;
  const dayChg = b.c / p.c - 1;
  const madeExtreme = (dir: 1 | -1) => {
    for (let j = i - 15; j <= i - 2; j++) {
      let ext = dir === 1 ? 0 : Infinity;
      for (let k = j - 20; k < j; k++) ext = dir === 1 ? Math.max(ext, bars[k].h) : Math.min(ext, bars[k].l);
      if (dir === 1 ? bars[j].h >= ext : bars[j].l <= ext) return true;
    }
    return false;
  };

  // --- catalyst gap (stocks only in practice)
  const gap = b.o / p.c - 1;
  if (!isIndex && gap >= 0.03 && rvol >= 2 && clv >= 0.5 && b.c >= b.o * 0.995 && b.c > s50) {
    out.push({ setup: "gap", dir: 1, i, stop: stopAt(b.c, b.l - 0.1 * a, a, 1), rMult: 2, holdDays: 10, rvol, note: `Gapped up ${(gap * 100).toFixed(1)}% on ${rvol.toFixed(1)}x volume and held` });
  }

  // --- oversold bounce
  if (b.c > s200 && rsi < 35 && b.c < p.c && p.c < bars[i - 2].c && bars[i - 2].c < bars[i - 3].c) {
    out.push({ setup: "bounce", dir: 1, i, stop: b.c - 2.5 * a, rMult: 3, holdDays: 7, rvol, exitCross5: true, note: `Down 3+ days to RSI ${rsi.toFixed(0)} while above the 200-day average` });
  }

  // --- 52-week high breakout
  let hi250 = 0;
  for (let j = i - 250; j < i; j++) if (bars[j].h > hi250) hi250 = bars[j].h;
  if (b.c > hi250 && p.c <= hi250 && volOk(1.5) && clv >= 0.6) {
    out.push({ setup: "high52", dir: 1, i, stop: b.c - 2 * a, rMult: 2, holdDays: 20, rvol, note: `First close above the 52-week high of ${hi250.toFixed(hi250 >= 1000 ? 0 : 1)}${isIndex ? "" : ` on ${rvol.toFixed(1)}x volume`}` });
  }

  // --- Supertrend flips in the direction of the long-term trend
  if (pre.stDir[i] === 1 && pre.stDir[i - 1] === -1 && b.c > s200) {
    out.push({ setup: "supertrend", dir: 1, i, stop: Math.max(pre.stLine[i], b.c - 2.5 * a), rMult: 2, holdDays: 15, rvol, note: "Supertrend flipped up while price is above the 200-day average" });
  }
  if (pre.stDir[i] === -1 && pre.stDir[i - 1] === 1 && b.c < s200) {
    out.push({ setup: "stdown", dir: -1, i, stop: Math.min(pre.stLine[i], b.c + 2.5 * a), rMult: 2, holdDays: 15, rvol, note: "Supertrend flipped down while price is below the 200-day average" });
  }

  // --- MACD turning up from below zero in a long-term uptrend
  if (pre.macd[i] > pre.macdSig[i] && pre.macd[i - 1] <= pre.macdSig[i - 1] && pre.macd[i] < 0 && b.c > s200) {
    out.push({ setup: "macd", dir: 1, i, stop: b.c - 2 * a, rMult: 2, holdDays: 15, rvol, note: "MACD crossed above its signal line from below zero, above the 200-day average" });
  }

  if (up) {
    if (b.c > hh && p.c <= hh && volOk(1.5) && clv >= 0.6 && depth <= 0.2 && dayChg <= 0.08) {
      out.push({ setup: "breakout", dir: 1, i, stop: b.c - 1.5 * a, rMult: 2, holdDays: 15, rvol, note: `Closed above a ${(depth * 100).toFixed(0)}%-deep 30-day base${isIndex ? "" : ` on ${rvol.toFixed(1)}x volume`}` });
    }
    const low3 = Math.min(b.l, p.l, bars[i - 2].l);
    const turned = b.c > p.h || (b.c > b.o && clv >= 0.6 && b.c > p.c);
    if (madeExtreme(1) && low3 <= e20 * 1.01 && b.c > e20 * 0.97 && turned && rsi >= 40 && rsi <= 62) {
      out.push({ setup: "pullback", dir: 1, i, stop: stopAt(b.c, low3 - 0.25 * a, a, 1), rMult: 2, holdDays: 10, rvol, note: `Pulled back to the 20 EMA in an uptrend and turned up (RSI ${rsi.toFixed(0)})` });
    }
  }

  if (down) {
    if (b.c < ll && p.c >= ll && volOk(1.5) && clv <= 0.4 && depth <= 0.2 && dayChg >= -0.08) {
      out.push({ setup: "breakdown", dir: -1, i, stop: b.c + 1.5 * a, rMult: 2, holdDays: 15, rvol, note: `Closed below a ${(depth * 100).toFixed(0)}%-deep 30-day base${isIndex ? "" : ` on ${rvol.toFixed(1)}x volume`}` });
    }
    const high3 = Math.max(b.h, p.h, bars[i - 2].h);
    const turned = b.c < p.l || (b.c < b.o && clv <= 0.4 && b.c < p.c);
    if (madeExtreme(-1) && high3 >= e20 * 0.99 && b.c < e20 * 1.03 && turned && rsi >= 38 && rsi <= 60) {
      out.push({ setup: "fade", dir: -1, i, stop: stopAt(b.c, high3 + 0.25 * a, a, -1), rMult: 2, holdDays: 10, rvol, note: `Bounced to the 20 EMA in a downtrend and turned down (RSI ${rsi.toFixed(0)})` });
    }
  }
  return out;
}

export type SimTrade = { entryDate: string; exitDate: string; entry: number; exit: number; r: number; pct: number; days: number; exitIdx: number };

/** Simulate one signal. Returns null when the trade is skipped (bad open) or has no data yet. */
export function simulate(bars: Bar[], sig: RawSignal, cost = 0.0006): SimTrade | null {
  const ei = sig.i + 1;
  if (ei >= bars.length) return null;
  const d = sig.dir;
  const entry = bars[ei].o;
  const risk = d * (entry - sig.stop);
  const refRisk = d * (bars[sig.i].c - sig.stop);
  if (risk <= 0 || refRisk <= 0) return null;
  if (d * (entry - bars[sig.i].c) > refRisk) return null; // gapped more than 1R in our direction: don't chase
  const target = entry + d * sig.rMult * risk;
  const last = Math.min(bars.length - 1, ei + sig.holdDays - 1);
  let exit = bars[last].c;
  let xi = last;
  for (let j = ei; j <= last; j++) {
    const bar = bars[j];
    const hitStop = d === 1 ? bar.l <= sig.stop : bar.h >= sig.stop;
    if (hitStop) {
      const gapped = j > ei && (d === 1 ? bar.o < sig.stop : bar.o > sig.stop);
      exit = gapped ? bar.o : sig.stop; // a gap through the stop fills at the open
      xi = j;
      break;
    }
    const hitTarget = d === 1 ? bar.h >= target : bar.l <= target;
    if (hitTarget) {
      const gapped = j > ei && (d === 1 ? bar.o > target : bar.o < target);
      exit = gapped ? bar.o : target;
      xi = j;
      break;
    }
    if (sig.exitCross5 && j >= 4) {
      let s5 = 0;
      for (let k = j - 4; k <= j; k++) s5 += bars[k].c;
      if (d * (bar.c - s5 / 5) > 0) {
        exit = bar.c;
        xi = j;
        break;
      }
    }
  }
  const pct = d * (exit / entry - 1) - cost;
  return { entryDate: bars[ei].d, exitDate: bars[xi].d, entry, exit, r: (pct * entry) / risk, pct: pct * 100, days: xi - ei + 1, exitIdx: xi };
}
