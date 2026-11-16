// Refreshes data/universe.json and the upload templates.
// The universe is every stock that has futures on NSE (taken from the newest cached F&O file in ./cache/fo),
// named and sectored from NSE's Nifty 500 list, with Nifty 50 members flagged.
// Run occasionally: npm run universe
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

type U = { sym: string; name: string; sector: string; n50?: boolean };
const HOST = "https://nsearchives.nseindia.com/content/indices";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function list(file: string): Promise<U[]> {
  const res = await fetch(`${HOST}/${file}`, { headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const rows = (await res.text()).split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => l.split(","));
  return rows.map((r) => ({ sym: r[2]?.trim(), name: r[0]?.trim().replace(/ (Ltd\.?|Limited)$/i, ""), sector: r[1]?.trim() })).filter((u) => u.sym && /^[A-Z0-9&-]+$/.test(u.sym));
}

async function main() {
  let universe: U[];
  try {
    const foFiles = existsSync("cache/fo") ? readdirSync("cache/fo").sort() : [];
    let foSyms: string[] = [];
    for (let i = foFiles.length - 1; i >= 0 && !foSyms.length; i--) {
      const day = JSON.parse(readFileSync(`cache/fo/${foFiles[i]}`, "utf8"));
      if (day.stocks) foSyms = Object.keys(day.stocks);
    }
    const n50 = await list("ind_nifty50list.csv");
    if (n50.length < 45 || n50.length > 55) throw new Error(`expected about 50 Nifty members, got ${n50.length}`);
    await new Promise((r) => setTimeout(r, 1500));
    const n500 = await list("ind_nifty500list.csv");
    const info = new Map([...n500, ...n50].map((u) => [u.sym, u]));
    const is50 = new Set(n50.map((u) => u.sym));
    const syms = [...new Set([...foSyms, ...is50])].sort();
    if (foSyms.length < 100) console.warn("No cached F&O file found (run `npm run scan` once first): the universe is the Nifty 50 only.");
    universe = syms.map((sym) => ({ sym, name: info.get(sym)?.name ?? sym, sector: info.get(sym)?.sector ?? "Other", ...(is50.has(sym) ? { n50: true } : {}) }));
    mkdirSync("data", { recursive: true });
    writeFileSync("data/universe.json", JSON.stringify(universe).replace(/\},\{/g, "},\n{"));
    console.log(`universe: ${universe.length} stocks with futures (${universe.filter((u) => u.n50).length} in the Nifty 50, ${universe.filter((u) => u.sector === "Other").length} without a sector)`);
  } catch (e) {
    if (!existsSync("data/universe.json")) throw e;
    console.warn(`Could not refresh the universe (${e}); keeping the existing one.`);
    universe = JSON.parse(readFileSync("data/universe.json", "utf8"));
  }

  // --- upload templates
  mkdirSync("public/templates", { recursive: true });
  const header = "Symbol,Last,Open,High,Low,Volume";
  const gf = (attr: string, row: number) => `"=IFERROR(GOOGLEFINANCE(A${row},""${attr}""),"""")"`;
  const tickers = ["INDEXNSE:NIFTY_50", "INDEXNSE:NIFTY_BANK", "INDEXNSE:INDIA_VIX", ...universe.map((u) => `NSE:${u.sym}`)];
  const sheet = [header, ...tickers.map((t, i) => [t, gf("price", i + 2), gf("priceopen", i + 2), gf("high", i + 2), gf("low", i + 2), gf("volume", i + 2)].join(","))];
  writeFileSync("public/templates/google-sheets-live-quotes.csv", sheet.join("\n") + "\n");
  const sample = ["NIFTY,25144.30,25210.00,25260.50,25090.10,", "BANKNIFTY,61034.10,61200.00,61310.00,60880.00,", "INDIAVIX,15.50,,,,", "RELIANCE,1339.70,1345.00,1352.40,1334.10,13756247"];
  writeFileSync("public/templates/manual-quotes-template.csv", [header, ...sample, ...universe.filter((u) => u.sym !== "RELIANCE").slice(0, 4).map((u) => `${u.sym},,,,,`)].join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
