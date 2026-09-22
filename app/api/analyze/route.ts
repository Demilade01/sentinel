import Groq from "groq-sdk";
import { z } from "zod";

// Sentinel runs at request time (reads query/body); never cached, never prerendered.
export const dynamic = "force-dynamic";

const MODEL = "llama-3.3-70b-versatile";
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
  asset: z
    .string()
    .trim()
    .min(1, "asset is required")
    .max(120, "asset is too long"),
  question: z.string().trim().max(500, "question is too long").optional(),
});

// ---------------------------- Stable output shape --------------------------
const SENTIMENTS = ["bullish", "neutral", "bearish"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];

interface AnalyzeResult {
  asset: string;
  summary: string;
  sentiment: Sentiment;
  riskLevel: RiskLevel;
  keyMetrics: { label: string; value: string }[];
  signals: string[];
  disclaimer: string;
  model: string;
  generatedAt: string;
}

const USAGE = {
  agent: "sentinel",
  description:
    "DeFi risk & market analyst agent. Given a token, protocol, or wallet, returns sentiment, risk level, key metrics, and signals as structured JSON.",
  endpoints: {
    "GET /api/analyze": "Returns this usage document when called with no params.",
    "GET /api/analyze?asset=<symbol|address|protocol>&question=<optional>":
      "Analyze an asset.",
    "POST /api/analyze": 'JSON body: { "asset": "ETH", "question": "optional" }',
  },
  responseSchema: {
    asset: "string",
    summary: "string",
    sentiment: "bullish | neutral | bearish",
    riskLevel: "low | medium | high",
    keyMetrics: "{ label: string, value: string }[]",
    signals: "string[]",
    disclaimer: "string",
    model: "string",
    generatedAt: "ISO-8601 string",
  },
  example: {
    request: "GET /api/analyze?asset=ETH",
    curl: 'curl "https://<your-deploy>/api/analyze?asset=ETH"',
  },
  policy: {
    stateless: true,
    readOnly: true,
    authRequired: false,
    paymentRequired: false,
  },
  disclaimer: DISCLAIMER,
  model: MODEL,
} as const;

// ---------------------------- Groq analysis --------------------------------
function buildMessages(asset: string, question?: string) {
  const system = [
    "You are SENTINEL, a DeFi market and risk analyst agent.",
    "Given an asset (token symbol, contract address, protocol, or wallet), produce a concise, sober analysis of its market sentiment and risk profile.",
    "You provide INFORMATIONAL ANALYSIS ONLY. You never give financial, investment, or trading advice, and never tell anyone to buy, sell, or hold.",
    "Base your reasoning on generally known characteristics of the asset and DeFi risk factors (liquidity, volatility, smart-contract and custody risk, concentration, market structure). Do not invent precise live prices or figures; if a metric is not known, describe it qualitatively.",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:",
    "{",
    '  "summary": string (2-4 sentence neutral overview),',
    '  "sentiment": "bullish" | "neutral" | "bearish",',
    '  "riskLevel": "low" | "medium" | "high",',
    '  "keyMetrics": [{ "label": string, "value": string }] (3-6 items, qualitative allowed),',
    '  "signals": string[] (3-6 short observations a watcher should note)',
    "}",
  ].join("\n");

  const user = question
    ? `Asset: ${asset}\nQuestion: ${question}`
    : `Asset: ${asset}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

function coerceSentiment(v: unknown): Sentiment {
  const s = String(v ?? "").toLowerCase();
  return (SENTIMENTS as readonly string[]).includes(s)
    ? (s as Sentiment)
    : "neutral";
}

function coerceRisk(v: unknown): RiskLevel {
  const s = String(v ?? "").toLowerCase();
  return (RISK_LEVELS as readonly string[]).includes(s)
    ? (s as RiskLevel)
    : "medium";
}

function coerceMetrics(v: unknown): { label: string; value: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => ({
      label: String((m as { label?: unknown })?.label ?? "").slice(0, 80),
      value: String((m as { value?: unknown })?.value ?? "").slice(0, 160),
    }))
    .filter((m) => m.label && m.value)
    .slice(0, 8);
}

function coerceSignals(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => String(s).slice(0, 200))
    .filter(Boolean)
    .slice(0, 8);
}

// Mirrors the parseGroqResponse fallback pattern from agent-hive: try strict
// JSON, then extract the first {...} block, and never throw on model prose.
function parseModelJson(raw: string): Record<string, unknown> {
  const attempt = (text: string) => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
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

  // Fallback: keep the model's prose as the summary rather than failing.
  return { summary: raw.trim().slice(0, 600) };
}

async function analyze(asset: string, question?: string): Promise<AnalyzeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Configuration error surfaced generically; no secret material in the body.
    throw new UpstreamError("Analysis service is not configured.");
  }

  const client = new Groq({ apiKey });

  let content: string;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: buildMessages(asset, question),
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
    summary:
      String(parsed.summary ?? "").trim() ||
      "No summary was produced for this asset.",
    sentiment: coerceSentiment(parsed.sentiment),
    riskLevel: coerceRisk(parsed.riskLevel),
    keyMetrics: coerceMetrics(parsed.keyMetrics),
    signals: coerceSignals(parsed.signals),
    disclaimer: DISCLAIMER,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

class UpstreamError extends Error {}

// ---------------------------- Handlers -------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset");

  // Self-documenting: no asset -> usage/schema/example.
  if (!asset) {
    return json(USAGE, 200);
  }

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
    const result = await analyze(asset, question);
    return json(result, 200);
  } catch (err) {
    // Never leak stack traces or secrets. Upstream/config issues -> 502.
    const message =
      err instanceof UpstreamError ? err.message : "Analysis failed.";
    return json({ error: "Analysis failed", details: message }, 502);
  }
}
