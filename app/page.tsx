"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface KeyMetric {
  label: string;
  value: string;
}
interface AnalyzeResult {
  asset: string;
  resolved: { name?: string; symbol?: string };
  summary: string;
  sentiment: "bullish" | "neutral" | "bearish";
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  confidence: "low" | "medium" | "high";
  keyMetrics: KeyMetric[];
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

type Line =
  | { kind: "out"; text: string; tone?: "dim" | "amber" | "red" | "cyan" }
  | { kind: "cmd"; text: string }
  | { kind: "result"; data: AnalyzeResult };

const BANNER = [
  "  ███████ ███████ ███    ██ ████████ ██ ███    ██ ███████ ██",
  "  ██      ██      ████   ██    ██    ██ ████   ██ ██      ██",
  "  ███████ █████   ██ ██  ██    ██    ██ ██ ██  ██ █████   ██",
  "       ██ ██      ██  ██ ██    ██    ██ ██  ██ ██ ██      ██",
  "  ███████ ███████ ██   ████    ██    ██ ██   ████ ███████ ███████",
];

const EXAMPLES = ["ETH", "BTC", "SOL", "AAVE", "uniswap", "curve", "PEPE"];

function sentimentTone(s: AnalyzeResult["sentiment"]) {
  if (s === "bullish") return "text-[var(--term-fg)]";
  if (s === "bearish") return "text-[var(--term-red)]";
  return "text-[var(--term-amber)]";
}
function riskTone(r: AnalyzeResult["riskLevel"]) {
  if (r === "low") return "text-[var(--term-fg)]";
  if (r === "high") return "text-[var(--term-red)]";
  return "text-[var(--term-amber)]";
}
function toneClass(tone?: "dim" | "amber" | "red" | "cyan") {
  switch (tone) {
    case "dim":
      return "text-[var(--term-muted)]";
    case "amber":
      return "text-[var(--term-amber)]";
    case "red":
      return "text-[var(--term-red)]";
    case "cyan":
      return "text-[var(--term-cyan)]";
    default:
      return "";
  }
}
function changeTone(n?: number) {
  if (n == null) return "";
  return n >= 0 ? "text-[var(--term-fg)]" : "text-[var(--term-red)]";
}

export default function Home() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "SENTINEL v1 // DeFi risk & market analyst", tone: "cyan" },
    {
      kind: "out",
      text: "live data: CoinGecko + DeFiLlama · public · stateless · read-only",
      tone: "dim",
    },
    {
      kind: "out",
      text: 'type an asset and press enter — e.g. "ETH", "aave", "0xabc…"',
      tone: "dim",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, busy]);

  const push = (l: Line) => setLines((prev) => [...prev, l]);

  const run = useCallback(
    async (asset: string) => {
      const trimmed = asset.trim();
      if (!trimmed || busy) return;

      push({ kind: "cmd", text: `scan ${trimmed}` });
      push({ kind: "out", text: `> resolving & scanning ${trimmed}…`, tone: "dim" });
      setBusy(true);
      setInput("");
      setCopied(false);

      // Shareable deep link.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("asset", trimmed);
        window.history.replaceState(null, "", url.toString());
      } catch {}

      try {
        const res = await fetch(`/api/analyze?asset=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!res.ok) {
          push({
            kind: "out",
            text: `! ${data.error ?? "request failed"}: ${
              Array.isArray(data.details) ? data.details.join(", ") : data.details ?? ""
            }`,
            tone: "red",
          });
        } else {
          push({ kind: "result", data });
        }
      } catch {
        push({ kind: "out", text: "! network error — endpoint unreachable", tone: "red" });
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy]
  );

  // Deep link: auto-run ?asset= on first load.
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    try {
      const a = new URLSearchParams(window.location.search).get("asset");
      if (a) run(a);
    } catch {}
  }, [run]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <main
      className="min-h-dvh w-full flex flex-col items-center px-4 py-6 sm:py-10"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="w-full max-w-3xl flex flex-col gap-4">
        <pre className="flicker text-[10px] leading-[1.15] sm:text-xs text-[var(--term-fg)] overflow-x-auto">
          {BANNER.join("\n")}
        </pre>

        <div
          ref={scrollRef}
          className="border border-[var(--term-dim)] rounded-sm p-3 sm:p-4 h-[58vh] overflow-y-auto text-sm leading-relaxed"
        >
          {lines.map((line, i) => {
            if (line.kind === "cmd") {
              return (
                <div key={i} className="whitespace-pre-wrap break-words">
                  <span className="text-[var(--term-muted)]">sentinel@orion:~$ </span>
                  <span>{line.text}</span>
                </div>
              );
            }
            if (line.kind === "out") {
              return (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-words ${toneClass(line.tone)}`}
                >
                  {line.text}
                </div>
              );
            }
            return <ResultBlock key={i} data={line.data} />;
          })}
          {busy && (
            <div className="text-[var(--term-muted)]">
              working<span className="blink">▊</span>
            </div>
          )}
        </div>

        {/* Example chips */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-[var(--term-muted)] py-1">try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => run(ex)}
              className="border border-[var(--term-dim)] px-2 py-1 rounded-sm text-[var(--term-fg)] hover:bg-[var(--term-dim)] hover:text-[var(--term-bg)] transition-colors disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
          <button
            type="button"
            onClick={copyLink}
            className="ml-auto border border-[var(--term-dim)] px-2 py-1 rounded-sm text-[var(--term-cyan)] hover:bg-[var(--term-dim)] hover:text-[var(--term-bg)] transition-colors"
          >
            {copied ? "link copied ✓" : "copy share link"}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className="flex items-center gap-2 border border-[var(--term-dim)] rounded-sm px-3 py-2"
        >
          <span className="text-[var(--term-muted)]">sentinel@orion:~$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="scan <asset>"
            className="flex-1 bg-transparent outline-none text-[var(--term-fg)] placeholder:text-[var(--term-muted)] disabled:opacity-50"
          />
          <span className="blink text-[var(--term-fg)]">▊</span>
        </form>
      </div>
    </main>
  );
}

function fmtUsd(n?: number): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}
function fmtPct(n?: number): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function RiskMeter({ score, level }: { score: number; level: AnalyzeResult["riskLevel"] }) {
  const segments = 20;
  const filled = Math.round((score / 100) * segments);
  const color =
    level === "low"
      ? "var(--term-fg)"
      : level === "high"
      ? "var(--term-red)"
      : "var(--term-amber)";
  return (
    <span className="font-mono">
      <span style={{ color }}>{"█".repeat(filled)}</span>
      <span className="text-[var(--term-muted)]">{"░".repeat(segments - filled)}</span>{" "}
      <span style={{ color }}>{score}/100</span>
    </span>
  );
}

function useTypewriter(text: string, speed = 8) {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return out;
}

function ResultBlock({ data }: { data: AnalyzeResult }) {
  const typed = useTypewriter(data.summary);
  const price = fmtUsd(data.data.priceUsd);
  const chg = fmtPct(data.data.change24hPct);
  const label = data.resolved.name
    ? `${data.resolved.name}${data.resolved.symbol ? ` (${data.resolved.symbol})` : ""}`
    : data.asset;

  return (
    <div className="my-2 border-l-2 border-[var(--term-dim)] pl-3">
      <div className="text-[var(--term-cyan)]">── VERDICT: {label} ──</div>

      {(price || chg) && (
        <div className="mt-1">
          {price && (
            <>
              <span className="text-[var(--term-muted)]">price </span>
              <span>{price}</span>
            </>
          )}
          {chg && (
            <>
              <span className="text-[var(--term-muted)]"> 24h </span>
              <span className={changeTone(data.data.change24hPct)}>{chg}</span>
            </>
          )}
        </div>
      )}

      <div className="mt-1">
        <span className="text-[var(--term-muted)]">sentiment </span>
        <span className={sentimentTone(data.sentiment)}>[{data.sentiment.toUpperCase()}]</span>
        <span className="text-[var(--term-muted)]">   confidence </span>
        <span>[{data.confidence.toUpperCase()}]</span>
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="text-[var(--term-muted)]">risk </span>
        <span className={riskTone(data.riskLevel)}>[{data.riskLevel.toUpperCase()}]</span>
        <RiskMeter score={data.riskScore} level={data.riskLevel} />
      </div>

      <div className="mt-2 whitespace-pre-wrap break-words">
        {typed}
        {typed.length < data.summary.length && <span className="blink">▊</span>}
      </div>

      {data.keyMetrics.length > 0 && (
        <div className="mt-2">
          <div className="text-[var(--term-muted)]">metrics:</div>
          {data.keyMetrics.map((m, i) => (
            <div key={i} className="break-words">
              <span className="text-[var(--term-muted)]">  · {m.label}: </span>
              <span>{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {data.signals.length > 0 && (
        <div className="mt-2">
          <div className="text-[var(--term-muted)]">signals:</div>
          {data.signals.map((s, i) => (
            <div key={i} className="break-words">
              <span className="text-[var(--term-amber)]">  ▸ </span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-[var(--term-muted)] text-xs break-words">
        sources: {data.dataSources.length ? data.dataSources.join(", ") : "model knowledge only"}{" "}
        · {data.model} · {new Date(data.generatedAt).toLocaleString()}
      </div>
      <div className="text-[var(--term-muted)] text-xs">{data.disclaimer}</div>
    </div>
  );
}
