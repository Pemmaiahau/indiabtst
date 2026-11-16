"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PriceChart, SERIES, type BarTuple } from "@/components/charts";
import { Badge, buildupKind, Card, ScoreBar, Status, WhyList } from "@/components/ui";
import { BTST_PARTS, BTST_WEIGHTS } from "@/lib/btst";
import { fmt, pct, rupees, timeAgo, tone, useData } from "@/lib/client";
import { btstWhy } from "@/lib/reasons";
import { SWING_LABEL } from "@/lib/swing";
import type { BtstRow, Meta, SwingSignal } from "@/lib/types";

type StockFile = { sym: string; name: string; sector: string; bars: BarTuple[] };
type News = Record<string, { title: string; link: string; date: string; tone: "pos" | "neg" | "neutral" }[]>;

export default function Page() {
  return (
    <Suspense fallback={<Status error={null} loading />}>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  const sp = useSearchParams();
  const router = useRouter();
  const sym = (sp.get("s") ?? "").toUpperCase().replace(/[^A-Z0-9&-]/g, "");
  const stop = Number(sp.get("stop")) || undefined;
  const target = Number(sp.get("target")) || undefined;
  const [q, setQ] = useState("");
  const { data: scan } = useData<{ meta: Meta; rows: BtstRow[] }>("btst.json");
  const { data: stock, error } = useData<StockFile>(sym ? `stocks/${encodeURIComponent(sym)}.json` : null);
  const { data: swing } = useData<{ signals: SwingSignal[] }>("swing.json");
  const { data: news } = useData<News>("news.json");

  const search = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const s = q.trim().toUpperCase();
        if (s) router.push(`/stock/?s=${encodeURIComponent(s)}`);
        setQ("");
      }}
    >
      <input list="syms" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol, e.g. RELIANCE" className="w-48" aria-label="Symbol" />
      <datalist id="syms">
        <option value="NIFTY">Nifty 50</option>
        <option value="BANKNIFTY">Bank Nifty</option>
        {scan?.rows.map((r) => <option key={r.sym} value={r.sym}>{r.name}</option>)}
      </datalist>
      <button className="rounded-lg bg-accent px-3 font-medium text-bg">Open</button>
    </form>
  );

  if (!sym) return <div className="grid gap-3"><h1 className="text-xl font-semibold">Chart and detail</h1>{search}<p className="text-sm text-muted">Open NIFTY, BANKNIFTY or any stock that has futures.</p></div>;
  if (!stock) return <div className="grid gap-3">{search}<Status error={error ? `${sym} is not in the scan (Nifty, Bank Nifty and the stocks that have futures), or no scan has run yet.` : null} loading={!error} /></div>;

  const isIndex = stock.sector === "Index";
  const row = scan?.rows.find((r) => r.sym === sym);
  const signals = swing?.signals.filter((s) => s.sym === sym) ?? [];
  const items = news?.[sym] ?? [];
  const last = stock.bars[stock.bars.length - 1];
  const prev = stock.bars[stock.bars.length - 2];
  const hi52 = Math.max(...stock.bars.slice(-252).map((b) => b[2]));
  const lo52 = Math.min(...stock.bars.slice(-252).map((b) => b[3]));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {sym} <span className="font-normal text-muted">{stock.name}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="num text-2xl font-semibold">{fmt(last[4])}</span>
            <span className={`num ${tone(last[4] - prev[4])}`}>{pct((last[4] / prev[4] - 1) * 100)}</span>
            <Badge>{stock.sector}</Badge>
            {row?.fo && <Badge kind={buildupKind(row.fo.buildup)}>{row.fo.buildup}</Badge>}
            {row?.ex?.n50 && <Badge>Nifty 50</Badge>}
            {row?.ex?.ban && <Badge kind="down">F&amp;O ban</Badge>}
            <span className="text-xs text-muted">52-week range {fmt(lo52, 0)} to {fmt(hi52, 0)}</span>
          </div>
        </div>
        {search}
      </div>

      <Card
        title={`Daily chart to ${last[0]}`}
        right={
          <div className="flex gap-3 text-xs text-muted">
            {["EMA 20", "SMA 50", "SMA 200"].map((n, i) => (
              <span key={n} className="flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: SERIES[i] }} />{n}</span>
            ))}
          </div>
        }
      >
        <PriceChart bars={stock.bars} stop={stop} target={target} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {!isIndex && (
          <Card title="Overnight (BTST) score" right={row && <ScoreBar score={row.score} />}>
            {row ? (
              <ul className="divide-y divide-line text-sm">
                {Object.entries(BTST_PARTS).map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span>{label}</span>
                    <span className="num shrink-0">{row.parts[k] == null ? "–" : row.parts[k].toFixed(0)} <span className="text-muted">/ {BTST_WEIGHTS[k as keyof typeof BTST_WEIGHTS]}</span></span>
                  </li>
                ))}
                <li className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted sm:grid-cols-3">
                  <span>RSI(14): <b className="text-text">{fmt(row.rsi, 0)}</b></span>
                  <span>Daily swing: <b className="text-text">{fmt(row.atrPct, 1)}%</b></span>
                  <span>Volume: <b className="text-text">{row.rvol == null ? "–" : `${row.rvol.toFixed(1)}x avg`}</b></span>
                  <span>60 nights: <b className={tone(row.ovn60)}>{pct(row.ovn60, 1)}</b></span>
                  <span>20 days intraday: <b className={tone(row.intr20)}>{pct(row.intr20, 1)}</b></span>
                  <span>20-day return: <b className={tone(row.ret20)}>{pct(row.ret20, 1)}</b></span>
                  <span>Above averages: <b className="text-text">{[row.above20 && "20d", row.above50 && "50d", row.above200 && "200d"].filter(Boolean).join(", ") || "none"}</b></span>
                  {row.fo && <span>Futures lot: <b className="text-text">{row.fo.lot} ({rupees(row.fo.lot * row.price)})</b></span>}
                  {row.fo && <span>Futures OI: <b className={tone(row.fo.oiChgPct)}>{pct(row.fo.oiChgPct, 1)}</b>{row.fo.pcr != null && <> · options PCR <b className="text-text">{row.fo.pcr.toFixed(2)}</b></>}</span>}
                  {row.ex && <span>12-month return: <b className={tone(row.ex.ret250)}>{pct(row.ex.ret250, 0)}</b> (rank {Math.round(row.ex.rs * 100)} of 100)</span>}
                  {row.ex && <span>Below 52-week high: <b className="text-text">{fmt(row.ex.dist52, 1)}%</b></span>}
                  {row.ex?.deliv != null && <span>Delivery: <b className="text-text">{fmt(row.ex.deliv, 0)}%</b>{row.ex.delivAvg != null && <> (usual {fmt(row.ex.delivAvg, 0)}%)</>}</span>}
                </li>
                <li className="px-4 py-3">
                  <div className="mb-1 text-xs font-semibold text-muted">{row.score >= 50 ? "For and against carrying it long overnight" : "For and against selling it overnight"}</div>
                  <WhyList {...btstWhy(row, row.score >= 50 ? "buy" : "sell")} />
                </li>
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">No score for this stock in the latest scan.</p>
            )}
          </Card>
        )}

        <div className="grid content-start gap-4">
          <Card title="Swing setups">
            {signals.length ? (
              <ul className="divide-y divide-line text-sm">
                {signals.map((s) => (
                  <li key={s.setup + s.date} className="px-4 py-2.5">
                    <Badge kind={s.dir === 1 ? "up" : "down"}>{s.dir === 1 ? "BUY" : "SHORT"}</Badge> <b>{SWING_LABEL[s.setup]}</b> <span className="text-muted">on {s.date}</span>
                    <div className="num text-xs">
                      Close {fmt(s.close)} · <span className="text-down">stop {fmt(s.stop)}</span> · <span className="text-up">{s.setup === "bounce" ? "exit on a close above the 5-day average" : `target ${fmt(s.target)}`}</span> · within {s.holdDays} sessions
                    </div>
                    <WhyList className="mt-1" reasons={s.reasons ?? [s.note]} cautions={s.cautions ?? []} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">No active swing setup.</p>
            )}
          </Card>

          {!isIndex && (
            <Card title="Recent headlines">
              {items.length ? (
                <ul className="divide-y divide-line text-sm">
                  {items.map((n) => (
                    <li key={n.link} className="flex gap-2 px-4 py-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.tone === "pos" ? "bg-up" : n.tone === "neg" ? "bg-down" : "bg-muted"}`} title={n.tone === "pos" ? "Positive wording" : n.tone === "neg" ? "Negative wording" : "Neutral"} />
                      <a href={n.link} target="_blank" rel="noreferrer" className="hover:underline">
                        {n.title} <span className="whitespace-nowrap text-xs text-muted">{timeAgo(n.date)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted">No recent headlines were found for this stock. Use the links below.</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs">
                <span className="text-muted">Check elsewhere:</span>
                <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`}>NSE (results, announcements)</a>
                <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}.NS`}>Yahoo</a>
                <a className="text-accent underline" target="_blank" rel="noreferrer" href={`https://www.tradingview.com/symbols/NSE-${encodeURIComponent(sym.replace(/[&-]/g, "_"))}/`}>TradingView</a>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
