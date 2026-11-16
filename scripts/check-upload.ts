// Sanity check (npm run check), run after `npm run scan`:
// 1. uploading the scan day's own bars must reproduce the scan's stock scores and index calls;
// 2. symbol spellings and the two option-chain layouts must parse.
import { readFileSync } from "node:fs";
import { scoreBtstDay } from "../src/lib/btst";
import { normSym, parseOptionChain, parseQuotes } from "../src/lib/csv";
import { indexFeatures, indexScore } from "../src/lib/indexcall";
import { summarizeChain } from "../src/lib/options";

const read = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, "utf8"));
const snap = read("snapshot.json");
const scan = read("btst.json");
const index = read("index.json");
let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};

// --- 1. round trip through a CSV in "broker export" style
const lines = ["Scrip,LTP,Open,High,Low,Volume"];
const lastBar = (sym: string) => read(`stocks/${sym}.json`).bars.at(-1);
for (const sym of Object.keys(snap.stocks)) {
  const b = lastBar(sym);
  lines.push([`NSE:${sym}`, `"₹` + b[4].toLocaleString("en-IN") + `"`, b[1], b[2], b[3], `"` + b[5].toLocaleString("en-IN") + `"`].join(","));
}
for (const [label, sym] of [["INDEXNSE:NIFTY_50", "NIFTY"], ["Nifty Bank", "BANKNIFTY"]]) {
  const b = lastBar(sym);
  lines.push([label, b[4], b[1], b[2], b[3], ""].join(","));
}
const vix = index.calls[0].features.vix;
if (vix != null) lines.push(`INDIA VIX,${vix},,,,`);
const r = parseQuotes(lines.join("\r\n"));
check("quotes parsed", r.rows === Object.keys(snap.stocks).length + 2 + (vix != null ? 1 : 0), `${r.rows} rows`);

const rows = scoreBtstDay(
  Object.entries(r.quotes).filter(([s]) => snap.stocks[s]).map(([sym, q]) => ({ sym, name: "", sector: snap.stocks[sym].sector, ctx: snap.stocks[sym].ctx, bar: q })),
  snap.meta.volFrac,
);
let maxDiff = 0;
for (const x of rows) maxDiff = Math.max(maxDiff, Math.abs(scan.rows.find((y: { sym: string }) => y.sym === x.sym).score - x.score));
check("stock scores reproduce the scan", maxDiff <= 1.5, `max difference ${maxDiff.toFixed(2)}`);

for (const c of index.calls) {
  const q = r.quotes[c.sym];
  const s = q ? indexScore(indexFeatures(c.ctx, q, r.quotes.INDIAVIX?.c ?? null)).score : NaN;
  check(`${c.sym} score reproduces the scan`, Math.abs(s - c.score.score) <= 1, `${s} vs ${c.score.score}`);
}

// --- 2. symbols and option chains
check("symbol spellings", normSym("NSE:M&M") === "M&M" && normSym("bajaj-auto.ns") === "BAJAJ-AUTO" && normSym("RELIANCE-EQ") === "RELIANCE" && normSym("^NSEI") === "NIFTY" && normSym("NIFTY BANK") === "BANKNIFTY");

const strikes = [24800, 24900, 25000, 25100, 25200, 25300];
const nseStyle = [
  "CALLS,,PUTS",
  ",OI,CHNG IN OI,VOLUME,IV,LTP,CHNG,BID QTY,BID,ASK,ASK QTY,STRIKE,BID QTY,BID,ASK,ASK QTY,CHNG,LTP,IV,VOLUME,CHNG IN OI,OI,",
  ...strikes.map((k, i) => `,"${(1000 * (i + 1)).toLocaleString("en-IN")}",${100 * i},5,12.1,50,-2,75,49,51,75,"${k.toLocaleString("en-US")}.00",75,40,42,75,3,41,13.2,7,${-50 * i},"${(6000 - 900 * i).toLocaleString("en-IN")}",`),
].join("\n");
const a = parseOptionChain(nseStyle);
const sa = summarizeChain(a.rows);
check("NSE-style option chain", !a.error && a.rows.length === 6 && a.rows[0].callOi === 1000 && a.rows[0].putOi === 6000 && a.rows[5].putChg === -250 && sa?.callWall === 25300 && sa?.putWall === 24800, a.error ?? `pcr ${sa?.pcr}`);
const simple = ["Strike,Call OI,Call Chg OI,Put OI,Put Chg OI", ...strikes.map((k, i) => `${k},${1000 * (i + 1)},${100 * i},${6000 - 900 * i},${-50 * i}`)].join("\n");
const b2 = parseOptionChain(simple);
check("simple option chain", !b2.error && JSON.stringify(b2.rows) === JSON.stringify(a.rows), b2.error ?? "");

if (failed) {
  console.error("CHECK FAILED");
  process.exit(1);
}
