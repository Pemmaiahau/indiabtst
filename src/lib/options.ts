// Option-chain reading shared by the scan (NSE end-of-day file) and the browser (uploaded live chain).

export type ChainRow = { strike: number; callOi: number; callChg: number; putOi: number; putChg: number };

export type ChainSummary = {
  callOi: number;
  putOi: number;
  callOiChg: number;
  putOiChg: number;
  pcr: number;
  maxPain: number;
  callWall: number;
  putWall: number;
};

export function summarizeChain(rows: ChainRow[]): ChainSummary | null {
  const callOi = rows.reduce((a, r) => a + r.callOi, 0);
  const putOi = rows.reduce((a, r) => a + r.putOi, 0);
  if (!(callOi > 0) || rows.length < 5) return null;
  // max pain: the expiry price at which option buyers collectively receive the least
  let maxPain = 0;
  let best = Infinity;
  for (const s of rows) {
    let pay = 0;
    for (const r of rows) pay += r.callOi * Math.max(0, s.strike - r.strike) + r.putOi * Math.max(0, r.strike - s.strike);
    if (pay < best) (best = pay), (maxPain = s.strike);
  }
  const top = (k: "callOi" | "putOi") => rows.reduce((b, r) => (r[k] > b[k] ? r : b), rows[0]).strike;
  return {
    callOi,
    putOi,
    callOiChg: rows.reduce((a, r) => a + r.callChg, 0),
    putOiChg: rows.reduce((a, r) => a + r.putChg, 0),
    pcr: Math.round((putOi / callOi) * 1000) / 1000,
    maxPain,
    callWall: top("callOi"),
    putWall: top("putOi"),
  };
}

export type OptionView = { view: "Bullish" | "Bearish" | "Neutral"; points: string[] };

/**
 * The conventional reading of index option positioning (option sellers are assumed to be the informed side).
 * This is market convention, not a backtested rule; the Backtest page shows what the put/call ratio
 * actually did for as much history as is cached.
 */
export function viewOptions(x: { spot: number; pcr: number; pcrPrev: number | null; callOiChg: number; putOiChg: number; callWall: number; putWall: number; maxPain: number }): OptionView {
  let pts = 0;
  const points: string[] = [];
  if (x.pcr >= 1.2) (pts += 1), points.push(`Put/call ratio ${x.pcr.toFixed(2)}: more puts than calls are open, usually read as put sellers expecting support (bullish)`);
  else if (x.pcr <= 0.8) (pts -= 1), points.push(`Put/call ratio ${x.pcr.toFixed(2)}: more calls than puts are open, usually read as call sellers expecting a ceiling (bearish)`);
  else points.push(`Put/call ratio ${x.pcr.toFixed(2)}: balanced`);
  if (x.pcrPrev != null && Math.abs(x.pcr - x.pcrPrev) >= 0.05) {
    pts += x.pcr > x.pcrPrev ? 1 : -1;
    points.push(`Ratio ${x.pcr > x.pcrPrev ? "rose" : "fell"} from ${x.pcrPrev.toFixed(2)} (${x.pcr > x.pcrPrev ? "bullish" : "bearish"} shift)`);
  }
  if (x.putOiChg > 0 && x.putOiChg > x.callOiChg * 1.25) (pts += 1), points.push("More new put positions than call positions were added (put writing, bullish)");
  else if (x.callOiChg > 0 && x.callOiChg > x.putOiChg * 1.25) (pts -= 1), points.push("More new call positions than put positions were added (call writing, bearish)");
  if (x.callWall && x.spot >= x.callWall * 0.995) (pts -= 1), points.push(`Spot is at the biggest call strike ${x.callWall} (resistance)`);
  else if (x.putWall && x.spot <= x.putWall * 1.005) (pts += 1), points.push(`Spot is at the biggest put strike ${x.putWall} (support)`);
  points.push(`Largest open interest: calls at ${x.callWall} (resistance), puts at ${x.putWall} (support); max pain ${x.maxPain}`);
  return { view: pts >= 2 ? "Bullish" : pts <= -2 ? "Bearish" : "Neutral", points };
}
