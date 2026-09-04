import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function useNextCandleTime(interval: string, lastOpenTime?: number) {
  const step = MS[interval] ?? 300_000;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (now == null) return null;
  const base = lastOpenTime != null ? lastOpenTime + step : Math.ceil(now / step) * step;
  let closeAt = base;
  while (closeAt <= now) closeAt += step;
  const remaining = Math.max(0, closeAt - now);
  return { closeAt, remaining, step };
}

export function CandleCountdown({
  interval,
  lastOpenTime,
  compact = false,
}: {
  interval: string;
  lastOpenTime?: number;
  compact?: boolean;
}) {
  const t = useNextCandleTime(interval, lastOpenTime);
  if (!t) return null;

  const total = Math.floor(t.remaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const label = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  const pct = 100 - (t.remaining / t.step) * 100;
  const closeTime = new Date(t.closeAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (compact) {
    return (
      <span className="tick flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" /> Next candle: {label}
      </span>
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-current/20 bg-foreground/5 p-3">
      <div className="flex items-center justify-between text-xs opacity-80">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" /> Next candle banne mein
        </span>
        <span className="tick">{closeTime} par</span>
      </div>
      <p className="tick mt-1 text-2xl font-semibold tabular-nums">{label}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-current transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
