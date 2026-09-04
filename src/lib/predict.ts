import { analyze, atr, ema, rsi, sma, type Candle, type Signal } from "./indicators";

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

export type Backtest = { tested: number; correct: number; accuracy: number };

export type HeavySignal = {
  base: Signal;
  next: NextCandle;
  levels: Levels;
  backtest: Backtest;
  macd: { line: number | null; signal: number | null; hist: number | null };
  bb: { upper: number | null; lower: number | null; mid: number | null; pctB: number | null };
  stoch: number | null;
  score: number;
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

/** Weighted ensemble score in [-1, 1] for the candle after index `i`. */
function ensembleScore(candles: Candle[], i: number): number {
  const slice = candles.slice(0, i + 1);
  if (slice.length < 40) return 0;
  const closes = slice.map((c) => c.close);
  const e9 = last(ema(closes, 9)) ?? null;
  const e21 = last(ema(closes, 21)) ?? null;
  const e50 = last(ema(closes, 50)) ?? null;
  const r = last(rsi(closes, 14)) ?? null;
  const m = macd(closes);
  const hist = last(m.hist) ?? null;
  const prevHist = m.hist[m.hist.length - 2] ?? null;
  const bb = bollinger(closes);
  const bbU = last(bb.upper);
  const bbL = last(bb.lower);
  const st = last(stochastic(slice)) ?? null;
  const price = closes[closes.length - 1]!;

  let score = 0;
  let weight = 0;

  const add = (v: number, w: number) => {
    score += v * w;
    weight += w;
  };

  if (e9 != null && e21 != null) add(Math.sign(e9 - e21), 2);
  if (e21 != null && e50 != null) add(Math.sign(e21 - e50), 1.5);
  if (r != null) add(r > 70 ? -0.8 : r < 30 ? 0.8 : (r - 50) / 25, 1.5);
  if (hist != null && prevHist != null) add(Math.sign(hist) * 0.6 + Math.sign(hist - prevHist) * 0.4, 2);
  if (bbU != null && bbL != null && bbU !== bbL) {
    const pctB = (price - bbL) / (bbU - bbL);
    add(pctB > 1 ? -0.8 : pctB < 0 ? 0.8 : (0.5 - pctB) * 1.2, 1);
  }
  if (st != null) add(st > 80 ? -0.7 : st < 20 ? 0.7 : (st - 50) / 40, 1);

  // momentum of last 3 candles
  const c1 = slice[slice.length - 1]!;
  const c3 = slice[slice.length - 3];
  if (c3) add(Math.sign(c1.close - c3.close) * 0.6, 1);

  // candle body direction with volume confirmation
  const avgVol = slice.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20 || 1;
  const volBoost = Math.min(1.5, c1.volume / avgVol);
  add(Math.sign(c1.close - c1.open) * 0.5 * volBoost, 1);

  const sig = analyze(slice);
  add(sig.direction === "UP" ? 1 : sig.direction === "DOWN" ? -1 : 0, 1.5);

  return weight === 0 ? 0 : Math.max(-1, Math.min(1, score / weight));
}

function backtest(candles: Candle[], lookback = 80): Backtest {
  let tested = 0;
  let correct = 0;
  const start = Math.max(45, candles.length - lookback - 1);
  for (let i = start; i < candles.length - 1; i++) {
    const s = ensembleScore(candles, i);
    if (Math.abs(s) < 0.08) continue;
    const nxt = candles[i + 1]!;
    const actual = Math.sign(nxt.close - nxt.open);
    if (actual === 0) continue;
    tested++;
    if (Math.sign(s) === actual) correct++;
  }
  return { tested, correct, accuracy: tested ? (correct / tested) * 100 : 0 };
}

export function predict(candles: Candle[]): HeavySignal | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const i = candles.length - 1;
  const score = ensembleScore(candles, i);
  const base = analyze(candles);
  const a = last(atr(candles, 14)) ?? null;
  const price = closes[i]!;
  const range = a ?? (price * 0.001);

  const bt = backtest(candles);
  const direction: NextCandle["direction"] = score >= 0 ? "UP" : "DOWN";
  const strength = Math.min(1, Math.abs(score) / 0.6);
  const btBias = bt.tested >= 10 ? (bt.accuracy - 50) / 100 : 0;
  const probability = Math.max(50, Math.min(92, 50 + strength * 32 + btBias * 20));

  const open = price;
  const move = range * (0.35 + strength * 0.55) * (direction === "UP" ? 1 : -1);
  const close = open + move;
  const wick = range * 0.35;
  const high = Math.max(open, close) + wick * (direction === "UP" ? 1 : 0.6);
  const low = Math.min(open, close) - wick * (direction === "DOWN" ? 1 : 0.6);

  const win = candles.slice(-40);
  const levels: Levels = {
    support: Math.min(...win.map((c) => c.low)),
    resistance: Math.max(...win.map((c) => c.high)),
  };

  const m = macd(closes);
  const bb = bollinger(closes);
  const bbU = last(bb.upper) ?? null;
  const bbL = last(bb.lower) ?? null;

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
    macd: { line: last(m.line) ?? null, signal: last(m.signal) ?? null, hist: last(m.hist) ?? null },
    bb: {
      upper: bbU,
      lower: bbL,
      mid: last(bb.mid) ?? null,
      pctB: bbU != null && bbL != null && bbU !== bbL ? ((price - bbL) / (bbU - bbL)) * 100 : null,
    },
    stoch: last(stochastic(candles)) ?? null,
    score,
  };
}
