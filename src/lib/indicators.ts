export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prev = seed;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        gain /= period;
        loss /= period;
        out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
      } else {
        out.push(null);
      }
      continue;
    }
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
    out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  });
  return ema(tr, period);
}

export type PatternHit = { name: string; bias: "up" | "down" | "neutral"; note: string };

export function detectPatterns(candles: Candle[]): PatternHit[] {
  const n = candles.length;
  if (n < 3) return [];
  const c1 = candles[n - 1]!;
  const c2 = candles[n - 2]!;
  const hits: PatternHit[] = [];

  const body = Math.abs(c1.close - c1.open);
  const range = c1.high - c1.low || 1e-9;
  const upperWick = c1.high - Math.max(c1.close, c1.open);
  const lowerWick = Math.min(c1.close, c1.open) - c1.low;

  if (body / range < 0.1) {
    hits.push({ name: "Doji", bias: "neutral", note: "Market undecided — entry avoid karein." });
  }
  if (lowerWick > body * 2 && upperWick < body) {
    hits.push({ name: "Hammer", bias: "up", note: "Neeche se buyers ne price uthaya." });
  }
  if (upperWick > body * 2 && lowerWick < body) {
    hits.push({ name: "Shooting Star", bias: "down", note: "Upar sellers ne price gira diya." });
  }
  const bull2 = c2.close < c2.open;
  const bull1 = c1.close > c1.open;
  if (bull2 && bull1 && c1.close > c2.open && c1.open < c2.close) {
    hits.push({ name: "Bullish Engulfing", bias: "up", note: "Green candle ne pichli red ko cover kiya." });
  }
  if (!bull2 && !bull1 && c1.close < c2.open && c1.open > c2.close) {
    hits.push({ name: "Bearish Engulfing", bias: "down", note: "Red candle ne pichli green ko cover kiya." });
  }
  if (body / range > 0.85) {
    hits.push({
      name: bull1 ? "Bullish Marubozu" : "Bearish Marubozu",
      bias: bull1 ? "up" : "down",
      note: "Poori candle ek direction me — strong momentum.",
    });
  }
  return hits;
}

export type Reason = { label: string; detail: string; score: number };
export type Signal = {
  direction: "UP" | "DOWN" | "WAIT";
  confidence: number;
  reasons: Reason[];
  patterns: PatternHit[];
  rsi: number | null;
  ema9: number | null;
  ema21: number | null;
  atrPct: number | null;
};

export function analyze(candles: Candle[]): Signal {
  const closes = candles.map((c) => c.close);
  const rsiSeries = rsi(closes, 14);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;

  const r = rsiSeries[last] ?? null;
  const e9 = ema9[last] ?? null;
  const e21 = ema21[last] ?? null;
  const a = atrSeries[last] ?? null;
  const price = closes[last] ?? 0;
  const atrPct = a && price ? (a / price) * 100 : null;

  const reasons: Reason[] = [];

  if (e9 !== null && e21 !== null) {
    const diffPct = ((e9 - e21) / e21) * 100;
    if (Math.abs(diffPct) < 0.02) {
      reasons.push({ label: "Trend flat", detail: "EMA 9 aur EMA 21 lagbhag barabar — koi clear trend nahi.", score: 0 });
    } else if (e9 > e21) {
      reasons.push({ label: "Uptrend (EMA 9 > 21)", detail: `Short EMA upar hai (+${diffPct.toFixed(3)}%).`, score: 2 });
    } else {
      reasons.push({ label: "Downtrend (EMA 9 < 21)", detail: `Short EMA neeche hai (${diffPct.toFixed(3)}%).`, score: -2 });
    }
  }

  if (r !== null) {
    if (r < 30) reasons.push({ label: `RSI ${r.toFixed(1)} — oversold`, detail: "Bounce ka chance, bullish reversal zone.", score: 2 });
    else if (r > 70) reasons.push({ label: `RSI ${r.toFixed(1)} — overbought`, detail: "Pullback ka chance, bearish reversal zone.", score: -2 });
    else if (r > 55) reasons.push({ label: `RSI ${r.toFixed(1)} — bullish side`, detail: "Momentum buyers ke haath me.", score: 1 });
    else if (r < 45) reasons.push({ label: `RSI ${r.toFixed(1)} — bearish side`, detail: "Momentum sellers ke haath me.", score: -1 });
    else reasons.push({ label: `RSI ${r.toFixed(1)} — neutral`, detail: "Koi edge nahi.", score: 0 });
  }

  const patterns = detectPatterns(candles);
  for (const p of patterns) {
    reasons.push({
      label: `Pattern: ${p.name}`,
      detail: p.note,
      score: p.bias === "up" ? 2 : p.bias === "down" ? -2 : 0,
    });
  }

  const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20 || 1;
  const lastCandle = candles[last];
  if (lastCandle) {
    const volRatio = lastCandle.volume / avgVol;
    if (volRatio > 1.5) {
      const dir = lastCandle.close >= lastCandle.open ? 1 : -1;
      reasons.push({
        label: `Volume spike ${volRatio.toFixed(1)}x`,
        detail: "Average se zyada volume — move me dum hai.",
        score: dir,
      });
    }
  }

  const total = reasons.reduce((s, x) => s + x.score, 0);
  const maxAbs = reasons.reduce((s, x) => s + Math.abs(x.score), 0) || 1;
  const confidence = Math.min(95, Math.round((Math.abs(total) / maxAbs) * 100));

  let direction: Signal["direction"] = "WAIT";
  if (total >= 3 && confidence >= 45) direction = "UP";
  else if (total <= -3 && confidence >= 45) direction = "DOWN";

  return { direction, confidence, reasons, patterns, rsi: r, ema9: e9, ema21: e21, atrPct };
}
