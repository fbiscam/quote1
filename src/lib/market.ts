import type { Candle } from "./indicators";

export const SYMBOLS = [
  { value: "BTCUSDT", label: "BTC / USDT" },
  { value: "ETHUSDT", label: "ETH / USDT" },
  { value: "SOLUSDT", label: "SOL / USDT" },
  { value: "BNBUSDT", label: "BNB / USDT" },
  { value: "XRPUSDT", label: "XRP / USDT" },
  { value: "DOGEUSDT", label: "DOGE / USDT" },
] as const;

export const INTERVALS = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
] as const;

export async function fetchCandles(symbol: string, interval: string): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=120`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Market data load nahi hua (${res.status})`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  }));
}
