"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Badge, Card, Notes, Status, StockLink, WhyList } from "@/components/ui";
import { fmt, rupees, useData } from "@/lib/client";
import { SETUPS, SWING_DIR, SWING_LABEL, SWING_RULES } from "@/lib/swing";
import type { Backtest, Meta, Pulse, SwingSetup, SwingSignal } from "@/lib/types";

export default function SwingPage() {
  const { data, error } = useData<{ meta: Meta; signals: SwingSignal[] }>("swing.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  const { data: pulse } = useData<Pulse>("pulse.json");
  const [setup, setSetup] = useState<SwingSetup | "all">("all");
  const [side, setSide] = useState<"all" | "long" | "short">("all");
  if (!data) return <Status error={error} loading />;
  const stat = (k: SwingSetup) => bt?.swing.find((x) => x.setup === k);
  const worked = (k: SwingSetup) => {
    const s = stat(k);
    return !s || s.stocks.avg >= 0.03;
  };
  // newest signal per instrument and setup; indices first, then setups that tested best
  const order = [...SETUPS].sort((a, b) => (stat(b)?.stocks.avg ?? 0) - (stat(a)?.stocks.avg ?? 0));
  const seen = new Set<string>();
  const signals = data.signals
    .filter((x) => (setup === "all" || x.setup === setup) && (side === "all" || (side === "long") === (x.dir === 1)))
    .filter((x) => !seen.has(x.sym + x.setup) && !!seen.add(x.sym + x.setup))
    .sort((a, b) => (a.kind === b.kind ? order.indexOf(a.setup) - order.indexOf(b.setup) || b.date.localeCompare(a.date) : a.kind === "index" ? -1 : 1));

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Swing setups (3 to 15 sessions)</h1>
        <p className="mt-1 text-sm text-muted">Buy and short signals from the last three sessions that are still valid, for Nifty and Bank Nifty futures and every stock that has futures, each with the reasons it was selected and what argues against it. Enter at the next open, place the stop immediately, and exit at the target, the stop or the time limit. Shorts need futures.</p>
      </div>
      <Notes meta={data.meta} />

      {pulse && (
        <div className={`rounded-xl border p-3 text-sm ${pulse.label === "Risk-off" ? "border-down/40 bg-down/10" : pulse.label === "Neutral" ? "border-warn/40 bg-warn/10" : "border-up/40 bg-up/10"}`}>
          <b>Market pulse: {pulse.label} ({pulse.score > 0 ? "+" : ""}{pulse.score}).</b> {pulse.advice}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETUPS.map((k) => {
          const st = stat(k);
          const n = new Set(data.signals.filter((x) => x.setup === k).map((x) => x.sym)).size;
          return (
            <button key={k} onClick={() => setSetup(setup === k ? "all" : k)} className={`rounded-xl border p-3 text-left ${setup === k ? "border-accent bg-accent/10" : "border-line bg-panel"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  <Badge kind={SWING_DIR[k] === 1 ? "up" : "down"}>{SWING_DIR[k] === 1 ? "BUY" : "SHORT"}</Badge> {SWING_LABEL[k]}
                </span>
                <Badge kind={n ? "accent" : "muted"}>{n} now</Badge>
              </div>
              {st && (
                <div className="num mt-2 text-xs">
                  <span className={st.stocks.avg > 0 ? "text-up" : "text-down"}>
                    Stocks: {st.stocks.winRate.toFixed(0)}% wins, {st.stocks.avg >= 0 ? "+" : ""}{st.stocks.avg.toFixed(2)}R avg ({st.stocks.n})
                  </span>
                  {st.index.n > 0 && (
                    <span className={st.index.avg > 0 ? "text-up" : "text-down"}>
                      {" "}· Indices: {st.index.winRate.toFixed(0)}%, {st.index.avg >= 0 ? "+" : ""}{st.index.avg.toFixed(2)}R ({st.index.n})
                    </span>
                  )}
                </div>
              )}
              {st && st.recent.n > 0 && (
                <div className="num mt-0.5 text-xs text-muted">
                  Since last year: <span className={st.recent.avg > 0 ? "text-up" : "text-down"}>{st.recent.avg >= 0 ? "+" : ""}{st.recent.avg.toFixed(2)}R</span> ({st.recent.n}) · Nifty above 200d: {(st.dir === 1 ? st.withTrend : st.againstTrend).avg.toFixed(2)}R · below: {(st.dir === 1 ? st.againstTrend : st.withTrend).avg.toFixed(2)}R
                </div>
              )}
              {!worked(k) && <div className="mt-1 text-xs font-medium text-down">Did not make money in the backtest. Shown for completeness; not recommended.</div>}
              <p className="mt-1.5 text-xs text-muted">{SWING_RULES[k]}</p>
            </button>
          );
        })}
      </div>

      <Card
        title={`${setup === "all" ? "All setups" : SWING_LABEL[setup]} (${signals.length})`}
        right={
          <div className="flex overflow-hidden rounded-lg border border-line text-xs">
            {(["all", "long", "short"] as const).map((k) => (
              <button key={k} onClick={() => setSide(k)} className={`px-2.5 py-1 ${side === k ? "bg-accent font-medium text-bg" : "bg-panel2 text-muted"}`}>
                {k === "all" ? "Both" : k === "long" ? "Buy" : "Short"}
              </button>
            ))}
          </div>
        }
      >
        {signals.length === 0 ? (
          <p className="p-4 text-sm text-muted">No valid signals for this filter. Waiting is part of the method.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Side and setup</th>
                  <th>Signal day</th>
                  <th className="text-right">Close</th>
                  <th className="text-right">Stop</th>
                  <th className="text-right">Target</th>
                  <th className="text-right">Risk</th>
                  <th className="text-right" title="Loss on one futures lot if the stop is hit, measured from the signal close">Risk per lot</th>
                  <th className="text-right">Exit by</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((x) => (
                  <Fragment key={x.sym + x.setup + x.date}>
                  <tr className={`joined ${worked(x.setup) ? "" : "opacity-70"}`}>
                    <td className="align-top">
                      <StockLink sym={x.sym} params={`&stop=${x.stop}${x.setup === "bounce" ? "" : `&target=${x.target}`}`} />
                      <div className="max-w-36 truncate text-xs text-muted">{x.kind === "index" ? "Index futures" : x.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {!worked(x.setup) && <Badge kind="down">Weak setup</Badge>}
                        {x.ex?.n50 && <Badge>Nifty 50</Badge>}
                        {x.ex?.ban && <Badge kind="down">F&amp;O ban</Badge>}
                      </div>
                    </td>
                    <td className="align-top">
                      <Badge kind={x.dir === 1 ? "up" : "down"}>{x.dir === 1 ? "BUY" : "SHORT"}</Badge> {SWING_LABEL[x.setup]}
                    </td>
                    <td className="align-top num">
                      {x.date.slice(5)} {x.date === data.meta.barDate && <Badge kind="accent">New</Badge>}
                    </td>
                    <td className="align-top num text-right">{fmt(x.close)}</td>
                    <td className="align-top num text-right text-down">{fmt(x.stop)}</td>
                    <td className="align-top num text-right text-up">{x.setup === "bounce" ? "Close > 5d avg" : fmt(x.target)}</td>
                    <td className="align-top num text-right">{fmt(x.riskPct, 1)}%</td>
                    <td className="align-top num text-right">{x.lot ? `${rupees(Math.abs(x.close - x.stop) * x.lot)} (${x.lot})` : "–"}</td>
                    <td className="align-top num text-right">{x.holdDays} sessions</td>
                  </tr>
                  <tr className={worked(x.setup) ? "" : "opacity-70"}>
                    <td colSpan={9} className="pt-0">
                      <WhyList className="sm:grid-cols-2 sm:gap-x-6" reasons={x.reasons ?? [x.note]} cautions={x.cautions ?? []} />
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">
        Stops and targets are measured from the signal-day close; recompute them from your actual entry and skip the trade if the open is already more than one risk-unit past the close. “R” means one unit of risk (entry to stop). Buy setups can also be taken in delivery shares, at a higher cost. Full statistics are on the{" "}
        <Link href="/backtest/" className="underline">Backtest</Link> page. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}
