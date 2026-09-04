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
  const evidence = Math.max(6, reasons.reduce((s, x) => s + Math.abs(x.score), 0));
  const confidence = Math.min(95, Math.round((Math.abs(total) / evidence) * 100));

  let direction: Signal["direction"] = "WAIT";
  if (total >= 3 && confidence >= 45) direction = "UP";
  else if (total <= -3 && confidence >= 45) direction = "DOWN";

  return { direction, confidence, reasons, patterns, rsi: r, ema9: e9, ema21: e21, atrPct };
}

/* ============================================================
   Heavy indicator pack
   ============================================================ */

export function stdev(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const win = values.slice(i - period + 1, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / period);
  });
}

/** Wilder's ADX with +DI / -DI. */
export function adx(candles: Candle[], period = 14) {
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i === 0) {
      plusDM.push(0);
      minusDM.push(0);
      tr.push(c.high - c.low);
      continue;
    }
    const p = candles[i - 1]!;
    const up = c.high - p.high;
    const down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const smooth = (arr: number[]) => ema(arr, period);
  const trS = smooth(tr);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);
  const pdi: (number | null)[] = [];
  const mdi: (number | null)[] = [];
  const dx: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const t = trS[i];
    const p = pS[i];
    const m = mS[i];
    if (t == null || p == null || m == null || t === 0) {
      pdi.push(null);
      mdi.push(null);
      dx.push(0);
      continue;
    }
    const pv = (p / t) * 100;
    const mv = (m / t) * 100;
    pdi.push(pv);
    mdi.push(mv);
    dx.push(pv + mv === 0 ? 0 : (Math.abs(pv - mv) / (pv + mv)) * 100);
  }
  return { adx: ema(dx, period), plusDI: pdi, minusDI: mdi };
}

export function williamsR(candles: Candle[], period = 14): (number | null)[] {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const win = candles.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((w) => w.high));
    const lo = Math.min(...win.map((w) => w.low));
    if (hi === lo) return -50;
    return ((hi - c.close) / (hi - lo)) * -100;
  });
}

export function cci(candles: Candle[], period = 20): (number | null)[] {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ma = sma(tp, period);
  return tp.map((v, i) => {
    const m = ma[i];
    if (m == null) return null;
    const win = tp.slice(i - period + 1, i + 1);
    const md = win.reduce((s, x) => s + Math.abs(x - m), 0) / period;
    return md === 0 ? 0 : (v - m) / (0.015 * md);
  });
}

export function roc(values: number[], period = 9): (number | null)[] {
  return values.map((v, i) => {
    const p = values[i - period];
    return p == null || p === 0 ? null : ((v - p) / p) * 100;
  });
}

export function obv(candles: Candle[]): number[] {
  let acc = 0;
  return candles.map((c, i) => {
    const p = candles[i - 1];
    if (p) acc += c.close > p.close ? c.volume : c.close < p.close ? -c.volume : 0;
    return acc;
  });
}

/** Rolling VWAP over `period` candles. */
export function vwap(candles: Candle[], period = 20): (number | null)[] {
  return candles.map((_, i) => {
    if (i < period - 1) return null;
    const win = candles.slice(i - period + 1, i + 1);
    let pv = 0;
    let v = 0;
    for (const c of win) {
      const tp = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 1;
      pv += tp * vol;
      v += vol;
    }
    return v === 0 ? null : pv / v;
  });
}

/** Keltner channel (EMA20 +/- 2*ATR). */
export function keltner(candles: Candle[], period = 20, mult = 2) {
  const mid = ema(candles.map((c) => c.close), period);
  const a = atr(candles, period);
  return {
    mid,
    upper: mid.map((m, i) => (m == null || a[i] == null ? null : m + mult * a[i]!)),
    lower: mid.map((m, i) => (m == null || a[i] == null ? null : m - mult * a[i]!)),
  };
}

/** Ichimoku conversion / base line + cloud bias. */
export function ichimoku(candles: Candle[]) {
  const hl = (p: number, i: number) => {
    if (i < p - 1) return null;
    const win = candles.slice(i - p + 1, i + 1);
    return (Math.max(...win.map((c) => c.high)) + Math.min(...win.map((c) => c.low))) / 2;
  };
  const tenkan = candles.map((_, i) => hl(9, i));
  const kijun = candles.map((_, i) => hl(26, i));
  const spanA = candles.map((_, i) => {
    const t = tenkan[i];
    const k = kijun[i];
    return t == null || k == null ? null : (t + k) / 2;
  });
  const spanB = candles.map((_, i) => hl(52, i));
  return { tenkan, kijun, spanA, spanB };
}

/** Probability of an up candle given the last `order` candle directions (Markov). */
export function markovUpProbability(candles: Candle[], order = 2): { prob: number | null; samples: number } {
  if (candles.length < order + 20) return { prob: null, samples: 0 };
  const dirs = candles.map((c) => (c.close >= c.open ? 1 : 0));
  const key = dirs.slice(dirs.length - order).join("");
  let up = 0;
  let total = 0;
  for (let i = order; i < dirs.length - 1; i++) {
    if (dirs.slice(i - order, i).join("") === key) {
      total++;
      if (dirs[i] === 1) up++;
    }
  }
  return { prob: total >= 8 ? up / total : null, samples: total };
}

/** Extra multi-candle patterns on top of detectPatterns(). */
export function detectAdvancedPatterns(candles: Candle[]): PatternHit[] {
  const n = candles.length;
  if (n < 4) return [];
  const c1 = candles[n - 1]!;
  const c2 = candles[n - 2]!;
  const c3 = candles[n - 3]!;
  const hits: PatternHit[] = [];
  const bull = (c: Candle) => c.close > c.open;
  const body = (c: Candle) => Math.abs(c.close - c.open);
  const range = (c: Candle) => c.high - c.low || 1e-9;

  if (!bull(c3) && body(c2) / range(c2) < 0.3 && bull(c1) && c1.close > (c3.open + c3.close) / 2) {
    hits.push({ name: "Morning Star", bias: "up", note: "3-candle bullish reversal ban raha hai." });
  }
  if (bull(c3) && body(c2) / range(c2) < 0.3 && !bull(c1) && c1.close < (c3.open + c3.close) / 2) {
    hits.push({ name: "Evening Star", bias: "down", note: "3-candle bearish reversal ban raha hai." });
  }
  if (bull(c1) && bull(c2) && bull(c3) && c1.close > c2.close && c2.close > c3.close) {
    hits.push({ name: "Three White Soldiers", bias: "up", note: "Lagatar 3 strong green — buyers control." });
  }
  if (!bull(c1) && !bull(c2) && !bull(c3) && c1.close < c2.close && c2.close < c3.close) {
    hits.push({ name: "Three Black Crows", bias: "down", note: "Lagatar 3 strong red — sellers control." });
  }
  if (!bull(c2) && bull(c1) && c1.open < c2.close && c1.close > (c2.open + c2.close) / 2 && c1.close < c2.open) {
    hits.push({ name: "Piercing Line", bias: "up", note: "Red candle ka aadha hissa recover hua." });
  }
  if (bull(c2) && !bull(c1) && c1.open > c2.close && c1.close < (c2.open + c2.close) / 2 && c1.close > c2.open) {
    hits.push({ name: "Dark Cloud Cover", bias: "down", note: "Green candle ka aadha hissa wapas gir gaya." });
  }
  if (body(c1) < body(c2) * 0.5 && c1.high < c2.high && c1.low > c2.low) {
    hits.push({
      name: bull(c2) ? "Bearish Harami / Inside Bar" : "Bullish Harami / Inside Bar",
      bias: bull(c2) ? "down" : "up",
      note: "Inside bar — momentum thanda, breakout ka intezaar.",
    });
  }
  if (c1.high > c2.high && c1.low < c2.low) {
    hits.push({
      name: "Outside Bar (Engulfing range)",
      bias: bull(c1) ? "up" : "down",
      note: "Poora pichla range cover — volatility expansion.",
    });
  }
  if (Math.abs(c1.high - c2.high) / range(c1) < 0.05 && !bull(c1)) {
    hits.push({ name: "Tweezer Top", bias: "down", note: "Same level par double rejection." });
  }
  if (Math.abs(c1.low - c2.low) / range(c1) < 0.05 && bull(c1)) {
    hits.push({ name: "Tweezer Bottom", bias: "up", note: "Same level par double support." });
  }
  return hits;
}
