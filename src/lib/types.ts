// Shared types used by the scan script (Node) and the web app (browser).

export type Bar = { d: string; o: number; h: number; l: number; c: number; v: number };

/** Everything we need to know about a stock *before* the evaluation day. */
export type Ctx = {
  prevClose: number;
  sum19: number; // sum of the last 19 closes (add today's price -> SMA20)
  sum49: number;
  sum199: number;
  avgVol20: number;
  high20: number; // highest high of the prior 20 sessions
  avgGain: number; // Wilder RSI(14) state
  avgLoss: number;
  close20ago: number; // close 20 sessions before the evaluation day
  atr14: number;
  ovnSum59: number; // sum of the prior 59 overnight (close->open) returns, as fractions
  intrSum19: number; // sum of the prior 19 intraday (open->close) returns
};

/** The evaluation day's bar. Only `c` is mandatory (manual uploads may lack the rest). */
export type DayBar = { o?: number; h?: number; l?: number; c: number; v?: number };

export type BtstInput = { sym: string; name: string; sector: string; ctx: Ctx; bar: DayBar };

export type Buildup = "Long build-up" | "Short build-up" | "Short covering" | "Long unwinding" | "Flat";

export type FoRead = {
  lot: number;
  oiChgPct: number; // change in futures open interest, %
  buildup: Buildup;
  pcr: number | null; // put/call open-interest ratio of the stock's options
  asOf: string;
};

/** Context computed by the scan that is not part of any score. */
export type Extra = {
  n50: boolean; // Nifty 50 member
  rs: number; // 12-month return rank among F&O stocks, 0..1 (1 = strongest)
  ret250: number; // 12-month return %
  dist52: number; // % below the 52-week high (0 = at the high)
  ban: boolean; // in NSE's F&O ban list: no new futures positions allowed
  deliv: number | null; // delivery % on the latest NSE file
  delivAvg: number | null; // average delivery % over the earlier sessions on file
  delivAsOf: string | null;
};

export type BtstRow = {
  sym: string;
  name: string;
  sector: string;
  price: number;
  chg: number; // day change %
  clv: number | null; // close location in day's range 0..1
  rvol: number | null; // projected volume / 20d average
  rsi: number;
  above20: boolean;
  above50: boolean;
  above200: boolean;
  ret20: number; // 20-session return %
  distHigh: number; // % below prior 20d high (negative = above it)
  intraday: number | null; // today's open->close %
  ovn60: number; // sum of last 60 overnight returns %
  intr20: number; // sum of last 20 intraday returns %
  atrRank: number;
  ovnRank: number;
  intrRank: number;
  atrPct: number;
  score: number; // 0..100
  parts: Record<string, number>;
  fo?: FoRead;
  ex?: Extra;
};

export type SwingSetup = "pullback" | "breakout" | "gap" | "bounce" | "breakdown" | "fade" | "high52" | "supertrend" | "macd" | "stdown";

export type SwingSignal = {
  sym: string;
  name: string;
  sector: string;
  kind: "stock" | "index";
  setup: SwingSetup;
  dir: 1 | -1;
  date: string; // signal day
  close: number;
  stop: number;
  target: number;
  riskPct: number; // |close - stop| / close %
  atrPct: number;
  rsi: number;
  rvol: number;
  holdDays: number; // time stop
  note: string;
  reasons: string[]; // why it was selected, in plain language
  cautions: string[]; // what argues against it
  lot?: number;
  fo?: FoRead;
  ex?: Extra;
};

// ---------- index futures ----------

/** What we know about an index before the evaluation day. */
export type IndexCtx = {
  prevClose: number;
  sum19: number;
  sum49: number;
  sum199: number;
  close5ago: number;
  avgGain: number;
  avgLoss: number;
  ovnSum19: number;
  vixPrev: number;
  fiiRatio: number | null; // FII index-futures long share, latest published before the evaluation day
};
export type IndexFeatures = {
  price: number;
  dayChg: number;
  intraday: number | null;
  clv: number | null;
  vixChg: number | null;
  vix: number | null;
  dist20: number;
  ret5: number;
  ovn20: number;
  fiiRatio: number | null;
  rsi: number;
  above50: boolean;
  above200: boolean;
};
export type IndexScore = { score: number; parts: Record<string, number>; call: "LONG" | "SHORT" | "NONE" };

export type OptionRead = {
  asOf: string; // date of the NSE file
  expiry: string;
  pcr: number;
  pcrPrev: number | null;
  pcrAll: number;
  maxPain: number;
  callWall: number; // strike with the most call open interest (resistance)
  putWall: number; // strike with the most put open interest (support)
  callOiChg: number;
  putOiChg: number;
  view: "Bullish" | "Bearish" | "Neutral";
  points: string[]; // plain-language observations
};
export type FuturesRead = {
  asOf: string;
  expiry: string;
  lot: number;
  futClose: number;
  premium: number; // futures minus spot, points
  oiChgPct: number;
  buildup: Buildup;
  expiries: string[];
};

export type IndexCall = {
  sym: "NIFTY" | "BANKNIFTY";
  name: string;
  features: IndexFeatures;
  score: IndexScore;
  ctx: IndexCtx;
  nextCtx: IndexCtx | null; // context for the next session (present once the market has closed)
  atr: number; // points
  badNight: number; // points: 95th-percentile adverse overnight move over the last year
  lot: number;
  lotIsEstimate: boolean;
  futures: FuturesRead | null;
  options: OptionRead | null;
  confirm: "Confirms" | "Conflicts" | "Neutral" | "No data"; // do derivatives agree with the call?
  expiryNext: boolean; // an index expiry falls on the next session
};

// ---------- pulse, meta ----------

export type PulseComponent = { name: string; value: string; score: number; max: number; note: string };
export type EconEvent = { date: string; time: string; country: string; name: string; impact: "high" | "medium" | "low"; consensus: string; previous: string; actual: string };

export type Pulse = {
  score: number; // -100..100
  label: "Risk-on" | "Neutral" | "Risk-off";
  advice: string;
  components: PulseComponent[];
  tiles: { name: string; sym: string; last: number; chg: number; chg5: number }[];
  sectors: { sector: string; chg: number; chg5: number; chg20: number }[];
  breadth: { adv: number; dec: number; above20: number; above50: number; above200: number; newHigh20: number; newLow20: number };
  events: EconEvent[];
  fii: { asOf: string; ratio: number; ratio5ago: number | null; long: number; short: number; clientRatio: number } | null;
};

export type Meta = {
  generatedAt: string;
  barDate: string;
  session: "live" | "closed";
  volFrac: number;
  symbols: number;
  failed: string[];
  notes: string[];
  foAsOf: string | null; // latest NSE F&O file used
  fiiAsOf: string | null;
  ban: string[]; // stocks in the F&O ban period
  banAsOf: string | null; // null = list unavailable
  niftyAbove200: boolean;
};

export type Snapshot = {
  meta: Meta;
  stocks: Record<string, { name: string; sector: string; ctx: Ctx }>;
  next: Record<string, { name: string; sector: string; ctx: Ctx }> | null;
};

// ---------- backtest ----------

export type TradeStats = {
  n: number;
  winRate: number;
  avg: number; // avg % (BTST) or avg R (swing)
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  total: number;
  maxDD: number;
};
export type YearRow = { year: string; n: number; avg: number; winRate: number; total: number };
export type Variant = { name: string; stats: TradeStats; curve: [string, number][] };
export type Bucket = { bucket: string; n: number; avg: number; winRate: number };

export type Backtest = {
  generatedAt: string;
  caveats: string[];
  index: { sym: string; name: string; from: string; to: string; rules: string; variants: Variant[]; buckets: Bucket[]; byYear: YearRow[] }[];
  btst: { from: string; to: string; rules: string; variants: Variant[]; buckets: Bucket[]; byYear: YearRow[]; sell: Variant[]; conventional: Variant[]; conventionalByYear: YearRow[] };
  swing: {
    setup: SwingSetup;
    dir: 1 | -1;
    rules: string;
    stocks: TradeStats;
    index: TradeStats;
    withTrend: TradeStats; // stock trades taken when Nifty was on the setup's side of its 200-day average
    againstTrend: TradeStats;
    recent: TradeStats; // stock trades since the start of last year
    avgHold: number;
    avgPct: number;
    curve: [string, number][];
    byYear: YearRow[];
  }[];
  options: { days: number; from: string; to: string; rows: Bucket[] } | null; // put/call ratio vs next overnight move
};
