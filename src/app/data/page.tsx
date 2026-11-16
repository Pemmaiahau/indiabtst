"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { BASE, timeAgo, useChain, useData, useUpload } from "@/lib/client";
import { parseOptionChain, parseQuotes, type ParseResult } from "@/lib/csv";
import { summarizeChain } from "@/lib/options";
import type { Snapshot } from "@/lib/types";

const INDEX_SYMS = ["NIFTY", "BANKNIFTY", "INDIAVIX"];

const SOURCES = [
  {
    name: "Google Sheets (recommended, free)",
    badge: "All columns",
    steps: [
      "Download the Google Sheets template below.",
      "In Google Sheets choose File → Import → Upload, pick the file, and keep “Convert text to numbers, dates and formulas” ticked. Do this once and keep the sheet.",
      "Around 3:15 PM open the sheet, wait for prices to fill in, then File → Download → Comma-separated values (.csv).",
      "Upload that CSV here.",
    ],
    note: "Covers Nifty, Bank Nifty, India VIX and the 50 stocks. Google’s NSE prices can lag by a few minutes, and index rows have no volume.",
    template: "google-sheets-live-quotes.csv",
  },
  {
    name: "Your broker or charting platform",
    badge: "Varies",
    steps: [
      "Export a market-watch or watchlist to CSV or Excel-CSV from your trading terminal.",
      "It needs a Symbol column and an LTP/Last/Price column. Open, High, Low and Volume are used when present.",
      "Name the index rows NIFTY, BANKNIFTY and INDIAVIX (or NIFTY 50, NIFTY BANK, INDIA VIX).",
    ],
    note: "If a file is not recognised, copy its values into the blank template.",
    template: "manual-quotes-template.csv",
  },
];

export default function DataPage() {
  const { data: snap } = useData<Snapshot>("snapshot.json");
  const [upload, setUpload] = useUpload();
  const [result, setResult] = useState<(ParseResult & { file: string; matched: number; idx: string[] }) | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const r = parseQuotes(await file.text());
    const keep = (s: string) => INDEX_SYMS.includes(s) || !snap || !!snap.stocks[s];
    const quotes = Object.fromEntries(Object.entries(r.quotes).filter(([s]) => keep(s)));
    const idx = INDEX_SYMS.filter((s) => quotes[s]);
    const matched = Object.keys(quotes).length - idx.length;
    setResult({ ...r, file: file.name, matched, idx });
    if (!r.error && (matched >= 25 || idx.length > 0)) setUpload({ at: new Date().toISOString(), source: file.name, quotes });
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Upload live data</h1>
        <p className="mt-1 text-sm text-muted">
          The automatic scan uses free prices that lag about 15 minutes, and NSE publishes futures and option data only after the close. Upload your own files near 3:20 PM for a fresher read. Files are read in your browser and stay on this device.
        </p>
      </div>

      <Card title="1. Live quotes (indices and stocks)">
        <div className="grid gap-3 p-4">
          <Drop onFile={handle} hint="Needs a Symbol column and an LTP/Last/Price column. Open, High, Low and Volume are optional." />
          {result &&
            (result.error ? (
              <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm">{result.file}: {result.error}</div>
            ) : result.matched < 25 && result.idx.length === 0 ? (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                {result.file}: found {result.matched} F&O stocks and no index rows ({result.rows} rows read). At least 25 stocks or one index row is needed. Nothing was changed.
              </div>
            ) : (
              <div className="rounded-lg border border-up/40 bg-up/10 p-3 text-sm">
                <b>Loaded {result.matched} stocks{result.idx.length ? ` and ${result.idx.join(", ")}` : ""}</b> from {result.file} (columns used: {result.columns.join(", ")}).
                {result.matched < 25 && <span className="text-warn"> Fewer than 25 stocks, so only the index calls are re-scored.</span>}
                {result.missing.length > 0 && <span className="text-warn"> Not in the file: {result.missing.join(", ")}, so parts of the scores use fallbacks.</span>}{" "}
                <Link href="/futures/" className="font-medium text-accent underline">Index calls</Link> · <Link href="/btst/" className="font-medium text-accent underline">Stock list</Link>
              </div>
            ))}
          {upload && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted">Active upload: {upload.source}, {Object.keys(upload.quotes).length} rows, {timeAgo(upload.at)}</span>
              <button onClick={() => { setUpload(null); setResult(null); }} className="rounded-md border border-line bg-panel2 px-2.5 py-1">Remove</button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {SOURCES.map((s) => (
          <Card key={s.name} title={s.name} right={<Badge kind={s.badge === "All columns" ? "up" : "muted"}>{s.badge}</Badge>}>
            <div className="grid gap-2 p-4 text-sm">
              <ol className="list-decimal space-y-1 pl-5">{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
              <p className="text-xs text-muted">{s.note}</p>
              <a href={`${BASE}/templates/${s.template}`} download className="mt-1 w-fit rounded-lg bg-accent px-3 py-1.5 font-medium text-bg">
                Download {s.template.includes("google") ? "Google Sheets template" : "blank template"}
              </a>
            </div>
          </Card>
        ))}
      </div>

      <Card title="2. Live option chain (optional)">
        <div className="grid gap-3 p-4 text-sm">
          <p>
            On the NSE website open <a href="https://www.nseindia.com/option-chain" target="_blank" rel="noreferrer" className="text-accent underline">Option Chain</a>, choose NIFTY or BANKNIFTY and the nearest expiry, and press the download (CSV) button. Upload that file below; the Futures page then shows a live put/call ratio, the biggest call and put strikes and max pain next to the previous day&apos;s figures.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChainDrop sym="NIFTY" name="Nifty" />
            <ChainDrop sym="BANKNIFTY" name="Bank Nifty" />
          </div>
          <p className="text-xs text-muted">
            A simple file also works: columns Strike, Call OI, Call Chg OI, Put OI, Put Chg OI. The NSE layout was coded from its published format and could not be checked against a live download here, so if a file is rejected use the simple layout.
          </p>
        </div>
      </Card>

      <Card title="Quote file format">
        <div className="grid gap-2 p-4 text-sm">
          <pre className="overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs">{"Symbol,Last,Open,High,Low,Volume\nNIFTY,25144.30,25210.00,25260.50,25090.10,\nBANKNIFTY,61034.10,61200.00,61310.00,60880.00,\nINDIAVIX,15.50,,,,\nRELIANCE,1339.70,1345.00,1352.40,1334.10,13756247"}</pre>
          <p className="text-xs text-muted">
            Accepted column names: Symbol/Ticker/Scrip; Last/LTP/Price/Close; Open; High; Low; Volume. Rupee signs and commas are handled. Symbols may be written RELIANCE, NSE:RELIANCE, RELIANCE.NS or RELIANCE-EQ. Upload during or after a session: scores compare your prices with the previous close.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Drop({ onFile, hint }: { onFile: (f: File | undefined) => void; hint: string }) {
  return (
    <label
      className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line bg-panel2 px-4 py-6 text-center text-sm hover:border-accent"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <span className="font-medium">Choose a CSV file or drop it here</span>
      <span className="text-xs text-muted">{hint}</span>
      <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

function ChainDrop({ sym, name }: { sym: string; name: string }) {
  const [chain, setChain] = useChain(sym);
  const [err, setErr] = useState<string | null>(null);
  const s = chain ? summarizeChain(chain.rows) : null;
  return (
    <div className="grid gap-2">
      <div className="text-xs font-semibold text-muted">{name}</div>
      <Drop
        hint={`${name} option chain CSV`}
        onFile={async (f) => {
          if (!f) return;
          const r = parseOptionChain(await f.text());
          setErr(r.error ?? null);
          if (!r.error) setChain({ at: new Date().toISOString(), source: f.name, rows: r.rows });
        }}
      />
      {err && <div className="rounded-lg border border-down/40 bg-down/10 p-2 text-xs">{err}</div>}
      {chain && s && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            {chain.rows.length} strikes, put/call ratio {s.pcr.toFixed(2)}, calls heaviest at {s.callWall}, puts at {s.putWall} ({timeAgo(chain.at)})
          </span>
          <button onClick={() => setChain(null)} className="rounded-md border border-line bg-panel2 px-2 py-0.5">Remove</button>
        </div>
      )}
    </div>
  );
}
