"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, StockLink } from "@/components/ui";
import { SELL_MAX } from "@/lib/btst";
import { fmt, MAX_PICKS, MIN_SCORE, useData } from "@/lib/client";
import { btstWhy, indexWhy } from "@/lib/reasons";
import { SWING_LABEL } from "@/lib/swing";
import type { Backtest, BtstRow, IndexCall, Meta, SwingSignal } from "@/lib/types";

function Idea({ head, sub, why, weak }: { head: ReactNode; sub?: ReactNode; why: string[]; weak?: string }) {
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">{head}</div>
      {sub && <div className="num text-xs text-muted">{sub}</div>}
      <ul className="mt-0.5 grid gap-0.5 text-xs text-text/90">
        {why.map((t) => (
          <li key={t} className="flex gap-1.5">
            <span className="shrink-0 font-semibold text-up">+</span>
            <span>{t}</span>
          </li>
        ))}
        {weak && (
          <li className="flex gap-1.5">
            <span className="shrink-0 font-semibold text-warn">!</span>
            <span className="text-muted">{weak}</span>
          </li>
        )}
      </ul>
    </li>
  );
}

/** One screen of the day's buy and sell ideas: index futures first, then stock futures, each with its reasons. */
export function Ideas() {
  const { data: ix } = useData<{ meta: Meta; calls: IndexCall[] }>("index.json");
  const { data: btst } = useData<{ rows: BtstRow[] }>("btst.json");
  const { data: sw } = useData<{ signals: SwingSignal[] }>("swing.json");
  const { data: bt } = useData<Backtest>("backtest.json");
  if (!ix || !btst || !sw) return null;

  const stat = (s: SwingSignal) => bt?.swing.find((x) => x.setup === s.setup);
  const avg = (s: SwingSignal) => (s.kind === "index" ? stat(s)?.index.avg : stat(s)?.stocks.avg) ?? 0;
  const newest = (dir: 1 | -1, kind: "stock" | "index") => {
    const seen = new Set<string>();
    return sw.signals
      .filter((s) => s.dir === dir && s.kind === kind && !s.ex?.ban)
      .sort((a, b) => b.date.localeCompare(a.date) || avg(b) - avg(a) || a.cautions.length - b.cautions.length)
      .filter((s) => !seen.has(s.sym) && !!seen.add(s.sym));
  };
  const swingIdea = (s: SwingSignal) => (
    <Idea
      key={s.sym + s.setup + s.date}
      head={
        <>
          <Badge kind={s.dir === 1 ? "up" : "down"}>{s.dir === 1 ? "BUY" : "SHORT"}</Badge>
          {s.kind === "index" ? <Link href="/futures/" className="font-semibold text-accent hover:underline">{s.sym} futures</Link> : <StockLink sym={s.sym} params={`&stop=${s.stop}&target=${s.target}`} />}
          <span>swing · {SWING_LABEL[s.setup]}</span>
        </>
      }
      sub={`Signal ${s.date.slice(5)} at ${fmt(s.close)} · stop ${fmt(s.stop)} · ${s.setup === "bounce" ? "exit on a close above the 5-day average" : `target ${fmt(s.target)}`} · within ${s.holdDays} sessions`}
      why={s.reasons.slice(0, 3)}
      weak={s.cautions[0]}
    />
  );

  const picks = btst.rows.filter((r) => r.score >= MIN_SCORE && !r.ex?.ban).slice(0, MAX_PICKS);
  const marketOk = (ix.calls.find((c) => c.sym === "NIFTY")?.score.score ?? 0) > 0;
  const sells = btst.rows.filter((r) => r.score <= SELL_MAX).slice(-2).reverse();
  const sellStat = bt?.btst.sell[0]?.stats;
  const buySwing = [...newest(1, "index"), ...newest(1, "stock").filter((s) => avg(s) >= 0.03).slice(0, 4)];
  const sellSwing = [...newest(-1, "index"), ...newest(-1, "stock").slice(0, 4)];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Buy ideas" right={<span className="text-xs text-muted">index futures first, then stock futures</span>}>
        <ul className="divide-y divide-line">
          {ix.calls.map((c) => {
            const w = indexWhy(c.features, c.score);
            return c.score.call === "LONG" ? (
              <Idea
                key={c.sym}
                head={
                  <>
                    <Badge kind="up">BUY</Badge>
                    <Link href="/futures/" className="font-semibold text-accent hover:underline">{c.sym} futures</Link>
                    <span>overnight · score +{c.score.score}</span>
                  </>
                }
                sub="Buy near 3:20 PM, sell at the next open"
                why={w.bull.slice(0, 3)}
                weak={w.bear[0]}
              />
            ) : null;
          })}
          {picks.map((r) => {
            const w = btstWhy(r, "buy");
            return (
              <Idea
                key={r.sym}
                head={
                  <>
                    <Badge kind="up">BUY</Badge>
                    <StockLink sym={r.sym} />
                    <span>overnight · score {r.score.toFixed(0)}</span>
                  </>
                }
                sub={`${fmt(r.price)} · buy the future near 3:20 PM, sell at the next open${r.fo ? ` · lot ${r.fo.lot}` : ""}`}
                why={w.reasons.slice(0, 3)}
                weak={marketOk ? w.cautions[0] : "The Nifty overnight score is not above 0 tonight: stock BTST tested worse on such nights"}
              />
            );
          })}
          {buySwing.map(swingIdea)}
          {!ix.calls.some((c) => c.score.call === "LONG") && !picks.length && !buySwing.length && <li className="p-4 text-sm text-muted">No buy idea passes the rules right now. No trade is a valid outcome.</li>}
        </ul>
        <div className="flex flex-wrap gap-x-4 border-t border-line px-4 py-2 text-xs">
          <Link href="/futures/" className="text-accent underline">Index futures</Link>
          <Link href="/btst/" className="text-accent underline">All overnight candidates</Link>
          <Link href="/swing/" className="text-accent underline">All swing setups</Link>
        </div>
      </Card>

      <Card title="Sell ideas" right={<span className="text-xs text-muted">shorts need futures</span>}>
        <ul className="divide-y divide-line">
          {ix.calls.map((c) => {
            const w = indexWhy(c.features, c.score);
            return c.score.call === "SHORT" ? (
              <Idea
                key={c.sym}
                head={
                  <>
                    <Badge kind="down">AVOID LONGS</Badge>
                    <Link href="/futures/" className="font-semibold text-accent hover:underline">{c.sym} futures</Link>
                    <span>overnight · score {c.score.score}</span>
                  </>
                }
                why={w.bear.slice(0, 3)}
                weak="Shorting the index overnight lost money in the test, so this is a warning against carrying longs rather than a short call"
              />
            ) : null;
          })}
          {sellSwing.map(swingIdea)}
          {sells.map((r) => {
            const w = btstWhy(r, "sell");
            return (
              <Idea
                key={r.sym}
                head={
                  <>
                    <Badge kind="down">SELL WATCH</Badge>
                    <StockLink sym={r.sym} />
                    <span>overnight · score {r.score.toFixed(0)}</span>
                  </>
                }
                why={w.reasons.slice(0, 2)}
                weak={sellStat ? `Overnight selling averaged ${sellStat.avg > 0 ? "+" : ""}${sellStat.avg.toFixed(3)}% per trade in the test: treat as “do not carry long”, not as a short` : undefined}
              />
            );
          })}
          {!sellSwing.length && !sells.length && !ix.calls.some((c) => c.score.call === "SHORT") && <li className="p-4 text-sm text-muted">No sell idea right now.</li>}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
          Over the nine years tested the market rose and no short rule made reliable money. Each idea shows how its setup tested; size shorts accordingly.
        </p>
      </Card>
    </div>
  );
}
