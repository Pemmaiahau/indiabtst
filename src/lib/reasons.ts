// Plain-language reasons for every call. Shared by the scan and the browser, so re-scored uploads explain themselves too.
import { LONG_AT, SHORT_AT } from "./indexcall";

import type { BtstRow, Extra, FoRead, IndexFeatures, IndexScore, SwingSetup, TradeStats } from "./types";

export type Why = { reasons: string[]; cautions: string[] };

const sg = (x: number, d = 1) => `${x > 0 ? "+" : ""}${x.toFixed(d)}%`;
const top = (rank: number) => `top ${Math.max(1, Math.round((1 - rank) * 100))}%`;
const bottom = (rank: number) => `bottom ${Math.max(1, Math.round(rank * 100))}%`;

/** The textbook BTST close: a strong up day that finishes at the high on heavy volume, at a 20-day high. */
export const momentumClose = (r: BtstRow) => r.chg >= 2 && r.clv != null && r.clv >= 0.8 && r.rvol != null && r.rvol >= 1.5 && r.distHigh <= 0;
/** Its mirror image, the textbook STBT close. */
export const weakClose = (r: BtstRow) => r.chg <= -2 && r.clv != null && r.clv <= 0.2 && r.rvol != null && r.rvol >= 1.5 && !r.above20 && !r.above50;

function context(ex: Extra | undefined, fo: FoRead | undefined, dir: 1 | -1, w: Why) {
  if (fo) {
    const agrees = dir === 1 ? fo.buildup === "Long build-up" || fo.buildup === "Short covering" : fo.buildup === "Short build-up" || fo.buildup === "Long unwinding";
    const text = `Futures showed ${fo.buildup.toLowerCase()} on ${fo.asOf} (open interest ${sg(fo.oiChgPct, 0)})`;
    if (fo.buildup !== "Flat") (agrees ? w.reasons : w.cautions).push(text);
  }
  if (ex) {
    if (dir === 1 && ex.rs >= 0.7) w.reasons.push(`Market leader: 12-month return ${sg(ex.ret250, 0)}, ${top(ex.rs)} of F&O stocks`);
    if (dir === 1 && ex.rs <= 0.2) w.cautions.push(`Laggard: 12-month return ${sg(ex.ret250, 0)}, ${bottom(ex.rs)} of F&O stocks`);
    if (dir === -1 && ex.rs <= 0.3) w.reasons.push(`Laggard: 12-month return ${sg(ex.ret250, 0)}, ${bottom(ex.rs)} of F&O stocks`);
    if (dir === -1 && ex.rs >= 0.7) w.cautions.push(`Market leader (12-month return ${sg(ex.ret250, 0)}): shorting leaders lost the most in the test`);
    if (ex.deliv != null && ex.delivAvg != null && ex.delivAvg > 0) {
      const ratio = ex.deliv / ex.delivAvg;
      if (ratio >= 1.25) w.reasons.push(`Delivery ${ex.deliv.toFixed(0)}% of traded shares on ${ex.delivAsOf} against a usual ${ex.delivAvg.toFixed(0)}%: more of the volume was taken home rather than day-traded`);
      else if (ratio <= 0.7) w.cautions.push(`Delivery only ${ex.deliv.toFixed(0)}% on ${ex.delivAsOf} against a usual ${ex.delivAvg.toFixed(0)}%: mostly day-trading volume`);
    }
    if (ex.ban) w.cautions.unshift("In the F&O ban period: new futures positions are not allowed");
  }
}

/** Why a stock is on the overnight buy list (or the overnight sell watch list). */
export function btstWhy(r: BtstRow, side: "buy" | "sell" = "buy"): Why {
  const w: Why = { reasons: [], cautions: [] };
  const range = r.clv == null ? null : Math.round(r.clv * 100);
  if (side === "buy") {
    if (r.ovnRank >= 0.6) w.reasons.push(`Gaps up habitually: ${sg(r.ovn60)} from its last 60 nights (${top(r.ovnRank)} of F&O stocks)`);
    if (r.intrRank <= 0.4) w.reasons.push(`Sold during the day, bought overnight: ${sg(r.intr20)} open-to-close over 20 sessions`);
    if (range != null && range <= 40) w.reasons.push(`Closed low in today's range (${range}% of the way up): weak closes rebounded more by the next open`);
    if (r.atrRank >= 0.6) w.reasons.push(`Big mover: daily range ${r.atrPct.toFixed(1)}% of price (${top(r.atrRank)}); bigger movers earned more overnight`);
    if (r.rvol != null && r.rvol >= 1.3) w.reasons.push(`Active today: volume ${r.rvol.toFixed(1)}x its 20-day average`);
    if (momentumClose(r)) w.reasons.push(`Textbook BTST close: up ${sg(r.chg)} on ${r.rvol!.toFixed(1)}x volume, finishing at the high and at a 20-day high`);
    if (r.ovnRank < 0.3) w.cautions.push(`Weak overnight record: ${sg(r.ovn60)} from its last 60 nights`);
    if (!r.above200) w.cautions.push("Below its 200-day average (long-term downtrend)");
    if (Math.abs(r.chg) >= 6) w.cautions.push(`Moved ${sg(r.chg)} today: look for news before carrying it`);
  } else {
    if (r.ovnRank <= 0.3) w.reasons.push(`Rarely gaps up: ${sg(r.ovn60)} from its last 60 nights (${bottom(r.ovnRank)} of F&O stocks)`);
    if (r.intrRank >= 0.6) w.reasons.push(`Its gains come during the day, not overnight: ${sg(r.intr20)} open-to-close over 20 sessions`);
    if (range != null && range >= 60) w.reasons.push(`Closed high in today's range (${range}%): strong closes gave the smallest overnight follow-through`);
    if (!r.above20 && !r.above50) w.reasons.push("Below its 20-day and 50-day averages");
    if (weakClose(r)) w.reasons.push(`Textbook STBT close: down ${sg(r.chg)} on ${r.rvol!.toFixed(1)}x volume, finishing at the low`);
    if (r.above200 && r.above50) w.cautions.push("Still in an uptrend (above its 50-day and 200-day averages)");
    if (r.atrRank >= 0.7) w.cautions.push(`Big mover (${r.atrPct.toFixed(1)}% daily range): an adverse gap would be large`);
  }
  context(r.ex, r.fo, side === "buy" ? 1 : -1, w);
  return w;
}

/** What argues for and against carrying an index future overnight. */
export function indexWhy(f: IndexFeatures, s: IndexScore): { bull: string[]; bear: string[]; summary: string } {
  const bull: string[] = [];
  const bear: string[] = [];
  const move = f.intraday ?? f.dayChg;
  const range = f.clv == null ? null : Math.round(f.clv * 100);
  if ((s.parts.strength ?? 0) >= 8) bull.push(`Strong close: ${sg(move, 2)} ${f.intraday == null ? "on the day" : "from the open"}${range == null ? "" : `, finishing ${range}% of the way up the day's range`}`);
  if ((s.parts.strength ?? 0) <= -8) bear.push(`Weak close: ${sg(move, 2)} ${f.intraday == null ? "on the day" : "from the open"}${range == null ? "" : `, finishing only ${range}% of the way up the day's range`}`);
  if (f.vixChg != null && f.vix != null) {
    if (f.vixChg <= -1.5) bull.push(`India VIX fell ${Math.abs(f.vixChg).toFixed(1)}% to ${f.vix.toFixed(1)}: fear is easing`);
    if (f.vixChg >= 1.5) bear.push(`India VIX rose ${f.vixChg.toFixed(1)}% to ${f.vix.toFixed(1)}: traders are paying up for protection`);
  }
  if ((s.parts.trend ?? 0) >= 5) bull.push(`Short-term uptrend: ${sg(f.dist20)} against the 20-day average, ${sg(f.ret5)} in 5 sessions`);
  if ((s.parts.trend ?? 0) <= -5) bear.push(`Short-term downtrend: ${sg(f.dist20)} against the 20-day average, ${sg(f.ret5)} in 5 sessions`);
  if ((s.parts.habit ?? 0) >= 3) bull.push(`Has been gapping up: ${sg(f.ovn20)} from the last 20 nights`);
  if ((s.parts.habit ?? 0) <= -3) bear.push(`Has not been gapping up: ${sg(f.ovn20)} from the last 20 nights`);
  if (f.fiiRatio != null) {
    const p = Math.round(f.fiiRatio * 100);
    if ((s.parts.fii ?? 0) >= 4) bull.push(`Foreign investors hold ${p}% of their index futures long`);
    if ((s.parts.fii ?? 0) <= -4) bear.push(`Foreign investors are net short index futures (only ${p}% long)`);
  }
  if (!f.above200) bear.push("Below the 200-day average (long-term downtrend)");
  else if (f.above50) bull.push("Above the 50-day and 200-day averages");
  if (f.rsi >= 75) bear.push(`RSI ${f.rsi.toFixed(0)}: stretched after a run`);
  const summary =
    s.call === "LONG"
      ? `Score ${s.score} is at or above the buy line of ${LONG_AT}: ${bull.length} points for, ${bear.length} against.`
      : s.call === "SHORT"
        ? `Score ${s.score} is at or below ${SHORT_AT}: the evidence is against holding longs tonight.`
        : `Score ${s.score} sits between ${SHORT_AT} and ${LONG_AT}: the evidence is mixed, so there is no overnight trade.`;
  return { bull, bear, summary };
}

/** Why a swing signal was selected, and what argues against taking it. */
export function swingWhy(x: {
  setup: SwingSetup;
  dir: 1 | -1;
  note: string;
  kind: "stock" | "index";
  rsi: number;
  ex?: Extra;
  fo?: FoRead;
  niftyAbove200: boolean;
  /** How this setup tested: overall, in markets like today's (Nifty on this side of its 200-day average), and recently. */
  tested: { all: TradeStats; regime: TradeStats | null; recent: TradeStats | null };
}): Why {
  const w: Why = { reasons: [x.note], cautions: [] };
  const line = (s: TradeStats) => `${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(2)}R per trade, ${s.winRate.toFixed(0)}% winners over ${s.n.toLocaleString("en-IN")} trades`;
  const { all, regime, recent } = x.tested;
  const where = x.kind === "index" ? "on the indices" : "on F&O stocks";
  if (all.n >= 20) (all.avg >= 0.03 ? w.reasons : w.cautions).push(all.avg >= 0.03 ? `Setup tested positive ${where}: ${line(all)}` : `Setup did not make money ${where} in the test: ${line(all)}`);
  else w.cautions.push(`Too few past trades ${where} to judge this setup (${all.n})`);
  if (regime && regime.n >= 100) {
    const market = `with Nifty ${x.niftyAbove200 ? "above" : "below"} its 200-day average, as it is now`;
    if (regime.avg >= 0.03 && regime.avg >= all.avg) w.reasons.push(`Did better ${market}: ${line(regime)}`);
    else if (regime.avg <= 0) w.cautions.push(`Lost money ${market}: ${line(regime)}`);
  }
  if (recent && recent.n >= 50 && recent.avg <= 0.005 && all.avg >= 0.03) w.cautions.push(`Has not worked since the start of last year: ${line(recent)}`);
  if (x.dir === 1 && x.rsi >= 78) w.cautions.push(`RSI ${x.rsi}: already stretched`);
  if (x.dir === -1 && x.rsi <= 25) w.cautions.push(`RSI ${x.rsi}: already deeply oversold, bounces are common here`);
  if (x.kind === "stock") context(x.ex, x.fo, x.dir, w);
  return w;
}
