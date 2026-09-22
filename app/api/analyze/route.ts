import Groq from "groq-sdk";
import { z } from "zod";
import {
  gatherMarketData,
  marketDataContext,
  type MarketData,
} from "@/lib/market-data";

// Sentinel runs at request time (reads query/body + live data); never cached.
export const dynamic = "force-dynamic";

const MODEL = "openai/gpt-oss-120b";
const DISCLAIMER = "Informational analysis only, not financial advice.";

// ---- CORS: public, read-only, open by design (no auth / payment headers) ----
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---------------------------- Input validation ----------------------------
const InputSchema = z.object({
  asset: z.string().trim().min(1, "asset is required").max(120, "asset is too long"),
  question: z.string().trim().max(500, "question is too long").optional(),
});

// ---------------------------- Stable output shape --------------------------
const SENTIMENTS = ["bullish", "neutral", "bearish"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const CONFIDENCE = ["low", "medium", "high"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type Confidence = (typeof CONFIDENCE)[number];

interface AnalyzeResult {
  asset: string;
  resolved: { name?: string; symbol?: string };
  summary: string;
  sentiment: Sentiment;
  riskLevel: RiskLevel;
  riskScore: number;
  confidence: Confidence;
  keyMetrics: { label: string; value: string }[];
  signals: string[];
  data: {
    priceUsd?: number;
    marketCapUsd?: number;
    vol24hUsd?: number;
    change24hPct?: number;
    tvlUsd?: number;
    marketCapRank?: number;
  };
  dataSources: string[];
  disclaimer: string;
  model: string;
  generatedAt: string;
}

const USAGE = {
  agent: "sentinel",
  description:
    "DeFi risk & market analyst agent. Given a token, protocol, or wallet, fetches live market data (CoinGecko + DeFiLlama) and returns a data-grounded sentiment, risk score, key metrics, and signals as structured JSON.",
  endpoints: {
    "GET /api/analyze": "Returns this usage document when called with no params.",
    "GET /api/analyze?asset=<symbol|address|protocol>&question=<optional>":
      "Analyze an asset.",
    "POST /api/analyze": 'JSON body: { "asset": "ETH", "question": "optional" }',
  },
  responseSchema: {
    asset: "string",
    resolved: "{ name?: string, symbol?: string }",
    summary: "string",
    sentiment: "bullish | neutral | bearish",
    riskLevel: "low | medium | high",
    riskScore: "number 0-100",
    confidence: "low | medium | high",
    keyMetrics: "{ label: string, value: string }[]",
    signals: "string[]",
    data: "{ priceUsd?, marketCapUsd?, vol24hUsd?, change24hPct?, tvlUsd?, marketCapRank? }",
    dataSources: "string[]",
    disclaimer: "string",
    model: "string",
    generatedAt: "ISO-8601 string",
  },
  dataSources: ["CoinGecko (public API)", "DeFiLlama (public API)"],
  example: {
    request: "GET /api/analyze?asset=ETH",
    curl: 'curl "https://<your-deploy>/api/analyze?asset=ETH"',
  },
  policy: { stateless: true, readOnly: true, authRequired: false, paymentRequired: false },
  disclaimer: DISCLAIMER,
  model: MODEL,
} as const;

// ---------------------------- Groq analysis --------------------------------
function buildMessages(asset: string, ctx: string[], question?: string) {
  const dataBlock = ctx.length
    ? `LIVE MARKET DATA (fetched just now from public APIs — treat as ground truth):\n${ctx
        .map((l) => `- ${l}`)
        .join("\n")}`
    : "LIVE MARKET DATA: none available for this asset (resolution failed). Analyze qualitatively and lower your confidence accordingly.";

  const system = [
    "You are SENTINEL, a DeFi market and risk analyst agent.",
    "You are given an asset and, when available, LIVE market data. Ground every claim in that data; never contradict the provided numbers and never invent precise figures that were not given.",
    "You provide INFORMATIONAL ANALYSIS ONLY. Never give financial, investment, or trading advice; never tell anyone to buy, sell, or hold.",
    "Reason over standard DeFi risk factors: liquidity/volume, volatility, market cap size, TVL, smart-contract and custody risk, concentration, and market structure.",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, exactly this shape:",
    "{",
    '  "summary": string (2-4 sentence neutral overview grounded in the data),',
    '  "sentiment": "bullish" | "neutral" | "bearish",',
    '  "riskScore": number (0-100; 0 = safest, 100 = riskiest),',
    '  "signals": string[] (3-6 short, specific observations a watcher should note)',
    "}",
  ].join("\n");

  const user = [
    `Asset: ${asset}`,
    dataBlock,
    question ? `Question: ${question}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

function coerceSentiment(v: unknown): Sentiment {
  const s = String(v ?? "").toLowerCase();
  return (SENTIMENTS as readonly string[]).includes(s) ? (s as Sentiment) : "neutral";
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score <= 33) return "low";
  if (score <= 66) return "medium";
  return "high";
}

function mergeMetrics(
  seeded: { label: string; value: string }[],
  modelMetrics: unknown
): { label: string; value: string }[] {
  const fromModel = Array.isArray(modelMetrics)
    ? modelMetrics
        .map((m) => ({
          label: String((m as { label?: unknown })?.label ?? "").slice(0, 80),
          value: String((m as { value?: unknown })?.value ?? "").slice(0, 160),
        }))
        .filter((m) => m.label && m.value)
    : [];
  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];
  for (const m of [...seeded, ...fromModel]) {
    const key = m.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 8);
}

function coerceSignals(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s).slice(0, 200)).filter(Boolean).slice(0, 8);
}

function confidenceFrom(d: MarketData): Confidence {
  const hasPrice = d.priceUsd != null;
  const hasSize = d.marketCapUsd != null || d.tvlUsd != null;
  if (hasPrice && hasSize) return "high";
  if (hasPrice || hasSize) return "medium";
  return "low";
}

// Try strict JSON, then extract the first {...} block, never throw on prose.
function parseModelJson(raw: string): Record<string, unknown> {
  const attempt = (t: string) => {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const direct = attempt(raw);
  if (direct) return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = attempt(match[0]);
    if (extracted) return extracted;
  }
  return { summary: raw.trim().slice(0, 600) };
}

class UpstreamError extends Error {}

async function analyze(asset: string, question?: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new UpstreamError("Analysis service is not configured.");

  // 1) Live data (never throws; returns partials on failure).
  const market = await gatherMarketData(asset);
  const { contextLines, seededMetrics } = marketDataContext(market);

  // 2) Model reasons over the data.
  const client = new Groq({ apiKey });
  let content: string;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: buildMessages(asset, contextLines, question),
      temperature: 0.2,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });
    content = completion.choices[0]?.message?.content ?? "";
  } catch {
    throw new UpstreamError("Upstream analysis provider failed.");
  }

  const parsed = parseModelJson(content);
  const riskScore = clampScore(parsed.riskScore);

  return {
    asset,
    resolved: { name: market.resolvedName, symbol: market.symbol },
    summary:
      String(parsed.summary ?? "").trim() ||
      "No summary was produced for this asset.",
    sentiment: coerceSentiment(parsed.sentiment),
    riskLevel: riskLevelFromScore(riskScore),
    riskScore,
    confidence: confidenceFrom(market),
    keyMetrics: mergeMetrics(seededMetrics, parsed.keyMetrics),
    signals: coerceSignals(parsed.signals),
    data: {
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd,
      vol24hUsd: market.vol24hUsd,
      change24hPct: market.change24hPct,
      tvlUsd: market.tvlUsd,
      marketCapRank: market.marketCapRank,
    },
    dataSources: market.dataSources,
    disclaimer: DISCLAIMER,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------- Handlers -------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset");
  if (!asset) return json(USAGE, 200);

  const parsed = InputSchema.safeParse({
    asset,
    question: searchParams.get("question") ?? undefined,
  });
  if (!parsed.success) {
    return json(
      { error: "Invalid input", details: parsed.error.issues.map((i) => i.message) },
      400
    );
  }
  return runAnalysis(parsed.data.asset, parsed.data.question);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid input", details: ["Body must be valid JSON"] }, 400);
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid input", details: parsed.error.issues.map((i) => i.message) },
      400
    );
  }
  return runAnalysis(parsed.data.asset, parsed.data.question);
}

async function runAnalysis(asset: string, question?: string) {
  try {
    return json(await analyze(asset, question), 200);
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : "Analysis failed.";
    return json({ error: "Analysis failed", details: message }, 502);
  }
}
