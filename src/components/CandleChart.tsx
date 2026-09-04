import type { Candle } from "@/lib/indicators";

type Props = { candles: Candle[]; ema9: (number | null)[]; ema21: (number | null)[] };

const W = 900;
const H = 320;
const PAD = 8;

function path(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let started = false;
  values.forEach((v, i) => {
    if (v === null || Number.isNaN(v)) return;
    d += `${started ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)} `;
    started = true;
  });
  return d.trim();
}

export function CandleChart({ candles, ema9, ema21 }: Props) {
  if (candles.length === 0) return null;
  const view = candles.slice(-60);
  const offset = candles.length - view.length;
  const e9 = ema9.slice(offset);
  const e21 = ema21.slice(offset);

  const lows = view.map((c) => c.low);
  const highs = view.map((c) => c.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;

  const step = (W - PAD * 2) / view.length;
  const x = (i: number) => PAD + step * (i + 0.5);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const bw = Math.max(2, step * 0.6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" role="img" aria-label="Candlestick chart">
      {[0.25, 0.5, 0.75].map((p) => (
        <line
          key={p}
          x1={0}
          x2={W}
          y1={PAD + p * (H - PAD * 2)}
          y2={PAD + p * (H - PAD * 2)}
          stroke="currentColor"
          className="text-border"
          strokeDasharray="3 6"
        />
      ))}
      {view.map((c, i) => {
        const up = c.close >= c.open;
        const cls = up ? "text-bull" : "text-bear";
        const top = y(Math.max(c.open, c.close));
        const bot = y(Math.min(c.open, c.close));
        return (
          <g key={c.openTime} className={cls}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke="currentColor" strokeWidth={1} />
            <rect
              x={x(i) - bw / 2}
              y={top}
              width={bw}
              height={Math.max(1, bot - top)}
              fill="currentColor"
              opacity={up ? 0.9 : 0.85}
            />
          </g>
        );
      })}
      <path d={path(e9, x, y)} fill="none" stroke="currentColor" className="text-primary" strokeWidth={1.6} />
      <path d={path(e21, x, y)} fill="none" stroke="currentColor" className="text-accent" strokeWidth={1.6} opacity={0.8} />
    </svg>
  );
}
