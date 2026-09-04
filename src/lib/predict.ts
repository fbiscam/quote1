import {
  adx,
  analyze,
  atr,
  cci,
  detectAdvancedPatterns,
  detectPatterns,
  ema,
  ichimoku,
  markovUpProbability,
  obv,
  roc,
  rsi,
  sma,
  stdev,
  vwap,
  williamsR,
  type Candle,
  type PatternHit,
  type Signal,
} from "./indicators";

export type NextCandle = {
  direction: "UP" | "DOWN";
  probability: number;
  open: number;
  close: number;
  high: number;
  low: number;
  expectedMovePct: number;
};

export type Levels = { support: number; resistance: number };

export type BacktestSlice = { tested: number; correct: number; accuracy: number };

export type Backtest = {
  tested: number;
  correct: number;
  accuracy: number;
  /** true = accuracy measured on data the weights were NOT tuned on (honest) */
  outOfSample: boolean;
  /** accuracy only on signals above the tuned confidence threshold */
  highConf: BacktestSlice & { threshold: number };
  /** accuracy split by market regime (out-of-sample) */
  byRegime: Record<string, BacktestSlice>;
  /** longest run of correct calls in the test window */
  bestStreak: number;
};

export type Factor = {
  key: string;
  label: string;
  /** -1 (strong down) .. +1 (strong up) */
  value: number;
  /** effective weight after adaptive tuning */
  weight: number;
  /** rolling hit rate of this factor (%) or null when untested */
  hitRate: number | null;
};

export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE";

export type HeavySignal = {
  base: Signal;
  next: NextCandle;
  levels: Levels;
  backtest: Backtest;
  macd: { line: number | null; signal: number | null; hist: number | null };
  bb: { upper: number | null; lower: number | null; mid: number | null; pctB: number | null };
  stoch: number | null;
  score: number;
  factors: Factor[];
  patterns: PatternHit[];
  regime: Regime;
  quality: "HIGH" | "MEDIUM" | "LOW";
  /** TRADE = signal is above the tuned confidence threshold; WAIT = skip this candle */
  advice: "TRADE" | "WAIT";
  /** tuned |score| threshold required for a tradeable call */
  threshold: number;
  agreement: number;
  markov: { prob: number | null; samples: number };
  extras: {
    adx: number | null;
    plusDI: number | null;
    minusDI: number | null;
    williamsR: number | null;
    cci: number | null;
    roc: number | null;
    vwap: number | null;
    obvSlope: number | null;
    tenkan: number | null;
    kijun: number | null;
    htfBias: number | null;
    zscore: number | null;
  };
};

function last<T>(a: T[]): T | undefined {
  return a[a.length - 1];
}

export function macd(closes: number[]) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = closes.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f == null || s == null ? null : f - s;
  });
  const filled = line.map((v) => v ?? 0);
  const sig = ema(filled, 9);
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]!));
  return { line, signal: sig, hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const win = closes.slice(i - period + 1, i + 1);
    const varr = win.reduce((s, v) => s + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(varr);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

export function stochastic(candles: Candle[], period = 14): (number | null)[] {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const win = candles.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((w) => w.high));
    const lo = Math.min(...win.map((w) => w.low));
    if (hi === lo) return 50;
    return ((c.close - lo) / (hi - lo)) * 100;
  });
}

/* ============================================================
   Context: every series computed once for the whole dataset
   ============================================================ */

type Ctx = ReturnType<typeof buildContext>;

function buildContext(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const m = macd(closes);
  const bb = bollinger(closes);
  const dmi = adx(candles, 14);
  const ich = ichimoku(candles);
  return {
    candles,
    closes,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi: rsi(closes, 14),
    macd: m,
    bb,
    stoch: stochastic(candles, 14),
    stochSlow: sma(stochastic(candles, 14).map((v) => v ?? 50), 3),
    atr: atr(candles, 14),
    adx: dmi.adx,
    plusDI: dmi.plusDI,
    minusDI: dmi.minusDI,
    willr: williamsR(candles, 14),
    cci: cci(candles, 20),
    roc: roc(closes, 9),
    obv: obv(candles),
    vwap: vwap(candles, 20),
    sd20: stdev(closes, 20),
    sma20: sma(closes, 20),
    ich,
  };
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** Base weights per factor — tuned by rolling hit rate at runtime. */
const BASE_WEIGHTS: Record<string, number> = {
  emaFast: 2,
  emaSlow: 1.5,
  emaLong: 1,
  rsi: 1.5,
  macd: 2,
  bb: 1,
  stoch: 1,
  adx: 1.5,
  willr: 0.8,
  cci: 0.8,
  roc: 1,
  obv: 1,
  vwap: 1,
  ich: 1.2,
  meanRev: 1,
  momentum: 1,
  volume: 1,
  pattern: 1.8,
  rulebook: 1.5,
  markov: 1.2,
  htf: 2,
  wick: 1.2,
  divergence: 1.6,
  squeeze: 1.4,
  srBounce: 1.3,
  breakout: 1.7,
  session: 0.9,
  exhaustion: 1.1,
  gap: 0.7,
  ribbon: 1.2,
  emaStack: 1.4,
};

function factorValues(ctx: Ctx, i: number, htfBias: number | null): Array<{ key: string; label: string; value: number }> {
  const out: Array<{ key: string; label: string; value: number }> = [];
  const push = (key: string, label: string, value: number | null) => {
    if (value == null || Number.isNaN(value)) return;
    out.push({ key, label, value: clamp(value) });
  };
  const price = ctx.closes[i]!;
  const c = ctx.candles[i]!;

  const e9 = ctx.ema9[i];
  const e21 = ctx.ema21[i];
  const e50 = ctx.ema50[i];
  const e200 = ctx.ema200[i];
  if (e9 != null && e21 != null) push("emaFast", "EMA 9 vs 21", clamp(((e9 - e21) / e21) * 400));
  if (e21 != null && e50 != null) push("emaSlow", "EMA 21 vs 50", clamp(((e21 - e50) / e50) * 300));
  if (e50 != null && e200 != null) push("emaLong", "EMA 50 vs 200 (macro trend)", Math.sign(e50 - e200) * 0.8);

  const r = ctx.rsi[i];
  if (r != null) push("rsi", `RSI ${r.toFixed(1)}`, r > 70 ? -0.8 : r < 30 ? 0.8 : (r - 50) / 25);

  const hist = ctx.macd.hist[i];
  const prevHist = ctx.macd.hist[i - 1];
  if (hist != null && prevHist != null) {
    push("macd", "MACD histogram + slope", Math.sign(hist) * 0.6 + Math.sign(hist - prevHist) * 0.4);
  }

  const bu = ctx.bb.upper[i];
  const bl = ctx.bb.lower[i];
  if (bu != null && bl != null && bu !== bl) {
    const pctB = (price - bl) / (bu - bl);
    push("bb", "Bollinger %B", pctB > 1 ? -0.8 : pctB < 0 ? 0.8 : (0.5 - pctB) * 1.2);
  }

  const st = ctx.stoch[i];
  const stSlow = ctx.stochSlow[i];
  if (st != null) {
    const cross = stSlow != null ? Math.sign(st - stSlow) * 0.3 : 0;
    push("stoch", `Stochastic ${st.toFixed(1)}`, (st > 80 ? -0.7 : st < 20 ? 0.7 : (st - 50) / 40) + cross);
  }

  const ax = ctx.adx[i];
  const pdi = ctx.plusDI[i];
  const mdi = ctx.minusDI[i];
  if (ax != null && pdi != null && mdi != null) {
    const strength = Math.min(1, ax / 35);
    push("adx", `ADX ${ax.toFixed(1)} (+DI/-DI)`, Math.sign(pdi - mdi) * strength);
  }

  const w = ctx.willr[i];
  if (w != null) push("willr", `Williams %R ${w.toFixed(1)}`, w < -80 ? 0.7 : w > -20 ? -0.7 : (w + 50) / 40);

  const cc = ctx.cci[i];
  if (cc != null) push("cci", `CCI ${cc.toFixed(0)}`, clamp(cc / 150));

  const rc = ctx.roc[i];
  if (rc != null) push("roc", `ROC ${rc.toFixed(2)}%`, clamp(rc * 3));

  if (i > 5) {
    const o0 = ctx.obv[i]!;
    const o5 = ctx.obv[i - 5]!;
    const scale = Math.abs(o0) + Math.abs(o5) || 1;
    push("obv", "OBV slope (5)", clamp(((o0 - o5) / scale) * 4));
  }

  const vw = ctx.vwap[i];
  if (vw != null) push("vwap", "Price vs VWAP 20", clamp(((price - vw) / vw) * 400));

  const tk = ctx.ich.tenkan[i];
  const kj = ctx.ich.kijun[i];
  const sa = ctx.ich.spanA[i];
  const sb = ctx.ich.spanB[i];
  if (tk != null && kj != null) {
    let v = Math.sign(tk - kj) * 0.6;
    if (sa != null && sb != null) {
      const top = Math.max(sa, sb);
      const bot = Math.min(sa, sb);
      v += price > top ? 0.4 : price < bot ? -0.4 : 0;
    }
    push("ich", "Ichimoku (tenkan/kijun + cloud)", v);
  }

  const sd = ctx.sd20[i];
  const ma20 = ctx.sma20[i];
  if (sd != null && ma20 != null && sd > 0) {
    const z = (price - ma20) / sd;
    push("meanRev", `Z-score ${z.toFixed(2)} (mean reversion)`, clamp(-z / 2.5));
  }

  const c3 = ctx.candles[i - 3];
  if (c3) push("momentum", "3-candle momentum", Math.sign(c.close - c3.close) * 0.6);

  const volWin = ctx.candles.slice(Math.max(0, i - 20), i);
  const avgVol = volWin.reduce((s, x) => s + x.volume, 0) / (volWin.length || 1) || 1;
  const volBoost = Math.min(1.5, (c.volume || avgVol) / avgVol);
  push("volume", "Candle body + volume", Math.sign(c.close - c.open) * 0.5 * volBoost);

  const slice = ctx.candles.slice(Math.max(0, i - 5), i + 1);
  const pats = [...detectPatterns(slice), ...detectAdvancedPatterns(slice)];
  if (pats.length) {
    const pv = pats.reduce((s, p) => s + (p.bias === "up" ? 1 : p.bias === "down" ? -1 : 0), 0) / pats.length;
    push("pattern", `Candle patterns (${pats.length})`, pv);
  }

  const mk = markovUpProbability(ctx.candles.slice(0, i + 1), 2);
  if (mk.prob != null) push("markov", `Markov sequence bias (${mk.samples})`, (mk.prob - 0.5) * 2);

  if (htfBias != null) push("htf", "Higher timeframe alignment", htfBias);

  // ---- extra detection skills (all strictly backward-looking) ----

  // 1) Wick pressure: last 3 candles ke upper/lower wicks ka imbalance
  {
    const w = ctx.candles.slice(Math.max(0, i - 2), i + 1);
    let upW = 0;
    let dnW = 0;
    for (const x of w) {
      upW += x.high - Math.max(x.open, x.close);
      dnW += Math.min(x.open, x.close) - x.low;
    }
    const tot = upW + dnW;
    if (tot > 0) push("wick", "Wick pressure (3)", clamp(((dnW - upW) / tot) * 1.2));
  }

  // 2) RSI divergence vs price (14 bars)
  {
    const back = 14;
    const rNow = ctx.rsi[i];
    const rPast = ctx.rsi[i - back];
    const pPast = ctx.closes[i - back];
    if (rNow != null && rPast != null && pPast != null) {
      const pUp = price > pPast;
      const rUp = rNow > rPast;
      if (pUp && !rUp && rNow > 55) push("divergence", "Bearish RSI divergence", -0.85);
      else if (!pUp && rUp && rNow < 45) push("divergence", "Bullish RSI divergence", 0.85);
    }
  }

  // 3) Bollinger squeeze → breakout direction
  {
    const bu2 = ctx.bb.upper[i];
    const bl2 = ctx.bb.lower[i];
    if (bu2 != null && bl2 != null) {
      const widths: number[] = [];
      for (let k = Math.max(20, i - 40); k <= i; k++) {
        const u = ctx.bb.upper[k];
        const l = ctx.bb.lower[k];
        if (u != null && l != null) widths.push(u - l);
      }
      const cur = bu2 - bl2;
      const avgW = widths.reduce((a2, b2) => a2 + b2, 0) / (widths.length || 1) || 1;
      if (cur < avgW * 0.75) {
        const body = c.close - c.open;
        push("squeeze", "BB squeeze breakout", clamp(Math.sign(body) * 0.7));
      }
    }
  }

  // 4) Swing S/R bounce (20 bars)
  {
    const win2 = ctx.candles.slice(Math.max(0, i - 20), i);
    if (win2.length >= 10) {
      const sup = Math.min(...win2.map((x) => x.low));
      const res = Math.max(...win2.map((x) => x.high));
      const rng = res - sup;
      if (rng > 0) {
        const posIn = (price - sup) / rng;
        if (posIn < 0.15) push("srBounce", "Support bounce zone", 0.75);
        else if (posIn > 0.85) push("srBounce", "Resistance rejection zone", -0.75);
      }
    }
  }

  // 5) Fractal breakout: prior 10-bar high/low ka break
  {
    const win3 = ctx.candles.slice(Math.max(0, i - 10), i);
    if (win3.length >= 8) {
      const hh = Math.max(...win3.map((x) => x.high));
      const ll = Math.min(...win3.map((x) => x.low));
      if (c.close > hh) push("breakout", "10-bar high breakout", 0.9);
      else if (c.close < ll) push("breakout", "10-bar low breakdown", -0.9);
    }
  }

  // 6) Session bias: London/NY hours me momentum continuation strong hota hai
  {
    const hourUtc = new Date(c.openTime).getUTCHours();
    const activeSession = (hourUtc >= 7 && hourUtc < 11) || (hourUtc >= 13 && hourUtc < 17);
    const c2 = ctx.candles[i - 2];
    if (activeSession && c2) push("session", `Session momentum (${hourUtc}:00 UTC)`, Math.sign(c.close - c2.close) * 0.7);
    else if (!activeSession && c2) push("session", `Quiet session fade (${hourUtc}:00 UTC)`, Math.sign(c2.close - c.close) * 0.35);
  }

  // 7) Streak exhaustion: 3+ same-direction candles → reversal pressure
  {
    let run = 0;
    const dirSign = Math.sign(c.close - c.open);
    if (dirSign !== 0) {
      for (let k = i; k >= 0; k--) {
        const x = ctx.candles[k]!;
        if (Math.sign(x.close - x.open) === dirSign) run++;
        else break;
      }
      if (run >= 3) push("exhaustion", `${run}-candle streak exhaustion`, -dirSign * Math.min(0.8, 0.25 * run));
    }
  }

  // 8) Gap vs previous close
  {
    const p1 = ctx.candles[i - 1];
    const a1 = ctx.atr[i];
    if (p1 && a1 && a1 > 0) {
      const gap = (c.open - p1.close) / a1;
      if (Math.abs(gap) > 0.25) push("gap", "Gap fill bias", clamp(-gap * 0.6));
    }
  }

  // 9) EMA9 slope (ribbon momentum)
  {
    const s0 = ctx.ema9[i];
    const s3 = ctx.ema9[i - 3];
    if (s0 != null && s3 != null) push("ribbon", "EMA 9 slope", clamp(((s0 - s3) / s3) * 600));
  }

  // 10) Full EMA stack alignment (9>21>50>200 = clean trend)
  if (e9 != null && e21 != null && e50 != null && e200 != null) {
    const upStack = e9 > e21 && e21 > e50 && e50 > e200;
    const dnStack = e9 < e21 && e21 < e50 && e50 < e200;
    if (upStack) push("emaStack", "EMA stack fully bullish", 0.9);
    else if (dnStack) push("emaStack", "EMA stack fully bearish", -0.9);
  }

  return out;
}

/** Memoised factor values per candle index (heavy: patterns + markov). */
function makeFactorCache(ctx: Ctx) {
  const cache = new Map<number, Array<{ key: string; label: string; value: number }>>();
  return (i: number) => {
    let v = cache.get(i);
    if (!v) {
      v = factorValues(ctx, i, null);
      cache.set(i, v);
    }
    return v;
  };
}

/** Per-factor hit rate over an index range [from, to) → adaptive weight multiplier. */
function factorHitRates(
  ctx: Ctx,
  from: number,
  to: number,
  fv: (i: number) => Array<{ key: string; label: string; value: number }>,
): Record<string, { hit: number | null; n: number }> {
  const stats: Record<string, { correct: number; n: number }> = {};
  for (let i = Math.max(60, from); i < Math.min(to, ctx.candles.length - 1); i++) {
    const nxt = ctx.candles[i + 1]!;
    const actual = Math.sign(nxt.close - nxt.open);
    if (actual === 0) continue;
    for (const f of fv(i)) {
      if (Math.abs(f.value) < 0.1) continue;
      stats[f.key] ??= { correct: 0, n: 0 };
      stats[f.key]!.n++;
      if (Math.sign(f.value) === actual) stats[f.key]!.correct++;
    }
  }
  const out: Record<string, { hit: number | null; n: number }> = {};
  for (const [k, v] of Object.entries(stats)) {
    out[k] = { hit: v.n >= 12 ? (v.correct / v.n) * 100 : null, n: v.n };
  }
  return out;
}

function weightFor(key: string, hit: number | null): number {
  const base = BASE_WEIGHTS[key] ?? 1;
  if (hit == null) return base;
  // 50% hit rate → 1x, 65% → ~1.45x, 35% → ~0.55x (contrarian factors get muted)
  const mult = Math.max(0.35, Math.min(1.6, 1 + (hit - 50) / 33));
  return base * mult;
}

function scoreFrom(
  values: Array<{ key: string; label: string; value: number }>,
  rates: Record<string, { hit: number | null; n: number }>,
): { score: number; factors: Factor[]; agreement: number } {
  let sum = 0;
  let wsum = 0;
  const factors: Factor[] = [];
  let up = 0;
  let down = 0;
  for (const v of values) {
    const hit = rates[v.key]?.hit ?? null;
    const w = weightFor(v.key, hit);
    sum += v.value * w;
    wsum += w;
    if (v.value > 0.1) up++;
    else if (v.value < -0.1) down++;
    factors.push({ key: v.key, label: v.label, value: v.value, weight: w, hitRate: hit });
  }
  factors.sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
  const voted = up + down || 1;
  return {
    score: wsum === 0 ? 0 : clamp(sum / wsum),
    factors,
    agreement: (Math.max(up, down) / voted) * 100,
  };
}

const THRESHOLDS = [0.06, 0.1, 0.14, 0.18, 0.22, 0.28, 0.34, 0.42];

/**
 * Walk-forward evaluation: weights are tuned on the older half of the window and
 * scored on the newer half, so the reported accuracy is genuinely out-of-sample.
 * Also tunes the confidence threshold on the train half only.
 */
function walkForward(
  ctx: Ctx,
  fv: (i: number) => Array<{ key: string; label: string; value: number }>,
  lookback = 320,
): { bt: Backtest; rates: Record<string, { hit: number | null; n: number }>; threshold: number } {
  const n = ctx.candles.length;
  const end = n - 1;
  const start = Math.max(60, end - lookback);
  const usable = end - start;

  // Not enough history for a split → single in-sample pass.
  if (usable < 60) {
    const rates = factorHitRates(ctx, start, end, fv);
    const slice = evaluate(ctx, fv, rates, start, end, 0.08);
    return {
      bt: {
        ...slice.overall,
        outOfSample: false,
        highConf: { ...slice.overall, threshold: 0.08 },
        byRegime: slice.byRegime,
        bestStreak: slice.bestStreak,
      },
      rates,
      threshold: 0.08,
    };
  }

  const mid = start + Math.floor(usable * 0.55);
  const trainRates = factorHitRates(ctx, start, mid, fv);

  // Tune the threshold on the train half only.
  let threshold = 0.08;
  let bestScore = -Infinity;
  for (const t of THRESHOLDS) {
    const r = evaluate(ctx, fv, trainRates, start, mid, t).overall;
    if (r.tested < 12) continue;
    // prefer accuracy, mildly reward sample size so we don't overfit a tiny slice
    const s = r.accuracy + Math.min(6, r.tested / 8);
    if (s > bestScore) {
      bestScore = s;
      threshold = t;
    }
  }

  const test = evaluate(ctx, fv, trainRates, mid, end, 0.06);
  const testHigh = evaluate(ctx, fv, trainRates, mid, end, threshold);

  // Live weights use all available history (train + test).
  const rates = factorHitRates(ctx, start, end, fv);

  return {
    bt: {
      ...test.overall,
      outOfSample: true,
      highConf: { ...testHigh.overall, threshold },
      byRegime: test.byRegime,
      bestStreak: test.bestStreak,
    },
    rates,
    threshold,
  };
}

function evaluate(
  ctx: Ctx,
  fv: (i: number) => Array<{ key: string; label: string; value: number }>,
  rates: Record<string, { hit: number | null; n: number }>,
  from: number,
  to: number,
  minScore: number,
): { overall: BacktestSlice; byRegime: Record<string, BacktestSlice>; bestStreak: number } {
  let tested = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  const byRegime: Record<string, BacktestSlice> = {};
  for (let i = Math.max(60, from); i < Math.min(to, ctx.candles.length - 1); i++) {
    const { score } = scoreFrom(fv(i), rates);
    if (Math.abs(score) < minScore) continue;
    const nxt = ctx.candles[i + 1]!;
    const actual = Math.sign(nxt.close - nxt.open);
    if (actual === 0) continue;
    const hit = Math.sign(score) === actual;
    tested++;
    if (hit) {
      correct++;
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
    const reg = detectRegime(ctx, i);
    byRegime[reg] ??= { tested: 0, correct: 0, accuracy: 0 };
    byRegime[reg]!.tested++;
    if (hit) byRegime[reg]!.correct++;
  }
  for (const v of Object.values(byRegime)) v.accuracy = v.tested ? (v.correct / v.tested) * 100 : 0;
  return {
    overall: { tested, correct, accuracy: tested ? (correct / tested) * 100 : 0 },
    byRegime,
    bestStreak,
  };
}

/** Higher timeframe bias in [-1,1] from a second candle series. */
export function higherTimeframeBias(htf: Candle[]): number | null {
  if (htf.length < 55) return null;
  const closes = htf.map((c) => c.close);
  const e9 = last(ema(closes, 9));
  const e21 = last(ema(closes, 21));
  const e50 = last(ema(closes, 50));
  const r = last(rsi(closes, 14));
  const h = last(macd(closes).hist);
  let v = 0;
  let n = 0;
  if (e9 != null && e21 != null) {
    v += Math.sign(e9 - e21);
    n++;
  }
  if (e21 != null && e50 != null) {
    v += Math.sign(e21 - e50);
    n++;
  }
  if (r != null) {
    v += clamp((r - 50) / 20);
    n++;
  }
  if (h != null) {
    v += Math.sign(h);
    n++;
  }
  return n === 0 ? null : clamp(v / n);
}

function detectRegime(ctx: Ctx, i: number): Regime {
  const ax = ctx.adx[i] ?? 0;
  const a = ctx.atr[i];
  const price = ctx.closes[i]!;
  const atrPct = a && price ? (a / price) * 100 : 0;
  const e21 = ctx.ema21[i];
  const e50 = ctx.ema50[i];
  if (atrPct > 0.45) return "VOLATILE";
  if (ax >= 22 && e21 != null && e50 != null) return e21 > e50 ? "TREND_UP" : "TREND_DOWN";
  return "RANGE";
}

export function predict(candles: Candle[], htf?: Candle[]): HeavySignal | null {
  if (candles.length < 60) return null;
  const ctx = buildContext(candles);
  const i = candles.length - 1;
  const price = ctx.closes[i]!;

  const fv = makeFactorCache(ctx);
  const { bt, rates, threshold } = walkForward(ctx, fv, 320);
  const htfBias = htf && htf.length ? higherTimeframeBias(htf) : null;
  const { score, factors, agreement } = scoreFrom(factorValues(ctx, i, htfBias), rates);

  const base = analyze(candles);
  const regime = detectRegime(ctx, i);
  const mk = markovUpProbability(candles, 2);

  const a = ctx.atr[i] ?? price * 0.001;
  const strength = Math.min(1, Math.abs(score) / 0.55);

  // Calibration: prefer the measured out-of-sample accuracy of the bucket this
  // signal actually falls into (high-confidence / regime), not a generic guess.
  const strong = Math.abs(score) >= threshold;
  const regimeSlice = bt.byRegime[regime];
  const buckets: Array<{ acc: number; n: number; w: number }> = [];
  if (strong && bt.highConf.tested >= 12) buckets.push({ acc: bt.highConf.accuracy, n: bt.highConf.tested, w: 1.2 });
  if (regimeSlice && regimeSlice.tested >= 12) buckets.push({ acc: regimeSlice.accuracy, n: regimeSlice.tested, w: 1 });
  if (bt.tested >= 12) buckets.push({ acc: bt.accuracy, n: bt.tested, w: 0.8 });
  const measured =
    buckets.length
      ? buckets.reduce((s, b) => s + b.acc * b.w, 0) / buckets.reduce((s, b) => s + b.w, 0)
      : null;

  const agreeBonus = (agreement - 55) / 100;
  const regimePenalty = regime === "VOLATILE" ? 4 : regime === "RANGE" ? 2 : 0;
  const raw = 50 + strength * 22 + agreeBonus * 10 - regimePenalty + (strong ? 3 : -6);
  // Blend model confidence with the historically measured edge (shrunk by sample size).
  const shrink = measured == null ? 0 : Math.min(0.65, bt.highConf.tested / 90);
  const probability = Math.max(
    45,
    Math.min(92, measured == null ? raw : raw * (1 - shrink) + measured * shrink),
  );
  // Confluence gate: strong score, ya phir high agreement + HTF alignment.
  const htfAgree = htfBias == null ? false : Math.sign(htfBias) === Math.sign(score) && Math.abs(htfBias) > 0.15;
  const advice: HeavySignal["advice"] =
    regime !== "VOLATILE" &&
    ((strong && probability >= 56) || (agreement >= 70 && htfAgree && probability >= 57))
      ? "TRADE"
      : "WAIT";


  const direction: NextCandle["direction"] = score >= 0 ? "UP" : "DOWN";
  const open = price;
  const volAdj = regime === "VOLATILE" ? 1.3 : regime === "RANGE" ? 0.8 : 1;
  const move = a * (0.35 + strength * 0.55) * volAdj * (direction === "UP" ? 1 : -1);
  const close = open + move;
  const wick = a * 0.35 * volAdj;
  const high = Math.max(open, close) + wick * (direction === "UP" ? 1 : 0.6);
  const low = Math.min(open, close) - wick * (direction === "DOWN" ? 1 : 0.6);

  const win = candles.slice(-40);
  const levels: Levels = {
    support: Math.min(...win.map((c) => c.low)),
    resistance: Math.max(...win.map((c) => c.high)),
  };

  const bbU = ctx.bb.upper[i] ?? null;
  const bbL = ctx.bb.lower[i] ?? null;
  const sd = ctx.sd20[i];
  const ma20 = ctx.sma20[i];

  const patterns = [...detectPatterns(candles), ...detectAdvancedPatterns(candles)];
  const quality: HeavySignal["quality"] =
    probability >= 72 && agreement >= 68 && regime !== "VOLATILE"
      ? "HIGH"
      : probability >= 62 && agreement >= 58
        ? "MEDIUM"
        : "LOW";

  return {
    base,
    next: {
      direction,
      probability: Math.round(probability),
      open,
      close,
      high,
      low,
      expectedMovePct: (Math.abs(move) / price) * 100,
    },
    levels,
    backtest: bt,
    macd: {
      line: ctx.macd.line[i] ?? null,
      signal: ctx.macd.signal[i] ?? null,
      hist: ctx.macd.hist[i] ?? null,
    },
    bb: {
      upper: bbU,
      lower: bbL,
      mid: ctx.bb.mid[i] ?? null,
      pctB: bbU != null && bbL != null && bbU !== bbL ? ((price - bbL) / (bbU - bbL)) * 100 : null,
    },
    stoch: ctx.stoch[i] ?? null,
    score,
    factors,
    patterns,
    regime,
    quality,
    advice,
    threshold,
    agreement,
    markov: mk,
    extras: {
      adx: ctx.adx[i] ?? null,
      plusDI: ctx.plusDI[i] ?? null,
      minusDI: ctx.minusDI[i] ?? null,
      williamsR: ctx.willr[i] ?? null,
      cci: ctx.cci[i] ?? null,
      roc: ctx.roc[i] ?? null,
      vwap: ctx.vwap[i] ?? null,
      obvSlope: i > 5 ? (ctx.obv[i]! - ctx.obv[i - 5]!) : null,
      tenkan: ctx.ich.tenkan[i] ?? null,
      kijun: ctx.ich.kijun[i] ?? null,
      htfBias,
      zscore: sd != null && ma20 != null && sd > 0 ? (price - ma20) / sd : null,
    },
  };
}
