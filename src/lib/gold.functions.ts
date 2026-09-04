import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Candle } from "./indicators";

const schema = z.object({
  interval: z.enum(["1m", "5m", "15m", "1h"]),
});

const RANGE: Record<string, string> = {
  "1m": "1d",
  "5m": "5d",
  "15m": "1mo",
  "1h": "3mo",
};

const YF_INTERVAL: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
};

export const fetchGoldCandles = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<Candle[]> => {
    // 1) Bluesmind API (agar configured hai) — primary source
    const bm = await fetchBluesmind(data.interval);
    if (bm) {
      const closed = onlyClosed(bm, data.interval);
      if (closed.length >= 60) return closed.slice(-300);
    }

    // 2) Real-time gold proxy: PAXG/USDT (1 PAXG = 1 oz gold, 24/7 live, no delay).
    //    Yahoo GC=F ~10 min delayed hota hai, is liye ye primary hai.
    const px = await fetchPaxg(data.interval);
    if (px) {
      const closed = onlyClosed(px, data.interval);
      if (closed.length >= 60) return calibrate(closed.slice(-300), await fetchSpot());
    }

    // 3) Fallback: Yahoo GC=F + spot calibration
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${YF_INTERVAL[data.interval]}&range=${RANGE[data.interval]}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Gold data load nahi hua (${res.status})`);

    const json = (await res.json()) as {
      chart: {
        result:
          | Array<{
              timestamp?: number[];
              indicators: {
                quote: Array<{
                  open?: (number | null)[];
                  high?: (number | null)[];
                  low?: (number | null)[];
                  close?: (number | null)[];
                  volume?: (number | null)[];
                }>;
              };
            }>
          | null;
        error?: { description?: string } | null;
      };
    };
    const r = json.chart.result?.[0];
    if (!r) throw new Error(json.chart.error?.description ?? "Gold data available nahi hai.");
    const q = r.indicators.quote[0] ?? {};
    const ts = r.timestamp ?? [];
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const open = q.open?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const close = q.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      out.push({
        openTime: ts[i]! * 1000,
        open,
        high,
        low,
        close,
        volume: q.volume?.[i] ?? 0,
        closeTime: ts[i]! * 1000,
      });
    }
    const candles = onlyClosed(out, data.interval).slice(-300);

    // Yahoo GC=F futures spot se ~40-60 USD premium par trade karta hai.
    // Structure futures se lete hain, levels ko live spot (MT5 jaisa) par calibrate karte hain.
    // NOTE: last candle ka close overwrite NAHI karte — warna fake bada body ban jata hai
    // aur pattern/momentum signals galat ho jate hain.
    return calibrate(candles, await fetchSpot());
  });

/** Candle structure rakh kar levels ko live spot par shift karta hai. */
function calibrate(candles: Candle[], spot: number | null): Candle[] {
  const last = candles[candles.length - 1];
  if (spot == null || !last) return candles;
  const offset = spot - last.close;
  if (Math.abs(offset) >= 200) return candles;
  for (const c of candles) {
    c.open += offset;
    c.high += offset;
    c.low += offset;
    c.close += offset;
  }
  return candles;
}

/** PAXG/USDT klines — real-time gold ounce proxy. */
async function fetchPaxg(interval: string): Promise<Candle[] | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=500`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    const out: Candle[] = [];
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const openTime = Number(r[0]);
      const open = Number(r[1]);
      const high = Number(r[2]);
      const low = Number(r[3]);
      const close = Number(r[4]);
      const volume = Number(r[5]);
      if (![openTime, open, high, low, close].every(Number.isFinite)) continue;
      out.push({ openTime, closeTime: Number(r[6]) || openTime, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

/**
 * Sirf properly aligned + fully CLOSED candles rakhta hai.
 * Yahoo aksar ek extra "current tick" bar deta hai (zero volume, non-aligned time)
 * jo analysis ko kharab karta hai.
 */
function onlyClosed(rows: Candle[], interval: string): Candle[] {
  const ms = INTERVAL_MS[interval] ?? 300_000;
  const now = Date.now();
  return rows.filter((c) => c.openTime % ms === 0 && c.openTime + ms <= now);
}

/** Live spot price (display ke liye) — MT5 jaisa XAU/USD price. */
export const fetchGoldSpot = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ price: number | null; at: number }> => ({
    price: await fetchSpot(),
    at: Date.now(),
  }),
);

async function fetchSpot(): Promise<number | null> {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { price?: number };
    return typeof json.price === "number" && json.price > 0 ? json.price : null;
  } catch {
    return null;
  }
}

/**
 * Bluesmind API se XAU/USD candles. Configure via secrets:
 *  BLUESMIND_API_URL — endpoint, optionally with {interval} / {symbol} placeholders
 *  BLUESMIND_API_KEY — auth key (Authorization: Bearer + x-api-key dono bheje jaate hain)
 * Response flexible parse hota hai: array, {data:[...]}, {candles:[...]}, {result:[...]}.
 */
async function fetchBluesmind(interval: string): Promise<Candle[] | null> {
  const base = process.env["BLUESMIND_API_URL"];
  const key = process.env["BLUESMIND_API_KEY"];
  if (!base || !key) return null;
  try {
    let url = base.replace("{interval}", interval).replace("{symbol}", "XAUUSD");
    if (!base.includes("{interval}")) {
      url += `${url.includes("?") ? "&" : "?"}interval=${interval}&symbol=XAUUSD`;
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        "x-api-key": key,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const rows = pickRows(json);
    if (!rows) return null;
    const out: Candle[] = [];
    for (const row of rows) {
      const c = toCandle(row);
      if (c) out.push(c);
    }
    out.sort((a, b) => a.openTime - b.openTime);
    return out.length >= 60 ? out : null;
  } catch {
    return null;
  }
}

function pickRows(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["data", "candles", "result", "results", "values", "bars", "ohlc"]) {
      const v = o[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        const nested = pickRows(v);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toCandle(row: unknown): Candle | null {
  if (Array.isArray(row)) {
    const [t, o, h, l, c, v] = row;
    const open = num(o), high = num(h), low = num(l), close = num(c);
    if (open == null || high == null || low == null || close == null) return null;
    const time = normTime(t);
    return { openTime: time, closeTime: time, open, high, low, close, volume: num(v) ?? 0 };
  }
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const open = num(r["open"] ?? r["o"] ?? r["Open"]);
  const high = num(r["high"] ?? r["h"] ?? r["High"]);
  const low = num(r["low"] ?? r["l"] ?? r["Low"]);
  const close = num(r["close"] ?? r["c"] ?? r["Close"]);
  if (open == null || high == null || low == null || close == null) return null;
  const time = normTime(
    r["time"] ?? r["timestamp"] ?? r["t"] ?? r["datetime"] ?? r["date"] ?? r["openTime"],
  );
  return { openTime: time, closeTime: time, open, high, low, close, volume: num(r["volume"] ?? r["v"]) ?? 0 };
}

function normTime(t: unknown): number {
  const n = num(t);
  if (n != null) return n > 1e12 ? n : n * 1000;
  if (typeof t === "string") {
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
