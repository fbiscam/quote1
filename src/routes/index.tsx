import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Bot, Minus, RefreshCw, TriangleAlert } from "lucide-react";

import { CandleChart } from "@/components/CandleChart";
import { CandleCountdown } from "@/components/CandleCountdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ema } from "@/lib/indicators";
import { fetchGoldCandles } from "@/lib/gold.functions";
import { aiReviewSignal } from "@/lib/ai-review.functions";
import { predict } from "@/lib/predict";
import { cn } from "@/lib/utils";

const INTERVALS = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
] as const;

type Interval = (typeof INTERVALS)[number]["value"];

/** Higher timeframe used for trend confluence. */
const HTF: Record<Interval, Interval> = { "1m": "15m", "5m": "1h", "15m": "1h", "1h": "1h" };

const REGIME_LABEL: Record<string, string> = {
  TREND_UP: "Uptrend (strong)",
  TREND_DOWN: "Downtrend (strong)",
  RANGE: "Range / sideways",
  VOLATILE: "High volatility",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "XAU/USD Next Candle Predictor — Gold Analysis" },
      {
        name: "description",
        content:
          "Heavy XAU/USD gold engine: 20+ factor adaptive ensemble, next candle projection, regime detection, multi-timeframe confluence and live backtest accuracy. Educational only.",
      },
      { property: "og:title", content: "XAU/USD Next Candle Predictor — Gold Analysis" },
      {
        property: "og:description",
        content:
          "Gold (XAU/USD) candle analysis engine with next-candle projection, multi-indicator ensemble and rolling backtest accuracy. Educational, not financial advice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const getCandles = useServerFn(fetchGoldCandles);

  // Sirf ek fixed timeframe: 5 minute (signal quality + noise ka best balance).
  const interval: Interval = "5m";
  const htfInterval = HTF[interval];

  const results = useQueries({
    queries: [interval, htfInterval].map((iv) => ({
      queryKey: ["xauusd", iv],
      queryFn: () => getCandles({ data: { interval: iv } }),
      refetchInterval: 20_000,
    })),
  });

  const active = results[0]!;
  const { isLoading, isError, error, isFetching, dataUpdatedAt } = active;
  const refetch = () => results.forEach((r) => r.refetch());

  const htfData = results[1]?.data;
  const candles = useMemo(() => active.data ?? [], [active.data]);
  const accuracy = useMemo(
    () => (candles.length >= 60 ? predict(candles)?.backtest ?? { accuracy: 0, tested: 0 } : { accuracy: 0, tested: 0 }),
    [candles],
  );


  const closes = candles.map((c) => c.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const heavy = useMemo(
    () => (candles.length >= 60 ? predict(candles, htfData ?? undefined) : null),
    [candles, htfData],
  );
  const signal = heavy?.base ?? null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

  // ---- AI second review: har naye signal (naya candle / badla direction) par auto chalta hai ----
  const runAiReview = useServerFn(aiReviewSignal);
  const reviewInput = useMemo(() => {
    if (!heavy || !last) return null;
    return {
      interval,
      price: Number(last.close.toFixed(2)),
      direction: heavy.next.direction,
      probability: heavy.next.probability,
      score: heavy.score,
      quality: heavy.quality,
      regime: heavy.regime,
      agreement: heavy.agreement,
      patterns: heavy.patterns.map((p) => `${p.name} (${p.bias})`),
      indicators: {
        rsi14: heavy.base.rsi ?? null,
        stochastic: heavy.stoch ?? null,
        macdHist: heavy.macd.hist ?? null,
        bollingerPctB: heavy.bb.pctB ?? null,
        adx: heavy.extras.adx ?? null,
        plusDI: heavy.extras.plusDI ?? null,
        minusDI: heavy.extras.minusDI ?? null,
        williamsR: heavy.extras.williamsR ?? null,
        cci: heavy.extras.cci ?? null,
        rocPct: heavy.extras.roc ?? null,
        vwap: heavy.extras.vwap ?? null,
        zscore: heavy.extras.zscore ?? null,
        atrPct: heavy.base.atrPct ?? null,
        htfBias: heavy.extras.htfBias ?? null,
        markovUpProb: heavy.markov.prob ?? null,
      },
      levels: { support: heavy.levels.support ?? null, resistance: heavy.levels.resistance ?? null },
      backtest: { accuracy: heavy.backtest.accuracy, tested: heavy.backtest.tested },
      recentCloses: candles.slice(-20).map((c) => Number(c.close.toFixed(2))),
    };
  }, [heavy, last, interval, candles]);

  const reviewKey = reviewInput
    ? `${interval}:${last?.openTime}:${reviewInput.direction}:${reviewInput.probability}`
    : "none";

  const {
    data: review,
    isFetching: reviewLoading,
    isError: reviewError,
    error: reviewErr,
  } = useQuery({
    queryKey: ["ai-review", reviewKey],
    queryFn: () => runAiReview({ data: reviewInput! }),
    enabled: reviewInput !== null,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const aiTone =
    review?.verdict === "UP"
      ? "text-bull"
      : review?.verdict === "DOWN"
        ? "text-bear"
        : "text-warn";



  const dir = heavy?.next.direction;
  const dirStyles =
    dir === "UP" ? "border-bull/40 bg-bull/10 text-bull" : dir === "DOWN" ? "border-bear/40 bg-bear/10 text-bear" : "border-warn/40 bg-warn/10 text-warn";
  const DirIcon = dir === "UP" ? ArrowUpRight : dir === "DOWN" ? ArrowDownRight : Minus;

  const fmt = (v: number | null | undefined, d = 2) =>
    v == null ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="tick text-xs uppercase tracking-[0.28em] text-primary">XAU / USD · Gold</p>
          <h1 className="mt-1 text-3xl font-semibold md:text-4xl">Next Candle Prediction Engine</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Sirf Gold (XAU/USD). 20+ factors (EMA, RSI, MACD, ADX/DI, Ichimoku, VWAP, CCI, %R, OBV, Markov, patterns) ka adaptive-weighted ensemble agli candle ka direction, expected
            open/high/low/close aur probability batata hai — saath me live backtest accuracy.
          </p>
        </div>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="panel flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Fixed timeframe</span>
        <span className="tick rounded-md border border-primary bg-primary/15 px-2.5 py-1 text-xs text-primary">
          5 min · XAU/USD
        </span>
        <span className="tick rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
          Live backtest accuracy: {accuracy.accuracy.toFixed(1)}% ({accuracy.tested} candles)
        </span>
      </div>


      {isError && (
        <div className="panel p-4 text-sm text-destructive">{(error as Error)?.message ?? "Data load nahi hua."}</div>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">XAU/USD (live spot · MT5 aligned)</p>
            <p className="tick text-2xl font-semibold">{last ? fmt(last.close) : "—"}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={cn("tick text-sm", changePct >= 0 ? "text-bull" : "text-bear")}>
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(3)}%
            </span>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-primary" /> EMA 9
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-accent" /> EMA 21
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t border-dashed border-current" /> Next candle
              </span>
              <CandleCountdown interval={interval} lastOpenTime={last?.openTime} compact />
            </div>
          </div>
        </div>
        <div className="px-2 py-4">
          {isLoading ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              <Activity className="mr-2 size-4 animate-pulse" /> Gold candles load ho rahe hain…
            </div>
          ) : (
            <CandleChart
              candles={candles}
              ema9={e9}
              ema21={e21}
              projected={heavy?.next ?? null}
              levels={heavy?.levels ?? null}
            />
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className={cn("panel border p-6", dirStyles)}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Agli candle prediction</p>
          <div className="mt-3 flex items-center gap-3">
            <DirIcon className="size-9" />
            <span className="text-4xl font-bold">{dir ?? "—"}</span>
          </div>
          <p className="tick mt-4 text-sm opacity-90">Probability: {heavy?.next.probability ?? 0}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-current" style={{ width: `${heavy?.next.probability ?? 0}%` }} />
          </div>

          <CandleCountdown interval={interval} lastOpenTime={last?.openTime} />


          <dl className="tick mt-6 grid grid-cols-2 gap-3 text-xs text-foreground/80">
            <div>
              <dt className="opacity-60">Expected open</dt>
              <dd className="text-base">{fmt(heavy?.next.open)}</dd>
            </div>
            <div>
              <dt className="opacity-60">Expected close</dt>
              <dd className="text-base">{fmt(heavy?.next.close)}</dd>
            </div>
            <div>
              <dt className="opacity-60">Expected high</dt>
              <dd className="text-base">{fmt(heavy?.next.high)}</dd>
            </div>
            <div>
              <dt className="opacity-60">Expected low</dt>
              <dd className="text-base">{fmt(heavy?.next.low)}</dd>
            </div>
            <div>
              <dt className="opacity-60">Expected move</dt>
              <dd className="text-base">{heavy ? `${heavy.next.expectedMovePct.toFixed(3)}%` : "—"}</dd>
            </div>
            <div>
              <dt className="opacity-60">Ensemble score</dt>
              <dd className="text-base">{heavy ? heavy.score.toFixed(2) : "—"}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap gap-2 text-[11px]">
            <Badge variant="outline" className="tick border-current/40">
              Signal quality: {heavy?.quality ?? "—"}
            </Badge>
            <Badge variant="outline" className="tick border-current/40">
              Regime: {heavy ? REGIME_LABEL[heavy.regime] : "—"}
            </Badge>
            <Badge variant="outline" className="tick border-current/40">
              Agreement: {heavy ? `${heavy.agreement.toFixed(0)}%` : "—"}
            </Badge>
            <Badge variant="outline" className="tick border-current/40">
              HTF: {heavy?.extras.htfBias == null ? "—" : heavy.extras.htfBias > 0.1 ? "Bullish" : heavy.extras.htfBias < -0.1 ? "Bearish" : "Flat"}
            </Badge>
            <Badge variant="outline" className="tick border-current/40">
              Markov: {heavy?.markov.prob == null ? "—" : `${(heavy.markov.prob * 100).toFixed(0)}% up`}
            </Badge>
          </div>

          <div className="mt-5 rounded-lg bg-foreground/5 p-3 text-xs">
            <p className="opacity-70">Backtest (last {heavy?.backtest.tested ?? 0} signals)</p>
            <p className="tick text-lg font-semibold">
              {heavy && heavy.backtest.tested > 0 ? `${heavy.backtest.accuracy.toFixed(1)}% hit rate` : "—"}
            </p>
            <p className="opacity-60">
              {heavy ? `${heavy.backtest.correct} correct / ${heavy.backtest.tested} tested` : ""}
            </p>
          </div>

          {dataUpdatedAt > 0 && (
            <p className="tick mt-5 text-[11px] opacity-60">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()} · auto refresh 20s
            </p>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Factor engine ({heavy?.factors.length ?? 0} signals)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Har factor ka weight uske rolling hit rate se auto-tune hota hai — jo factor recent data me sahi raha,
            uska asar zyada.
          </p>

          <dl className="tick mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
            {[
              { k: "RSI 14", v: signal?.rsi?.toFixed(1) ?? "—" },
              { k: "Stochastic", v: heavy?.stoch?.toFixed(1) ?? "—" },
              { k: "MACD hist", v: heavy?.macd.hist?.toFixed(3) ?? "—" },
              { k: "%B (Bollinger)", v: heavy?.bb.pctB?.toFixed(1) ?? "—" },
              { k: "ADX", v: heavy?.extras.adx?.toFixed(1) ?? "—" },
              { k: "+DI / -DI", v: heavy ? `${fmt(heavy.extras.plusDI, 1)} / ${fmt(heavy.extras.minusDI, 1)}` : "—" },
              { k: "Williams %R", v: heavy?.extras.williamsR?.toFixed(1) ?? "—" },
              { k: "CCI 20", v: heavy?.extras.cci?.toFixed(0) ?? "—" },
              { k: "ROC 9", v: heavy?.extras.roc == null ? "—" : `${heavy.extras.roc.toFixed(2)}%` },
              { k: "VWAP 20", v: fmt(heavy?.extras.vwap) },
              { k: "Z-score", v: heavy?.extras.zscore?.toFixed(2) ?? "—" },
              { k: "Ichimoku T/K", v: heavy ? `${fmt(heavy.extras.tenkan)} / ${fmt(heavy.extras.kijun)}` : "—" },
              { k: "ATR %", v: signal?.atrPct?.toFixed(3) ?? "—" },
              { k: "Support", v: fmt(heavy?.levels.support) },
              { k: "Resistance", v: fmt(heavy?.levels.resistance) },
            ].map((x) => (
              <div key={x.k} className="rounded-lg bg-secondary/50 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{x.k}</dt>
                <dd className="mt-1 text-sm font-medium">{x.v}</dd>
              </div>
            ))}
          </dl>

          {!!heavy?.patterns.length && (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Detected patterns</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {heavy.patterns.map((p) => (
                  <Badge
                    key={p.name}
                    variant="outline"
                    className={cn(
                      "tick",
                      p.bias === "up" && "border-bull/50 text-bull",
                      p.bias === "down" && "border-bear/50 text-bear",
                      p.bias === "neutral" && "border-border text-muted-foreground",
                    )}
                    title={p.note}
                  >
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <ul className="mt-5 space-y-2">
            {(heavy?.factors ?? []).map((f) => {
              const impact = f.value * f.weight;
              const pct = Math.min(100, Math.abs(impact) * 45);
              return (
                <li key={f.key} className="rounded-lg bg-secondary/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{f.label}</p>
                    <span
                      className={cn(
                        "tick text-xs",
                        impact > 0.05 ? "text-bull" : impact < -0.05 ? "text-bear" : "text-muted-foreground",
                      )}
                    >
                      {impact > 0 ? "+" : ""}
                      {impact.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className={cn("h-full rounded-full", impact >= 0 ? "bg-bull" : "bg-bear")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="tick mt-1.5 text-[11px] text-muted-foreground">
                    weight {f.weight.toFixed(2)} · hit rate {f.hitRate == null ? "n/a" : `${f.hitRate.toFixed(0)}%`}
                  </p>
                </li>
              );
            })}
            {heavy === null && !isLoading && (
              <li className="text-sm text-muted-foreground">Analysis ke liye kaafi candles nahi hain.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bot className="size-5 text-primary" /> AI Second Review
          </h2>
          {reviewLoading && (
            <span className="tick flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="size-3.5 animate-pulse" /> AI signal review kar raha hai…
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Har naye signal par AI independent doosri raay deta hai — engine ke indicators, patterns aur levels dekh kar.
        </p>

        {reviewError && (
          <p className="mt-4 text-sm text-destructive">
            {(reviewErr as Error)?.message ?? "AI review fail ho gaya."}
          </p>
        )}

        {review && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className={cn("text-3xl font-bold", aiTone)}>{review.verdict}</span>
              <Badge variant="outline" className="tick">
                Confidence: {review.confidence}%
              </Badge>
              <Badge
                variant="outline"
                className={cn("tick", review.agreesWithEngine ? "border-bull/50 text-bull" : "border-bear/50 text-bear")}
              >
                {review.agreesWithEngine ? "Engine se agree" : "Engine se disagree"}
              </Badge>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
              <div className={cn("h-full rounded-full bg-current", aiTone)} style={{ width: `${review.confidence}%` }} />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">AI reasoning</p>
                <p className="mt-1 text-sm">{review.reason}</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Risk</p>
                <p className="mt-1 text-sm">{review.risk}</p>
              </div>
            </div>
            {!review.agreesWithEngine && (
              <p className="mt-4 text-xs text-warn">
                AI aur engine ka direction match nahi kar raha — is signal par trade avoid karna behtar hai.
              </p>
            )}
          </>
        )}

        {!review && !reviewLoading && !reviewError && (
          <p className="mt-4 text-sm text-muted-foreground">Signal ban jaye to AI review yahan aa jayega.</p>
        )}
      </section>



      <section className="panel flex items-start gap-3 border-warn/40 bg-warn/5 p-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Zaroori baat:</span> Yeh prediction probability-based
          estimate hai, guarantee nahi. Koi bhi engine agli candle ko 100% predict nahi kar sakta — backtest hit
          rate past data par hai aur future me badal sakta hai. Educational use only, financial advice nahi.
        </p>
      </section>
    </main>
  );
}
