"use client";
import Link from "next/link";
import { Ideas } from "@/components/ideas";
import { Badge, Card, Notes, Status } from "@/components/ui";
import { fmt, pct, tone, useData } from "@/lib/client";
import type { IndexCall, Meta, Pulse } from "@/lib/types";

export default function PulsePage() {
  const { data: p, error } = useData<Pulse>("pulse.json");
  const { data: meta } = useData<Meta>("meta.json");
  const { data: ix } = useData<{ calls: IndexCall[] }>("index.json");
  if (!p) return <Status error={error} loading />;
  const color = p.label === "Risk-on" ? "text-up" : p.label === "Risk-off" ? "text-down" : "text-warn";
  const pos = ((p.score + 100) / 200) * 100;

  return (
    <div className="grid gap-4">
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
          <div>
            <div className="text-xs text-muted">Market pulse · how friendly is the market to long trades?</div>
            <div className={`mt-1 text-4xl font-semibold ${color}`}>{p.label}</div>
            <div className="num mt-1 text-sm text-muted">Score {p.score > 0 ? "+" : ""}{p.score} on a scale of -100 to +100</div>
            <div className="relative mt-3 h-2 rounded bg-gradient-to-r from-down via-warn to-up">
              <div className="absolute -top-1 h-4 w-1 rounded bg-text" style={{ left: `calc(${pos}% - 2px)` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>Risk-off</span>
              <span>Neutral</span>
              <span>Risk-on</span>
            </div>
          </div>
          <div>
            <p className="text-sm">{p.advice}</p>
            {ix && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {ix.calls.map((c) => (
                  <Link key={c.sym} href="/futures/" className="rounded-lg border border-line bg-panel2 px-3 py-2 hover:border-accent">
                    <div className="text-xs text-muted">{c.name} futures tonight</div>
                    <div className={`text-sm font-semibold ${c.score.call === "LONG" ? "text-up" : c.score.call === "SHORT" ? "text-down" : "text-warn"}`}>
                      {c.score.call === "LONG" ? "Buy for overnight" : c.score.call === "SHORT" ? "Short zone (avoid longs)" : "No overnight trade"} <span className="num font-normal text-muted">score {c.score.score > 0 ? "+" : ""}{c.score.score}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link href="/btst/" className="rounded-lg bg-accent px-3 py-1.5 font-medium text-bg">Stock BTST candidates</Link>
              <Link href="/swing/" className="rounded-lg border border-line bg-panel2 px-3 py-1.5">Swing setups</Link>
            </div>
          </div>
        </div>
      </Card>
      <Notes meta={meta} />
      <Ideas />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What is driving the score">
          <ul className="divide-y divide-line">
            {p.components.map((c) => (
              <li key={c.name} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 py-2.5">
                <div className="text-sm font-medium">{c.name}</div>
                <div className={`num text-right text-sm font-semibold ${tone(c.score)}`}>
                  {c.score > 0 ? "+" : ""}
                  {c.score.toFixed(0)} <span className="font-normal text-muted">/ ±{c.max}</span>
                </div>
                <div className="col-span-2 text-xs text-text/90">{c.value}</div>
                <div className="col-span-2 text-xs text-muted">{c.note}</div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid content-start gap-4">
          <Card title="Markets">
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              {p.tiles.map((t) => (
                <div key={t.sym} className="bg-panel px-3 py-2">
                  <div className="truncate text-xs text-muted">{t.name}</div>
                  <div className="num text-sm font-semibold">{fmt(t.last)}</div>
                  <div className="num text-xs">
                    <span className={tone(t.chg)}>{pct(t.chg)}</span> <span className="text-muted">· 5d {pct(t.chg5, 1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Breadth (stocks with futures)">
            <div className="grid grid-cols-3 gap-px bg-line text-center">
              {[
                ["Up / down today", `${p.breadth.adv} / ${p.breadth.dec}`],
                ["Above 20-day", `${p.breadth.above20}%`],
                ["Above 50-day", `${p.breadth.above50}%`],
                ["Above 200-day", `${p.breadth.above200}%`],
                ["New 20-day highs", `${p.breadth.newHigh20}`],
                ["New 20-day lows", `${p.breadth.newLow20}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel px-2 py-2">
                  <div className="num text-sm font-semibold">{v}</div>
                  <div className="text-[11px] text-muted">{k}</div>
                </div>
              ))}
            </div>
          </Card>
          {p.fii && (
            <Card title={`Who holds index futures (NSE, ${p.fii.asOf})`}>
              <div className="grid gap-2 p-4 text-sm">
                {[
                  ["Foreign investors (FII)", p.fii.ratio],
                  ["Retail and other clients", p.fii.clientRatio],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <div className="flex justify-between text-xs">
                      <span>{k}</span>
                      <span className="num text-muted">{Math.round((v as number) * 100)}% long · {100 - Math.round((v as number) * 100)}% short</span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded bg-down">
                      <div className="bg-up" style={{ width: `${(v as number) * 100}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted">
                  FII: {p.fii.long.toLocaleString("en-IN")} long and {p.fii.short.toLocaleString("en-IN")} short contracts
                  {p.fii.ratio5ago != null && <>; the long share was {Math.round(p.fii.ratio5ago * 100)}% five sessions earlier</>}.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sector indices">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th className="text-right">Today</th>
                  <th className="text-right">5 days</th>
                  <th className="text-right">20 days</th>
                </tr>
              </thead>
              <tbody>
                {p.sectors.map((s) => (
                  <tr key={s.sector}>
                    <td>{s.sector}</td>
                    <td className={`num text-right ${tone(s.chg)}`}>{pct(s.chg)}</td>
                    <td className={`num text-right ${tone(s.chg5)}`}>{pct(s.chg5, 1)}</td>
                    <td className={`num text-right ${tone(s.chg20)}`}>{pct(s.chg20, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="This week: India data and major US events (India time)">
          {p.events.length ? (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {p.events.map((e, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2 text-sm">
                  <div className="num w-24 shrink-0 text-xs text-muted">
                    {e.date.slice(5)} {e.time}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Badge>{e.country}</Badge> {e.name} {e.impact === "high" && <Badge kind="warn">High impact</Badge>}
                    {(e.consensus || e.previous || e.actual) && (
                      <div className="text-xs text-muted">
                        {e.actual && `Actual ${e.actual} · `}
                        {e.consensus && `Forecast ${e.consensus} · `}
                        {e.previous && `Previous ${e.previous}`}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">No calendar data. Check for RBI, inflation and US Fed events before holding overnight.</p>
          )}
          <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Company results dates are not included; check them before taking a stock overnight.</p>
        </Card>
      </div>
    </div>
  );
}
