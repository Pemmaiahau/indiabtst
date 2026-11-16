"use client";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Badge, buildupKind, Card, Notes, ScoreBar, Status, StockLink, WhyList } from "@/components/ui";
import { scoreBtstDay, SELL_MAX } from "@/lib/btst";
import { fmt, istDateOf, istNow, MAX_PICKS, MIN_SCORE, pct, rupees, timeAgo, tone, useData, useUpload } from "@/lib/client";
import { SHORT_AT } from "@/lib/indexcall";
import { btstWhy, momentumClose, weakClose } from "@/lib/reasons";
import type { Backtest, BtstInput, BtstRow, IndexCall, Meta, Snapshot } from "@/lib/types";

export default function BtstPage() {
  const { data: scan, error } = useData<{ meta: Meta; rows: BtstRow[] }>("btst.json");
  const { data: snap } = useData<Snapshot>("snapshot.json");
  const { data: ix } = useData<{ calls: IndexCall[] }>("index.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  const [upload, setUpload] = useUpload();
  const [showAll, setShowAll] = useState(false);
  const [only50, setOnly50] = useState(false);

  // Re-score with the user's uploaded quotes when present.
  const live = useMemo(() => {
    if (!upload || !snap || !scan) return null;
    const day = istDateOf(upload.at);
    const ctxs = snap.next && day > snap.meta.barDate ? snap.next : snap.stocks; // after the close the snapshot carries next-session context
    const inputs: BtstInput[] = [];
    for (const [sym, q] of Object.entries(upload.quotes)) {
      const s = ctxs[sym];
      if (s) inputs.push({ sym, name: s.name, sector: s.sector, ctx: s.ctx, bar: q });
    }
    if (inputs.length < 25) return { rows: [] as BtstRow[], matched: inputs.length, unchanged: false };
    const now = istNow();
    const prev = new Map(scan.rows.map((r) => [r.sym, r]));
    const rows = scoreBtstDay(inputs, day === now.date && now.open ? now.frac : 1)
      .map((r) => ({ ...r, fo: prev.get(r.sym)?.fo, ex: prev.get(r.sym)?.ex }))
      .sort((a, b) => b.score - a.score);
    return { rows, matched: inputs.length, unchanged: rows.filter((r) => Math.abs(r.chg) < 0.005).length > rows.length * 0.8 };
  }, [upload, snap, scan]);

  if (!scan) return <Status error={error} loading />;
  const usingLive = !!live && live.rows.length > 0;
  const all = usingLive ? live!.rows : scan.rows;
  const rows = only50 ? all.filter((r) => r.ex?.n50) : all;
  const visible = rows.filter((r) => showAll || r.score >= MIN_SCORE);
  const picks = new Set(rows.filter((r) => r.score >= MIN_SCORE && !r.ex?.ban).slice(0, MAX_PICKS).map((r) => r.sym));
  const sells = rows.filter((r) => r.score <= SELL_MAX).slice(-5).reverse();
  const textbook = rows.filter(momentumClose).sort((a, b) => b.chg - a.chg);
  const nifty = ix?.calls.find((c) => c.sym === "NIFTY");
  const [fut, filtered, cash] = bt?.btst.variants ?? [];
  const recent = bt?.btst.byYear.slice(-2);
  const [sellAll, sellWeak] = bt?.btst.sell ?? [];
  const conv = bt?.btst.conventional[0];
  const convRecent = bt?.btst.conventionalByYear.slice(-2);
  const weakMarket = !!nifty && nifty.score.score <= SHORT_AT;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Stock futures overnight: buy at the close, sell at the next open</h1>
        <p className="mt-1 text-sm text-muted">
          Every stock that has futures on NSE ({scan.meta.symbols}), ranked by the overnight score, with the reasons for each pick. Buy in the last minutes of the session (around 3:20 PM) and sell at the next open (9:15 AM).
        </p>
      </div>
      <Notes meta={scan.meta} />

      {fut && cash && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
          <b>Use stock futures, not delivery shares, for BTST.</b> In the backtest the top 3 picks earned {pct(fut.stats.avg, 3)} per trade through futures but {pct(cash.stats.avg, 3)} through delivery, because delivery costs about 0.25% per round trip (0.1% STT each way).
          {recent && recent.length === 2 && <> <b>The edge has been much smaller lately:</b> {recent.map((y) => `${y.year} ${pct(y.avg, 3)}`).join(", ")} per trade.</>} The test assumes fills at the official close and open, which real orders will not match exactly.
        </div>
      )}

      {nifty && filtered && (
        <div className={`rounded-xl border p-3 text-sm ${nifty.score.score > 0 ? "border-up/40 bg-up/10" : "border-down/40 bg-down/10"}`}>
          <b>Nifty overnight score {nifty.score.score > 0 ? "+" : ""}{nifty.score.score}: {nifty.score.score > 0 ? "market filter passed" : "market filter failed, better to skip buying tonight"}.</b>{" "}
          <span className="text-muted">Taking stock BTST trades only on days when this score was above 0 lifted the backtest result to {pct(filtered.stats.avg, 3)} per trade with {filtered.stats.winRate.toFixed(0)}% winners.</span>
        </div>
      )}

      <div className={`rounded-xl border p-3 text-sm ${usingLive ? "border-accent/50 bg-accent/10" : "border-line bg-panel"}`}>
        {usingLive ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              <b>Using your uploaded quotes</b> ({live!.matched} stocks, {upload!.source}, {timeAgo(upload!.at)}).
            </span>
            <button onClick={() => setUpload(null)} className="rounded-md border border-line bg-panel2 px-2.5 py-1">Back to the automatic scan</button>
            {live!.unchanged && <span className="text-warn">These prices equal the last close, so they are probably not from a live session.</span>}
          </div>
        ) : (
          <span>
            Automatic scan of {scan.meta.barDate} ({scan.meta.session === "live" ? `intraday, about ${Math.round(scan.meta.volFrac * 100)}% of the session done` : "final close"}), run {timeAgo(scan.meta.generatedAt)}. Free prices lag about 15 minutes.{" "}
            <Link href="/data/" className="text-accent underline">Upload live quotes</Link> to re-rank with fresher prices.
            {upload && live && live.rows.length === 0 && <span className="text-warn"> Your last upload matched only {live.matched} stocks, so it is ignored.</span>}
          </span>
        )}
      </div>

      <Card
        title={`BUY overnight: ${showAll ? "all stocks" : `candidates scoring ${MIN_SCORE}+`} (${visible.length})`}
        right={
          <div className="flex items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={only50} onChange={(e) => setOnly50(e.target.checked)} /> Nifty 50 only
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
            </label>
          </div>
        }
      >
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nothing scores {MIN_SCORE}+ right now. No trade is a valid outcome; tick “Show all” to see the full ranking.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Score</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Day</th>
                  <th className="text-right" title="Where the price sits in today's low-to-high range">In range</th>
                  <th className="text-right" title="Sum of the last 60 overnight moves">60 nights</th>
                  <th className="text-right" title="Volume versus the 20-day average">Vol</th>
                  <th title="Futures open interest versus price on the last NSE file">Futures</th>
                  <th className="text-right">1 lot</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Row key={r.sym} r={r} side="buy" pick={picks.has(r.sym)} why={r.score >= MIN_SCORE} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Textbook BTST closes today (${textbook.length})`}>
        <div className="grid gap-2 p-4 text-sm">
          <p>
            The pattern most traders mean by BTST: up 2% or more, closing at the day&apos;s high, on 1.5x volume, at a 20-day high.
            {conv && <> Tested on its own (top 3 by gain each day, through futures): <b className={tone(conv.stats.avg)}>{pct(conv.stats.avg, 3)}</b> per trade, {conv.stats.winRate.toFixed(0)}% winners over {conv.stats.n.toLocaleString("en-IN")} trades.</>}
            {convRecent && convRecent.length === 2 && <> Lately: {convRecent.map((y) => `${y.year} ${pct(y.avg, 3)} (${y.winRate.toFixed(0)}% winners)`).join(", ")}.</>}
          </p>
          {textbook.length ? (
            <div className="flex flex-wrap gap-2">
              {textbook.map((r) => (
                <span key={r.sym} className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs">
                  <StockLink sym={r.sym} /> <span className={`num ${tone(r.chg)}`}>{pct(r.chg)}</span> <span className="num text-muted">{r.rvol!.toFixed(1)}x vol · score {r.score.toFixed(0)}</span> {r.ex?.ban && <Badge kind="down">F&amp;O ban</Badge>}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted">No stock closed this way {usingLive ? "in your upload" : "in the last scan"}.</p>
          )}
        </div>
      </Card>

      <Card title={`SELL overnight (STBT) watch list: weakest scores (${sells.length})`}>
        <div className={`border-b border-line p-3 text-sm ${weakMarket ? "bg-warn/10" : "bg-down/10"}`}>
          {sellAll && sellWeak ? (
            <>
              <b>{weakMarket ? "Weak-market condition met tonight, but the tested edge is tiny." : "Not supported tonight."}</b> Selling the 3 lowest scores at the close and buying back at the open averaged{" "}
              <b className={tone(sellAll.stats.avg)}>{pct(sellAll.stats.avg, 3)}</b> per trade ({sellAll.stats.winRate.toFixed(0)}% winners) over all nights, and <b className={tone(sellWeak.stats.avg)}>{pct(sellWeak.stats.avg, 3)}</b> ({sellWeak.stats.winRate.toFixed(0)}% winners, {sellWeak.stats.n.toLocaleString("en-IN")} trades) only on nights when the Nifty overnight score was {SHORT_AT} or lower
              {nifty && <> (tonight it is {nifty.score.score > 0 ? "+" : ""}{nifty.score.score})</>}. Indian stocks drift up overnight, so use this list mainly as “do not carry these long”. Short ideas with a stop are on the <Link href="/swing/" className="underline">Swing</Link> screen.
            </>
          ) : (
            <>The weakest overnight profiles. Read it mainly as “do not carry these long”.</>
          )}
        </div>
        {sells.length === 0 ? (
          <p className="p-4 text-sm text-muted">No stock scores {SELL_MAX} or less.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Score</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Day</th>
                  <th className="text-right">In range</th>
                  <th className="text-right">60 nights</th>
                  <th className="text-right">Vol</th>
                  <th>Futures</th>
                  <th className="text-right">1 lot</th>
                </tr>
              </thead>
              <tbody>
                {sells.map((r) => (
                  <Row key={r.sym} r={r} side="sell" pick={false} why />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        Ranks are within all stocks that have futures. “1 lot” is the futures lot and its contract value; the margin is a fraction of that (check your broker). Futures build-up and delivery percentage describe the last published NSE file and are context, not part of the score.
        {scan.meta.banAsOf ? ` F&O ban list for ${scan.meta.banAsOf}: ${scan.meta.ban.length ? scan.meta.ban.join(", ") : "no stocks"}.` : " The F&O ban list could not be downloaded, so check it yourself."} Overnight positions cannot be protected by a stop. Results dates are not tracked here, so check that a stock is not reporting tonight. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}

function Row({ r, side, pick, why }: { r: BtstRow; side: "buy" | "sell"; pick: boolean; why: boolean }) {
  const w = why ? btstWhy(r, side) : null;
  return (
    <Fragment>
    <tr className={`${w ? "joined" : ""} ${pick ? "bg-up/5" : ""}`}>
      <td className="align-top">
        <StockLink sym={r.sym} />
        <div className="max-w-36 truncate text-xs text-muted">{r.name}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {pick && <Badge kind="up">Top pick</Badge>}
          {side === "buy" && momentumClose(r) && <Badge kind="accent">Textbook close</Badge>}
          {side === "sell" && weakClose(r) && <Badge kind="down">Textbook STBT close</Badge>}
          {r.ex?.n50 && <Badge>Nifty 50</Badge>}
          {r.ex?.ban && <Badge kind="down">F&amp;O ban</Badge>}
        </div>
      </td>
      <td className="align-top"><ScoreBar score={r.score} /></td>
      <td className="num text-right align-top">{fmt(r.price)}</td>
      <td className={`num text-right align-top ${tone(r.chg)}`}>{pct(r.chg)}</td>
      <td className="num text-right align-top">{r.clv == null ? "–" : `${Math.round(r.clv * 100)}%`}</td>
      <td className={`num text-right align-top ${tone(r.ovn60)}`}>{pct(r.ovn60, 1)}</td>
      <td className="num text-right align-top">{r.rvol == null ? "–" : `${r.rvol.toFixed(1)}x`}</td>
      <td className="align-top">{r.fo ? <span title={`NSE file of ${r.fo.asOf}`}><Badge kind={buildupKind(r.fo.buildup)}>{r.fo.buildup}</Badge> <span className="num text-xs text-muted">OI {pct(r.fo.oiChgPct, 0)}</span></span> : <span className="text-xs text-muted">–</span>}</td>
      <td className="num text-right align-top">{r.fo ? `${r.fo.lot} sh · ${rupees(r.fo.lot * r.price)}` : "–"}</td>
    </tr>
    {w && (
      <tr className={pick ? "bg-up/5" : ""}>
        <td colSpan={9} className="pt-0">
          <WhyList className="sm:grid-cols-2 sm:gap-x-6" reasons={w.reasons} cautions={w.cautions} />
        </td>
      </tr>
    )}
    </Fragment>
  );
}
