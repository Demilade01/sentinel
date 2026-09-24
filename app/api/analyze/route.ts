import Groq from "groq-sdk";
import { z } from "zod";
import { gatherMarketData, marketDataContext } from "@/lib/market-data";
import { computeRiskModel, type RiskFactor } from "@/lib/risk";

// Sentinel runs at request time (reads query/body + live data); never cached.
export const dynamic = "force-dynamic";

const MODEL = "openai/gpt-oss-120b";
const DISCLAIMER = "Informational analysis only, not financial advice.";
const MAX_COMPARE = 5;

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
  asset: z.string().trim().min(1, "asset is required").max(400, "asset is too long"),
  question: z.string().trim().max(500, "question is too long").optional(),
});

const SENTIMENTS = ["bullish", "neutral", "bearish"] as const;
const CONFIDENCE = ["low", "medium", "high"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
type Confidence = (typeof CONFIDENCE)[number];

interface AnalyzeResult {
  asset: string;
  resolved: { name?: string; symbol?: string; contractAddress?: string };
  summary: string;
  sentiment: Sentiment;
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  riskFactors: RiskFactor[];
  confidence: Confidence;
  keyMetrics: { label: string; value: string }[];
  signals: string[];
  data: {
    priceUsd?: number;
    marketCapUsd?: number;
    vol24hUsd?: number;
    change24hPct?: number;
    change7dPct?: number;
    change30dPct?: number;
    volatility30dPct?: number;
    tvlUsd?: number;
    marketCapRank?: number;
    spark?: number[];
  };
  dataSources: string[];
  disclaimer: string;
  model: string;
  generatedAt: string;
}

const USAGE = {
  agent: "sentinel",
  description:
    "DeFi risk & market analyst agent. Fetches live market data (CoinGecko + DeFiLlama + GoPlus), computes an explainable multi-factor risk model, and returns a data-grounded verdict as structured JSON.",
  endpoints: {
    "GET /api/analyze": "Returns this usage document when called with no params.",
    "GET /api/analyze?asset=<symbol|address|protocol>&question=<optional>": "Analyze one asset.",
    "GET /api/analyze?asset=ETH,SOL,AAVE":
      "Compare mode — analyze up to 5 comma-separated assets and rank them by risk.",
    "POST /api/analyze": 'JSON body: { "asset": "ETH", "question": "optional" }',
  },
  responseSchema: {
    asset: "string",
    resolved: "{ name?, symbol?, contractAddress? }",
    summary: "string",
    sentiment: "bullish | neutral | bearish",
    riskLevel: "low | medium | high",
    riskScore: "number 0-100 (computed, reproducible)",
    riskFactors: "{ key, label, score, weight, note }[]",
    confidence: "low | medium | high",
    keyMetrics: "{ label, value }[]",
    signals: "string[]",
    data: "{ priceUsd?, marketCapUsd?, vol24hUsd?, change24hPct?, change7dPct?, change30dPct?, volatility30dPct?, tvlUsd?, marketCapRank?, spark? }",
    dataSources: "string[]",
    disclaimer: "string",
    model: "string",
    generatedAt: "ISO-8601 string",
  },
  dataSources: [
    "CoinGecko (price / market cap / volume / 30d history / resolution)",
    "DeFiLlama (protocol TVL)",
    "GoPlus (token contract security)",
  ],
  compare: { example: "GET /api/analyze?asset=ETH,SOL,AAVE", note: "returns { mode:'compare', results, ranked }" },
  example: { request: "GET /api/analyze?asset=ETH", curl: 'curl "https://<your-deploy>/api/analyze?asset=ETH"' },
  policy: { stateless: true, readOnly: true, authRequired: false, paymentRequired: false },
  disclaimer: DISCLAIMER,
  model: MODEL,
} as const;

// ---------------------------- Groq analysis --------------------------------
function buildMessages(
  asset: string,
  ctx: string[],
  factors: RiskFactor[],
  riskScore: number,
  question?: string
) {
  const dataBlock = ctx.length
    ? `LIVE MARKET DATA (fetched just now — treat as ground truth):\n${ctx.map((l) => `- ${l}`).join("\n")}`
    : "LIVE MARKET DATA: none available (resolution failed). Analyze qualitatively and keep confidence low.";

  const riskBlock = factors.length
    ? `COMPUTED RISK MODEL (already scored deterministically; overall ${riskScore}/100):\n${factors
        .map((f) => `- ${f.label}: ${f.score}/100 — ${f.note}`)
        .join("\n")}`
    : "COMPUTED RISK MODEL: insufficient data.";

  const system = [
    "You are SENTINEL, a DeFi market and risk analyst agent.",
    "You are given an asset, LIVE market data, and a pre-computed risk model. Ground every claim in that data; never contradict the numbers or the risk model, and never invent figures that were not given.",
    "You provide INFORMATIONAL ANALYSIS ONLY. Never give financial/investment/trading advice; never tell anyone to buy, sell, or hold.",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, exactly this shape:",
    "{",
    '  "summary": string (2-4 sentence neutral overview that references the data and the main risk drivers),',
    '  "sentiment": "bullish" | "neutral" | "bearish" (momentum/positioning, not advice),',
    '  "signals": string[] (3-6 short, specific observations grounded in the data/risk model)',
    "}",
  ].join("\n");

  const user = [`Asset: ${asset}`, dataBlock, riskBlock, question ? `Question: ${question}` : ""]
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
function coerceSignals(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s).slice(0, 200)).filter(Boolean).slice(0, 8);
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
function confidenceFrom(sourcesCount: number, hasPrice: boolean): Confidence {
  if (hasPrice && sourcesCount >= 2) return "high";
  if (hasPrice || sourcesCount >= 1) return "medium";
  return "low";
}
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

  const market = await gatherMarketData(asset);
  const { contextLines, seededMetrics } = marketDataContext(market);
  const risk = computeRiskModel(market);

  const client = new Groq({ apiKey });
  let content: string;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: buildMessages(asset, contextLines, risk.factors, risk.riskScore, question),
      temperature: 0.2,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });
    content = completion.choices[0]?.message?.content ?? "";
  } catch {
    throw new UpstreamError("Upstream analysis provider failed.");
  }

  const parsed = parseModelJson(content);

  return {
    asset,
    resolved: {
      name: market.resolvedName,
      symbol: market.symbol,
      contractAddress: market.contractAddress,
    },
    summary: String(parsed.summary ?? "").trim() || "No summary was produced for this asset.",
    sentiment: coerceSentiment(parsed.sentiment),
    riskLevel: risk.riskLevel,
    riskScore: risk.riskScore,
    riskFactors: risk.factors,
    confidence: confidenceFrom(market.dataSources.length, market.priceUsd != null),
    keyMetrics: mergeMetrics(seededMetrics, parsed.keyMetrics),
    signals: coerceSignals(parsed.signals),
    data: {
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd,
      vol24hUsd: market.vol24hUsd,
      change24hPct: market.change24hPct,
      change7dPct: market.change7dPct,
      change30dPct: market.change30dPct,
      volatility30dPct: market.volatility30dPct,
      tvlUsd: market.tvlUsd,
      marketCapRank: market.marketCapRank,
      spark: market.spark,
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

  const parsed = InputSchema.safeParse({ asset, question: searchParams.get("question") ?? undefined });
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.issues.map((i) => i.message) }, 400);
  }
  return dispatch(parsed.data.asset, parsed.data.question);
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
    return json({ error: "Invalid input", details: parsed.error.issues.map((i) => i.message) }, 400);
  }
  return dispatch(parsed.data.asset, parsed.data.question);
}

// Compare mode when the asset field is a comma-separated list.
async function dispatch(asset: string, question?: string) {
  const parts = Array.from(new Set(asset.split(",").map((a) => a.trim()).filter(Boolean)));
  if (parts.length > 1) return runCompare(parts.slice(0, MAX_COMPARE));
  return runAnalysis(parts[0] ?? asset, question);
}

async function runAnalysis(asset: string, question?: string) {
  try {
    return json(await analyze(asset, question), 200);
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : "Analysis failed.";
    return json({ error: "Analysis failed", details: message }, 502);
  }
}

async function runCompare(assets: string[]) {
  try {
    const settled = await Promise.all(
      assets.map((a) => analyze(a).catch(() => null))
    );
    const results = settled.filter((r): r is AnalyzeResult => r !== null);
    if (results.length === 0) {
      return json({ error: "Analysis failed", details: "No assets could be analyzed." }, 502);
    }
    const ranked = [...results]
      .sort((a, b) => a.riskScore - b.riskScore)
      .map((r) => ({
        asset: r.asset,
        symbol: r.resolved.symbol,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        sentiment: r.sentiment,
        priceUsd: r.data.priceUsd,
        change24hPct: r.data.change24hPct,
      }));
    return json(
      {
        mode: "compare",
        assets,
        ranked,
        safest: ranked[0]?.asset,
        results,
        disclaimer: DISCLAIMER,
        model: MODEL,
        generatedAt: new Date().toISOString(),
      },
      200
    );
  } catch {
    return json({ error: "Analysis failed", details: "Compare failed." }, 502);
  }
}
