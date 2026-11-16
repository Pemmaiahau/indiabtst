"use client";
import Link from "next/link";
import { Badge, buildupKind, Card, Notes, Status, WhyList } from "@/components/ui";
import { fmt, istDateOf, pct, rupees, timeAgo, tone, useChain, useData, useUpload } from "@/lib/client";
import { INDEX_PARTS, indexFeatures, indexScore, LONG_AT, SHORT_AT } from "@/lib/indexcall";
import { summarizeChain, viewOptions } from "@/lib/options";
import { indexWhy } from "@/lib/reasons";
import { SWING_LABEL } from "@/lib/swing";
import type { Backtest, IndexCall, Meta, SwingSignal } from "@/lib/types";

const MARGIN = 0.12; // rough SPAN + exposure margin for index futures

export default function FuturesPage() {
  const { data, error } = useData<{ meta: Meta; calls: IndexCall[] }>("index.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  const { data: swing } = useData<{ signals: SwingSignal[] }>("swing.json");
  const [upload] = useUpload();
  if (!data) return <Status error={error} loading />;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Nifty and Bank Nifty futures</h1>
        <p className="mt-1 text-sm text-muted">
          The overnight (BTST) call for each index: take the position near 3:20 PM and close it at the next open. Swing signals for the indices are listed below each call.
        </p>
      </div>
      <Notes meta={data.meta} />
      <div className={`rounded-xl border p-3 text-sm ${upload ? "border-accent/50 bg-accent/10" : "border-line bg-panel"}`}>
        {upload ? (
          <>
            <b>Your uploaded quotes are applied where they include the index</b> ({upload.source}, {timeAgo(upload.at)}). <Link href="/data/" className="text-accent underline">Manage uploads</Link>
          </>
        ) : (
          <>
            Scan of {data.meta.barDate} ({data.meta.session === "live" ? `intraday, about ${Math.round(data.meta.volFrac * 100)}% of the session done` : "final close"}), run {timeAgo(data.meta.generatedAt)}. Free prices lag about 15 minutes.{" "}
            <Link href="/data/" className="text-accent underline">Upload live quotes or a live option chain</Link> for a fresher read near 3:20 PM.
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.calls.map((c) => (
          <IndexCard key={c.sym} c={c} meta={data.meta} bt={bt} signals={swing?.signals.filter((s) => s.sym === c.sym) ?? []} />
        ))}
      </div>
      <p className="text-xs text-muted">
        An overnight futures position cannot be protected by a stop: the market can open far from the previous close, and the loss on a lot can exceed the “bad night” figure. Margin figures are rough ({Math.round(MARGIN * 100)}% of contract value); check your broker. This is a screening tool, not financial advice.
      </p>
    </div>
  );
}

function IndexCard({ c, meta, bt, signals }: { c: IndexCall; meta: Meta; bt: Backtest | null; signals: SwingSignal[] }) {
  const [upload] = useUpload();
  const [chain] = useChain(c.sym);

  // Re-score with uploaded quotes when they include this index.
  let features = c.features;
  let score = c.score;
  let liveNote: string | null = null;
  const q = upload?.quotes[c.sym];
  if (upload && q) {
    const day = istDateOf(upload.at);
    const ctx = c.nextCtx && day > meta.barDate ? c.nextCtx : c.ctx;
    features = indexFeatures(ctx, q, upload.quotes.INDIAVIX?.c ?? (ctx === c.ctx ? c.features.vix : null));
    score = indexScore(features);
    liveNote = `From your upload${upload.quotes.INDIAVIX ? "" : " (no India VIX in the file, so that part uses the scan's value or is left out)"}`;
  }

  const b = bt?.index.find((x) => x.sym === c.sym);
  const zone = b?.buckets[score.score <= -60 ? 0 : score.score <= SHORT_AT ? 1 : score.score < 0 ? 2 : score.score < LONG_AT ? 3 : score.score < 60 ? 4 : 5];
  const shortStats = b?.variants[1].stats;
  const longStats = b?.variants[0].stats;
  const recent = b?.byYear.slice(-2);
  const value = c.lot * features.price;
  const callText = score.call === "LONG" ? "BUY for overnight" : score.call === "SHORT" ? "SHORT zone" : "NO overnight trade";
  const callColor = score.call === "LONG" ? "text-up" : score.call === "SHORT" ? "text-down" : "text-warn";
  const pos = ((score.score + 100) / 200) * 100;
  const why = indexWhy(features, score);

  const live = chain ? summarizeChain(chain.rows) : null;
  const liveView = live ? viewOptions({ spot: features.price, pcr: live.pcr, pcrPrev: c.options?.pcr ?? null, callOiChg: live.callOiChg, putOiChg: live.putOiChg, callWall: live.callWall, putWall: live.putWall, maxPain: live.maxPain }) : null;

  return (
    <Card
      title={
        <span>
          {c.name} <span className="num font-normal text-muted">{fmt(features.price)}</span> <span className={`num font-normal ${tone(features.dayChg)}`}>{pct(features.dayChg)}</span>
        </span>
      }
      right={<Link href={`/stock/?s=${c.sym}`} className="text-xs text-accent underline">Chart</Link>}
    >
      <div className="grid gap-4 p-4">
        <div>
          <div className={`text-3xl font-semibold ${callColor}`}>{callText}</div>
          <div className="num mt-1 text-sm text-muted">
            Overnight score {score.score > 0 ? "+" : ""}{score.score} (buy at {LONG_AT}+, short zone at {SHORT_AT} or lower){liveNote && <span className="text-accent"> · {liveNote}</span>}
          </div>
          <div className="relative mt-3 h-2 rounded bg-gradient-to-r from-down via-warn to-up">
            <div className="absolute -top-1 h-4 w-1 rounded bg-text" style={{ left: `calc(${pos}% - 2px)` }} />
          </div>
        </div>

        <div className="rounded-lg bg-panel2 p-3 text-sm">
          {score.call === "LONG" && (
            <p>
              Buy {c.sym} futures near 3:20 PM and sell at tomorrow&apos;s open.
              {zone && <> Nights with a score in this zone averaged <b className={tone(zone.avg)}>{pct(zone.avg, 3)}</b> before costs and rose <b>{zone.winRate.toFixed(0)}%</b> of the time ({zone.n} nights).</>}
            </p>
          )}
          {score.call === "SHORT" && (
            <p>
              The close was weak enough for the short zone, but <b>shorting overnight lost money in the backtest</b>
              {shortStats && <> (average {pct(shortStats.avg, 3)} per trade, {shortStats.winRate.toFixed(0)}% winners over {shortStats.n} trades)</>}. Indian indices tend to drift up overnight even after weak days, so read this as “do not carry longs tonight”. Short ideas with a stop are in the swing list.
            </p>
          )}
          {score.call === "NONE" && (
            <p>
              The close is not strong enough for an overnight long and not weak enough for the short zone.
              {zone && <> Nights in this zone averaged {pct(zone.avg, 3)} before costs ({zone.winRate.toFixed(0)}% up).</>}
            </p>
          )}
          {score.call === "LONG" && recent && recent.length === 2 && longStats && (
            <p className="mt-2 text-xs text-muted">
              The edge has been smaller lately: {recent.map((y) => `${y.year} ${pct(y.avg, 3)} per trade (${y.winRate.toFixed(0)}% winners)`).join(", ")}, against {pct(longStats.avg, 3)} over the whole test.
            </p>
          )}
          {c.expiryNext && <p className="mt-2 text-xs text-warn">An index expiry falls on the next session: expect a jumpier open and close.</p>}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">Why this call</h3>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-1.5 text-sm">{why.summary}</p>
            <WhyList reasons={why.bull} cautions={why.bear} />
            {c.confirm === "Conflicts" && <p className="mt-1.5 text-xs text-warn">Futures and options positioning on the last NSE file disagrees with this call.</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line text-center sm:grid-cols-4">
          {[
            ["Lot size", `${c.lot}${c.lotIsEstimate ? " (check)" : ""}`],
            ["Contract value", rupees(value)],
            [`Margin, about ${Math.round(MARGIN * 100)}%`, rupees(value * MARGIN)],
            ["Bad night, per lot", rupees(c.badNight * c.lot)],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-2 py-2">
              <div className="num text-sm font-semibold">{v}</div>
              <div className="text-[11px] text-muted">{k}</div>
            </div>
          ))}
        </div>
        <p className="-mt-2 text-[11px] text-muted">“Bad night” is the overnight move exceeded on only 1 night in 20 over the last year ({fmt(c.badNight, 0)} points). Daily range (ATR) is {fmt(c.atr, 0)} points.</p>

        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">Score breakdown</h3>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {Object.entries(INDEX_PARTS).map(([k, p]) => {
              const v = score.parts[k];
              return (
                <li key={k} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span>{p.label}</span>
                  <span className={`num shrink-0 ${v == null ? "text-muted" : tone(v)}`}>{v == null ? "no data" : `${v > 0 ? "+" : ""}${v.toFixed(0)}`} <span className="text-muted">/ ±{p.max}</span></span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-3">
            <span>Open to close: <b className={tone(features.intraday)}>{pct(features.intraday)}</b></span>
            <span>Close in day range: <b className="text-text">{features.clv == null ? "–" : `${Math.round(features.clv * 100)}%`}</b></span>
            <span>India VIX: <b className="text-text">{fmt(features.vix, 1)}</b> <b className={tone(features.vixChg == null ? null : -features.vixChg)}>{pct(features.vixChg, 1)}</b></span>
            <span>vs 20-day avg: <b className={tone(features.dist20)}>{pct(features.dist20, 1)}</b></span>
            <span>5-day move: <b className={tone(features.ret5)}>{pct(features.ret5, 1)}</b></span>
            <span>RSI(14): <b className="text-text">{fmt(features.rsi, 0)}</b></span>
            <span>Last 20 nights: <b className={tone(features.ovn20)}>{pct(features.ovn20, 1)}</b></span>
            <span>FII futures long: <b className="text-text">{features.fiiRatio == null ? "–" : `${Math.round(features.fiiRatio * 100)}%`}</b></span>
            <span>Trend: <b className="text-text">{features.above200 ? "above" : "below"} 200d, {features.above50 ? "above" : "below"} 50d</b></span>
          </div>
        </div>

        <div>
          <h3 className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
            Futures and options positioning
            {c.confirm !== "No data" && <Badge kind={c.confirm === "Confirms" ? "up" : c.confirm === "Conflicts" ? "warn" : "muted"}>{c.confirm === "Neutral" ? "Neutral to the call" : `${c.confirm} the call`}</Badge>}
          </h3>
          {!c.futures && !c.options ? (
            <p className="text-sm text-muted">No NSE futures/options file was available to the last scan.</p>
          ) : (
            <div className="grid gap-2 text-sm">
              {c.futures && (
                <div className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>Futures</b> <Badge kind={buildupKind(c.futures.buildup)}>{c.futures.buildup}</Badge>
                    <span className="text-xs text-muted">NSE file of {c.futures.asOf}</span>
                  </div>
                  <div className="num mt-1 text-xs text-muted">
                    Near-month ({c.futures.expiry}) closed {fmt(c.futures.futClose)}, {c.futures.premium >= 0 ? "a premium" : "a discount"} of {fmt(Math.abs(c.futures.premium), 0)} points to spot · open interest {pct(c.futures.oiChgPct, 1)} on the day
                  </div>
                </div>
              )}
              {c.options && (
                <div className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>Options</b> <Badge kind={c.options.view === "Bullish" ? "up" : c.options.view === "Bearish" ? "down" : "muted"}>{c.options.view}</Badge>
                    <span className="text-xs text-muted">expiry {c.options.expiry}, NSE file of {c.options.asOf}</span>
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text/90">{c.options.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              {live && liveView && chain && (
                <div className="rounded-lg border border-accent/50 bg-accent/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>Your live option chain</b> <Badge kind={liveView.view === "Bullish" ? "up" : liveView.view === "Bearish" ? "down" : "muted"}>{liveView.view}</Badge>
                    <span className="text-xs text-muted">{chain.source}, {timeAgo(chain.at)}</span>
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text/90">{liveView.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              <p className="text-[11px] text-muted">
                NSE publishes these files after the close, so at 3:20 PM they describe the previous session unless you upload a live chain. Positioning is shown as confirmation; it is not part of the score because free history is too short to test it properly (see Backtest).
              </p>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">Swing signals (last 3 sessions)</h3>
          {signals.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {signals.map((s) => (
                <li key={s.setup + s.date} className="px-3 py-2">
                  <Badge kind={s.dir === 1 ? "up" : "down"}>{s.dir === 1 ? "BUY" : "SHORT"}</Badge> <b>{SWING_LABEL[s.setup]}</b> <span className="text-muted">on {s.date}</span>
                  <div className="num text-xs">
                    Close {fmt(s.close)} · <span className="text-down">stop {fmt(s.stop)}</span> · <span className="text-up">{s.setup === "bounce" ? "exit on a close above the 5-day average" : `target ${fmt(s.target)}`}</span> · within {s.holdDays} sessions · risk per lot {rupees(Math.abs(s.close - s.stop) * c.lot)}
                  </div>
                  <WhyList className="mt-1" reasons={s.reasons ?? [s.note]} cautions={s.cautions ?? []} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No active swing setup on this index.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
