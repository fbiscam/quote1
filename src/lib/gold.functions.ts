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
    const candles = out.slice(-300);

    // Yahoo GC=F futures spot se ~40-60 USD premium par trade karta hai.
    // Structure futures se lete hain, levels ko live spot (MT5 jaisa) par calibrate karte hain.
    const spot = await fetchSpot();
    const last = candles[candles.length - 1];
    if (spot != null && last) {
      const offset = spot - last.close;
      if (Math.abs(offset) < 200) {
        for (const c of candles) {
          c.open += offset;
          c.high += offset;
          c.low += offset;
          c.close += offset;
        }
        last.close = spot;
        last.high = Math.max(last.high, spot);
        last.low = Math.min(last.low, spot);
      }
    }
    return candles;
  });

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
