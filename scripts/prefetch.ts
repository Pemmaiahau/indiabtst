// Fills ./cache with NSE history (first run is slow; later runs only fetch new days).
// Usage: npm run prefetch [-- <foDays>]
import { fetchChart } from "./net";
import { loadFo, loadParticipants } from "./nse";

async function main() {
  const foDays = Number(process.argv[2]) || 500;
  const nifty = await fetchChart("^NSEI", "10y");
  const dates = nifty.bars.map((b) => b.d);
  const t0 = Date.now();
  const p = await loadParticipants(dates.slice(-1250), (n) => console.log(`  participant files: ${n}`));
  console.log(`participant OI: ${Object.values(p).filter(Boolean).length} days (${Math.round((Date.now() - t0) / 1000)}s)`);
  const t1 = Date.now();
  // the current bhavcopy format starts on 2024-07-08
  const fo = await loadFo(dates.filter((d) => d >= "2024-07-08").slice(-foDays), (n) => console.log(`  F&O files: ${n} (${Math.round((Date.now() - t1) / 1000)}s)`));
  console.log(`F&O bhavcopy: ${Object.keys(fo).length} days (${Math.round((Date.now() - t1) / 1000)}s)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
