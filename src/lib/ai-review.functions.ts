import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  interval: z.string(),
  price: z.number(),
  direction: z.string(),
  probability: z.number(),
  score: z.number(),
  quality: z.string(),
  regime: z.string(),
  agreement: z.number(),
  patterns: z.array(z.string()),
  indicators: z.record(z.string(), z.union([z.number(), z.null()])),
  levels: z.object({ support: z.number().nullable(), resistance: z.number().nullable() }),
  backtest: z.object({ accuracy: z.number(), tested: z.number() }),
  recentCloses: z.array(z.number()),
});

export type AiReview = {
  verdict: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  agreesWithEngine: boolean;
  reason: string;
  risk: string;
};

export const aiReviewSignal = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<AiReview> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI key configured nahi hai.");

    const prompt = `Tum ek professional XAU/USD (gold) intraday analyst ho. Neeche ek technical engine ka output hai.
Timeframe: ${data.interval}
Current price: ${data.price}
Engine prediction: ${data.direction} (${data.probability}% probability, score ${data.score.toFixed(2)}, quality ${data.quality})
Market regime: ${data.regime}, factor agreement: ${data.agreement.toFixed(0)}%
Detected candle patterns: ${data.patterns.join(", ") || "none"}
Indicators: ${Object.entries(data.indicators)
      .map(([k, v]) => `${k}=${v == null ? "n/a" : v}`)
      .join(", ")}
Support: ${data.levels.support ?? "n/a"} | Resistance: ${data.levels.resistance ?? "n/a"}
Rolling backtest: ${data.backtest.accuracy.toFixed(1)}% over ${data.backtest.tested} signals
Last closes: ${data.recentCloses.map((c) => c.toFixed(2)).join(", ")}

Independent second opinion do: agli candle UP, DOWN ya NEUTRAL? Sirf JSON return karo is shape me:
{"verdict":"UP|DOWN|NEUTRAL","confidence":0-100,"reason":"1-2 short Roman-Urdu lines","risk":"1 short Roman-Urdu line kis cheez se signal fail ho sakta hai"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          {
            role: "system",
            content:
              "Tum disciplined trading analyst ho. Sirf valid JSON output do, koi markdown ya extra text nahi. Overconfident na bano.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("AI review rate limited — thodi der baad try karein.");
      if (res.status === 402) throw new Error("AI credits khatam ho gaye hain.");
      if (res.status === 403) throw new Error("AI access workspace policy se blocked hai.");
      throw new Error(`AI review fail (${res.status}): ${body.slice(0, 180)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = safeJson(text);

    const verdictRaw = String(parsed?.["verdict"] ?? "NEUTRAL").toUpperCase();
    const verdict: AiReview["verdict"] =
      verdictRaw === "UP" ? "UP" : verdictRaw === "DOWN" ? "DOWN" : "NEUTRAL";
    const confRaw = Number(parsed?.["confidence"]);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(100, Math.round(confRaw))) : 50;

    return {
      verdict,
      confidence,
      agreesWithEngine: verdict === data.direction.toUpperCase(),
      reason: String(parsed?.["reason"] ?? text.slice(0, 220) || "AI ne reason nahi diya."),
      risk: String(parsed?.["risk"] ?? "Volatility spike aur news events signal invalid kar sakte hain."),
    };
  });

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
