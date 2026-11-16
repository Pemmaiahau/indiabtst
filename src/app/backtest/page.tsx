"use client";
import { CurveChart } from "@/components/charts";
import { Badge, Card, Status } from "@/components/ui";
import { pct, tone, useData } from "@/lib/client";
import { SWING_LABEL } from "@/lib/swing";
import type { Backtest, Bucket, TradeStats, Variant, YearRow } from "@/lib/types";

const r = (x: number, d = 2) => `${x > 0 ? "+" : ""}${x.toFixed(d)}R`;
const n = (x: number) => x.toLocaleString("en-IN");

function VariantTable({ variants }: { variants: Variant[] }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            <th className="text-right">Trades</th>
            <th className="text-right">Winners</th>
            <th className="text-right">Avg / trade</th>
            <th className="text-right">Avg win</th>
            <th className="text-right">Avg loss</th>
            <th className="text-right" title="Gross profit divided by gross loss">Profit factor</th>
            <th className="text-right" title="Compounded, one position at a time, no leverage">Total</th>
            <th className="text-right">Worst drawdown</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.name}>
              <td className="whitespace-normal">{v.name}</td>
              <td className="num text-right">{n(v.stats.n)}</td>
              <td className="num text-right">{v.stats.winRate.toFixed(1)}%</td>
              <td className={`num text-right ${tone(v.stats.avg)}`}>{pct(v.stats.avg, 3)}</td>
              <td className="num text-right">{pct(v.stats.avgWin)}</td>
              <td className="num text-right">{pct(v.stats.avgLoss)}</td>
              <td className="num text-right">{v.stats.profitFactor.toFixed(2)}</td>
              <td className={`num text-right ${tone(v.stats.total)}`}>{pct(v.stats.total, 0)}</td>
              <td className="num text-right">-{v.stats.maxDD.toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketTable({ rows, unit, head }: { rows: Bucket[]; unit: string; head: string }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>{head}</th>
            <th className="text-right">{unit}</th>
            <th className="text-right">Avg overnight move</th>
            <th className="text-right">Up nights</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.bucket}>
              <td>{x.bucket}</td>
              <td className="num text-right">{n(x.n)}</td>
              <td className={`num text-right ${tone(x.avg)}`}>{pct(x.avg, 3)}</td>
              <td className="num text-right">{x.winRate.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearTable({ rows, total }: { rows: YearRow[]; total: string }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th className="text-right">Trades</th>
            <th className="text-right">Winners</th>
            <th className="text-right">Avg / trade</th>
            <th className="text-right">{total}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((y) => (
            <tr key={y.year}>
              <td>{y.year}</td>
              <td className="num text-right">{y.n}</td>
              <td className="num text-right">{y.winRate.toFixed(1)}%</td>
              <td className={`num text-right ${tone(y.avg)}`}>{pct(y.avg, 3)}</td>
              <td className={`num text-right ${tone(y.total)}`}>{pct(y.total, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell = (s: TradeStats) => (s.n ? `${r(s.avg, 3)} · ${s.winRate.toFixed(0)}% · ${n(s.n)}` : "–");

export default function BacktestPage() {
  const { data: b, error } = useData<Backtest>("backtest.json");
  if (!b) return <Status error={error} loading />;
  const nifty = b.index[0];
  const long = nifty?.variants[0].stats;
  const short = nifty?.variants[1].stats;
  const last2 = nifty?.byYear.slice(-2) ?? [];
  const years = [...new Set(b.swing.flatMap((s) => s.byYear.map((y) => y.year)))].sort();
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Backtest: do these rules actually work?</h1>
        <p className="mt-1 text-sm text-muted">Every rule on this site replayed over about nine years, after costs. Recomputed on every scan.</p>
      </div>

      <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
        <b>Read this first.</b>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {long && <li>Overnight longs have worked: buying Nifty futures on a strong close averaged {pct(long.avg, 3)} per trade with {long.winRate.toFixed(0)}% winners.</li>}
          {last2.length === 2 && <li>That edge has shrunk recently: {last2.map((y) => `${y.year} ${pct(y.avg, 3)} per trade, ${y.winRate.toFixed(0)}% winners`).join("; ")}.</li>}
          {short && <li>Overnight shorts have not worked: shorting Nifty futures on a weak close averaged {pct(short.avg, 3)} per trade. The short swing setups also lost money. The market rose over this period, so every short rule fought the trend.</li>}
          <li>Stock BTST is tested on every stock that has futures; delivery costs take most of the edge, so it is a futures trade.</li>
          <li>Stock results look better than they can be traded: they assume the official close and open prices and use today&apos;s F&amp;O list for all nine years. Treat the by-year tables, especially the latest year, as the realistic guide.</li>
        </ul>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text/90">{b.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>

      {b.index.map((x) => (
        <Card key={x.sym} title={`${x.name} futures overnight (${x.from} to ${x.to})`}>
          <p className="px-4 pt-3 text-xs text-muted">{x.rules}</p>
          <CurveChart series={x.variants.map((v) => ({ name: v.name, points: v.curve }))} />
          <VariantTable variants={x.variants} />
          <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2">
            <div className="bg-panel">
              <div className="px-4 pt-3 text-xs font-semibold text-muted">Does a higher score mean a better night? (before costs)</div>
              <BucketTable rows={x.buckets} unit="Nights" head="Score" />
            </div>
            <div className="bg-panel">
              <div className="px-4 pt-3 text-xs font-semibold text-muted">Buy side by year</div>
              <YearTable rows={x.byYear} total="Sum for the year" />
            </div>
          </div>
        </Card>
      ))}

      <Card title={`Stock futures overnight, all F&O stocks (${b.btst.from} to ${b.btst.to})`}>
        <p className="px-4 pt-3 text-xs text-muted">{b.btst.rules}</p>
        <CurveChart series={b.btst.variants.map((v) => ({ name: v.name, points: v.curve }))} />
        <p className="px-4 text-[11px] text-muted">Totals compound every night for nine years with no limits on size, so they are far larger than anything achievable; compare the lines, not the percentages.</p>
        <VariantTable variants={b.btst.variants} />
        <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2">
          <div className="bg-panel">
            <div className="px-4 pt-3 text-xs font-semibold text-muted">Does a higher score mean a better night? (before costs)</div>
            <BucketTable rows={b.btst.buckets} unit="Stock-nights" head="Score" />
          </div>
          <div className="bg-panel">
            <div className="px-4 pt-3 text-xs font-semibold text-muted">Top 3 picks via futures, by year</div>
            <YearTable rows={b.btst.byYear} total="Sum for the year" />
          </div>
        </div>
      </Card>

      <Card title="Overnight selling (STBT) and the textbook patterns">
        <p className="px-4 pt-3 text-xs text-muted">
          The sell side of the score, and the patterns most traders use: the textbook BTST close (up 2%+, closing at the high on 1.5x volume at a 20-day high) and its mirror image for selling. Through futures, after costs.
        </p>
        <VariantTable variants={[...b.btst.sell, ...b.btst.conventional]} />
        <div className="border-t border-line">
          <div className="px-4 pt-3 text-xs font-semibold text-muted">Textbook BTST by year</div>
          <YearTable rows={b.btst.conventionalByYear} total="Sum for the year" />
        </div>
      </Card>

      <Card title="Swing setups (results in R: 1R = the amount risked to the stop; futures costs)">
        <CurveChart series={b.swing.map((s) => ({ name: SWING_LABEL[s.setup], points: s.curve }))} suffix="R" />
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Setup</th>
                <th className="text-right" title="Average result · winners · trades">Stocks</th>
                <th className="text-right" title="Average result · winners · trades">Nifty and Bank Nifty</th>
                <th className="text-right" title="Stock trades taken while Nifty was above its 200-day average">Nifty above 200d</th>
                <th className="text-right" title="Stock trades taken while Nifty was below its 200-day average">Nifty below 200d</th>
                <th className="text-right" title="Stock trades since the start of last year">Since last year</th>
                <th className="text-right">Avg %</th>
                <th className="text-right">Profit factor (stocks)</th>
                <th className="text-right">Avg hold</th>
                <th className="text-right" title="Largest peak-to-trough fall in cumulative R on stocks, taking every signal">Worst run</th>
              </tr>
            </thead>
            <tbody>
              {b.swing.map((s) => (
                <tr key={s.setup}>
                  <td>
                    <Badge kind={s.dir === 1 ? "up" : "down"}>{s.dir === 1 ? "BUY" : "SHORT"}</Badge> {SWING_LABEL[s.setup]}
                  </td>
                  <td className={`num text-right ${tone(s.stocks.avg)}`}>{cell(s.stocks)}</td>
                  <td className={`num text-right ${tone(s.index.avg)}`}>{cell(s.index)}</td>
                  <td className={`num text-right ${tone((s.dir === 1 ? s.withTrend : s.againstTrend).avg)}`}>{cell(s.dir === 1 ? s.withTrend : s.againstTrend)}</td>
                  <td className={`num text-right ${tone((s.dir === 1 ? s.againstTrend : s.withTrend).avg)}`}>{cell(s.dir === 1 ? s.againstTrend : s.withTrend)}</td>
                  <td className={`num text-right ${tone(s.recent.avg)}`}>{cell(s.recent)}</td>
                  <td className={`num text-right ${tone(s.avgPct)}`}>{pct(s.avgPct)}</td>
                  <td className="num text-right">{s.stocks.profitFactor.toFixed(2)}</td>
                  <td className="num text-right">{s.avgHold.toFixed(1)} d</td>
                  <td className="num text-right">-{s.stocks.maxDD.toFixed(0)}R</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table>
            <thead>
              <tr>
                <th>Avg result by year</th>
                {years.map((y) => <th key={y} className="text-right">{y}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.swing.map((s) => (
                <tr key={s.setup}>
                  <td>{SWING_LABEL[s.setup]}</td>
                  {years.map((y0) => {
                    const y = s.byYear.find((v) => v.year === y0);
                    return <td key={y0} className={`num text-right ${tone(y?.avg)}`}>{y ? r(y.avg) : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-1 border-t border-line p-4 text-xs text-muted">{b.swing.map((s) => <li key={s.setup}>{s.rules}</li>)}</ul>
      </Card>

      <Card title="Option put/call ratio versus the next night">
        {b.options ? (
          <>
            <p className="px-4 pt-3 text-xs text-muted">
              Nifty&apos;s nearest-expiry put/call ratio from each day&apos;s NSE file, against the overnight move one session later (the first night on which the file could be used). {b.options.days} sessions, {b.options.from} to {b.options.to}. This is too little history to rely on, which is why options are shown as confirmation and are not part of the score.
            </p>
            <BucketTable rows={b.options.rows} unit="Nights" head="Put/call ratio" />
          </>
        ) : (
          <p className="p-4 text-sm text-muted">Fewer than 60 sessions of NSE option files are cached so far, so there is nothing to test yet. Each scan adds more; `npm run prefetch` adds them in bulk.</p>
        )}
      </Card>
    </div>
  );
}
