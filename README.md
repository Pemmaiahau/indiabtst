# India Overnight & Swing Desk

A screener for BTST (buy today, sell tomorrow) and swing trades in **Nifty futures, Bank Nifty futures and every stock that has futures on NSE** (about 220). Buy and sell ideas each come with the reasons they were selected and what argues against them. Options are not traded; option data is only used to read the index.
It is a static website: a script downloads free data and writes JSON, and the pages read that JSON.
It works on a laptop and on a phone, and can be added to the iPhone home screen (Safari → Share → Add to Home Screen).

It is separate from the US app in `../btst`. It screens and explains; it does not place trades and is not tied to any broker. It is not financial advice.

## Run it on your computer

```
npm install
npm run scan      # downloads data, scores, backtests (about 4 minutes)
npm run dev       # open http://localhost:3000
```

Other commands:

- `npm run check`: confirms that an uploaded quote file reproduces the scan's scores and that option-chain files parse.
- `npm run prefetch`: bulk-downloads older NSE futures/options files into `./cache` (slow on purpose, see below).
- `npm run universe`: rebuilds the stock list (every stock in the newest cached NSE F&O file, named from the Nifty 500 list, Nifty 50 members flagged) and the upload templates. Run it every month or so, after NSE adds or drops F&O stocks.
- `SCAN_CACHE=1 npx tsx scripts/research.ts overnight|swing` and `scripts/research2.ts`: the factor and setup tests behind the rules (not part of the scan).
- `npm run deploy`: scan, check, build and publish to Cloudflare Pages from this computer.

## Screens

| Screen | What it answers |
| --- | --- |
| Pulse | Today's buy ideas and sell ideas (index futures first, then stock futures) with reasons, then how friendly the market is to longs: trend, India VIX, breadth, global cues, rupee and crude, FII index-futures positioning, events. |
| Futures | Tonight's call for Nifty and Bank Nifty futures, why (points for and against), the score behind it, lot value, a "bad night" loss per lot, futures build-up and option positioning, index swing signals. |
| Stocks | F&O stocks to buy overnight, ranked, each with its reasons; today's textbook BTST closes; the overnight sell (STBT) watch list with what the test says about it. |
| Swing | Ten buy and short setups for the indices and stocks, with stop, target, time limit, risk per lot, reasons and cautions (including how the setup tested in a market like today's). |
| Upload | Re-score with your own live quotes and a live option chain. |
| Backtest | How every rule performed over about nine years, including what did not work. |
| Journal | Your own trades (stored in the browser on that device only). |

## What the backtest says (read before trading)

- **Overnight longs worked.** Buying index futures at the close after a strong close, and F&O stocks with the right profile, were profitable over nine years. The textbook BTST close (up 2%+, closing at the high on 1.5x volume at a 20-day high) also tested well.
- **Stock numbers are flattered.** They assume fills at the official close and open and use today's F&O list for the whole period. The latest year is the realistic guide, and it is close to zero.
- **The edge has shrunk in the last two years.** The by-year tables on the Backtest screen show it.
- **Overnight shorts did not work.** Indian indices and stocks drifted up overnight even after weak days. The "short zone" on the Futures screen therefore means "do not carry longs". The stock sell (STBT) watch list lost money on ordinary nights and was only marginally positive on nights when the Nifty overnight score was -30 or lower; the textbook STBT close lost money in both.
- **Short swing setups did not make money** over this (rising) period; the best of them (Supertrend turn down) roughly broke even. They are shown, marked as weak.
- **Swing buys that tested best:** 52-week high breakout, Supertrend turn up and MACD turn up (about +0.1R per trade), then oversold bounce. Trend-following buys lost money when Nifty was below its 200-day average, and most have been flat or negative since 2025; every signal says so.
- **Stock BTST is a futures trade.** Delivery costs about 0.25% per round trip and takes most of the edge.
- Index rules are tested on the spot index because free futures history does not exist; weights were fitted on the same period they are tested on.

## Data sources (all free, no keys)

- Prices: Yahoo Finance chart endpoint (`^NSEI`, `^NSEBANK`, `^INDIAVIX`, `SYMBOL.NS`; the intraday bar lags about 15 minutes).
- Futures, options and FII positioning: NSE's end-of-day files (F&O bhavcopy and participant-wise open interest).
- F&O ban list and delivery percentage: NSE's `fo_secban.csv` and the full cash bhavcopy (last 11 sessions). Shown as reasons and cautions, not scored: free history is too short to test them.
  They are published in the evening, so at 3:20 PM they describe the previous session.
- Economic calendar: Nasdaq.com (India and major US events, converted to India time).
- Headlines: Yahoo Finance RSS for the top-ranked stocks.

Not included: company results dates, live option chain (unless you upload it), GIFT Nifty, NSE holidays.

### NSE throttling

NSE blocks an address for a while (HTTP 403) if it downloads too fast. The downloader therefore goes slowly,
stops as soon as it is blocked, and keeps everything it has parsed in `./cache` so each day is fetched once.
`./cache` is committed to the repository so a hosted scan starts with the history already in place.
If NSE refuses the hosting provider's addresses, the site still updates prices and scores, and shows a note that
futures/options/FII data is old. Running `npm run deploy` from your own computer refreshes everything.

## Hosting on Cloudflare (free plan)

### Option A: automatic, via GitHub Actions

1. Put this folder in its own GitHub repository and push to `main`.
2. In Cloudflare: Workers & Pages → Create → Pages → **Direct upload**, project name `btst-india`.
3. Create a Cloudflare API token (template "Edit Cloudflare Workers") and note your Account ID.
4. In the GitHub repository: Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

`.github/workflows/scan-deploy.yml` then scans and publishes five times each weekday (8:45 AM, 2:50 PM, 3:50 PM, 7:15 PM and 10 PM India time).
The site will be at `https://btst-india.pages.dev`.

### Option B: from your computer

```
npx wrangler login      # once
npm run deploy
```

## Manual live data

- **Quotes:** any CSV with a Symbol column and an LTP/Last/Price column; Open, High, Low and Volume are used when present.
  `public/templates/google-sheets-live-quotes.csv` imports into Google Sheets and fills Nifty, Bank Nifty, India VIX and the 50 stocks with `GOOGLEFINANCE`.
- **Option chain:** the CSV from NSE's option-chain page, or a simple file with columns Strike, Call OI, Call Chg OI, Put OI, Put Chg OI.

## Code map

- `src/lib/indexcall.ts`: index overnight score. `src/lib/btst.ts`: stock overnight score. `src/lib/swing.ts`: swing setups and simulator.
  `src/lib/reasons.ts`: the plain-language reasons and cautions for every call.
  `src/lib/options.ts`: option-chain summary and reading. All shared by the scan script and the browser.
- `scripts/scan.ts`: download, score, backtest, write `public/data/`. `scripts/nse.ts`: NSE files and cache.
- `src/app/*`: the screens.
