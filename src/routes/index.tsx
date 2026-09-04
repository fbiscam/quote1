import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Minus, RefreshCw, TriangleAlert } from "lucide-react";

import { CandleChart } from "@/components/CandleChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyze, ema } from "@/lib/indicators";
import { INTERVALS, SYMBOLS, fetchCandles } from "@/lib/market";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CandleLens — Live Candle Analysis & Signal Demo" },
      {
        name: "description",
        content:
          "Educational candle analysis dashboard: live crypto candles, RSI, EMA crossover and candlestick patterns explained with UP/DOWN bias suggestions.",
      },
      { property: "og:title", content: "CandleLens — Live Candle Analysis & Signal Demo" },
      {
        property: "og:description",
        content:
          "Live candles with RSI, EMA and pattern detection. Learn why a candle looks bullish or bearish — educational only, not financial advice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const [interval, setInterval] = useState<string>("1m");

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["candles", symbol, interval],
    queryFn: () => fetchCandles(symbol, interval),
    refetchInterval: 15_000,
  });

  const candles = data ?? [];
  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const signal = candles.length > 25 ? analyze(candles) : null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

  const dirStyles =
    signal?.direction === "UP"
      ? "border-bull/40 bg-bull/10 text-bull"
      : signal?.direction === "DOWN"
        ? "border-bear/40 bg-bear/10 text-bear"
        : "border-warn/40 bg-warn/10 text-warn";

  const DirIcon = signal?.direction === "UP" ? ArrowUpRight : signal?.direction === "DOWN" ? ArrowDownRight : Minus;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="tick text-xs uppercase tracking-[0.28em] text-primary">Candle Lens</p>
          <h1 className="mt-1 text-3xl font-semibold md:text-4xl">Candle Analysis Dashboard</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Live candles par RSI, EMA crossover aur candlestick patterns ka analysis — har suggestion ki wajah
            ke saath. Sirf seekhne ke liye.
          </p>
        </div>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        {SYMBOLS.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={symbol === s.value ? "default" : "outline"}
            onClick={() => setSymbol(s.value)}
            className="tick"
          >
            {s.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {INTERVALS.map((i) => (
          <Button
            key={i.value}
            size="sm"
            variant={interval === i.value ? "secondary" : "ghost"}
            onClick={() => setInterval(i.value)}
            className="tick"
          >
            {i.label}
          </Button>
        ))}
      </div>

      {isError && (
        <div className="panel p-4 text-sm text-destructive">
          {(error as Error)?.message ?? "Data load nahi hua."}
        </div>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{symbol}</p>
            <p className="tick text-2xl font-semibold">
              {last ? last.close.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className={cn("tick text-sm", changePct >= 0 ? "text-bull" : "text-bear")}>
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(3)}%
            </span>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-primary" /> EMA 9
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-accent" /> EMA 21
              </span>
            </div>
          </div>
        </div>
        <div className="px-2 py-4">
          {isLoading ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              <Activity className="mr-2 size-4 animate-pulse" /> Candles load ho rahe hain…
            </div>
          ) : (
            <CandleChart candles={candles} ema9={e9} ema21={e21} />
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className={cn("panel border p-6", dirStyles)}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Next candle bias</p>
          <div className="mt-3 flex items-center gap-3">
            <DirIcon className="size-9" />
            <span className="text-4xl font-bold">{signal?.direction ?? "—"}</span>
          </div>
          <p className="tick mt-4 text-sm opacity-90">Confidence: {signal?.confidence ?? 0}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-current" style={{ width: `${signal?.confidence ?? 0}%` }} />
          </div>
          <dl className="tick mt-6 grid grid-cols-2 gap-3 text-xs text-foreground/80">
            <div>
              <dt className="opacity-60">RSI 14</dt>
              <dd className="text-base">{signal?.rsi?.toFixed(1) ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-60">Volatility (ATR%)</dt>
              <dd className="text-base">{signal?.atrPct?.toFixed(3) ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-60">EMA 9</dt>
              <dd className="text-base">{signal?.ema9?.toFixed(2) ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-60">EMA 21</dt>
              <dd className="text-base">{signal?.ema21?.toFixed(2) ?? "—"}</dd>
            </div>
          </dl>
          {dataUpdatedAt > 0 && (
            <p className="tick mt-5 text-[11px] opacity-60">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()} · auto refresh 15s
            </p>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Suggestion ki wajah</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Har factor apna score deta hai; sab mila kar final bias banta hai.
          </p>
          <ul className="mt-4 space-y-3">
            {(signal?.reasons ?? []).map((r, idx) => (
              <li key={idx} className="flex items-start gap-3 rounded-lg bg-secondary/50 p-3">
                <Badge
                  variant="outline"
                  className={cn(
                    "tick mt-0.5 shrink-0",
                    r.score > 0 && "border-bull/50 text-bull",
                    r.score < 0 && "border-bear/50 text-bear",
                    r.score === 0 && "border-border text-muted-foreground",
                  )}
                >
                  {r.score > 0 ? `+${r.score}` : r.score}
                </Badge>
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.detail}</p>
                </div>
              </li>
            ))}
            {signal === null && !isLoading && (
              <li className="text-sm text-muted-foreground">Analysis ke liye kaafi candles nahi hain.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel flex items-start gap-3 border-warn/40 bg-warn/5 p-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Zaroori baat:</span> Yeh tool sirf educational hai. Koi
          bhi bot ya indicator agli candle ko yaqeeni taur par predict nahi kar sakta — binary options me
          broker ka edge hota hai aur long run me loss ka risk bohot zyada hai. Isse strategy samajhne ke liye
          use karein, paisa lagane ke faisle ke liye nahi. Yeh financial advice nahi hai.
        </p>
      </section>
    </main>
  );
}
