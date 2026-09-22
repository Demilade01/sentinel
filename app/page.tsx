"use client";

import { useEffect, useRef, useState } from "react";

interface KeyMetric {
  label: string;
  value: string;
}

interface AnalyzeResult {
  asset: string;
  summary: string;
  sentiment: "bullish" | "neutral" | "bearish";
  riskLevel: "low" | "medium" | "high";
  keyMetrics: KeyMetric[];
  signals: string[];
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

export default function Home() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "SENTINEL v1 // DeFi risk & market analyst", tone: "cyan" },
    {
      kind: "out",
      text: "public · stateless · read-only · informational only",
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, busy]);

  const push = (l: Line) => setLines((prev) => [...prev, l]);

  async function run(asset: string) {
    const trimmed = asset.trim();
    if (!trimmed || busy) return;

    push({ kind: "cmd", text: `scan ${trimmed}` });
    push({ kind: "out", text: `> scanning ${trimmed}…`, tone: "dim" });
    setBusy(true);
    setInput("");

    try {
      const res = await fetch(
        `/api/analyze?asset=${encodeURIComponent(trimmed)}`
      );
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
  }

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
          className="border border-[var(--term-dim)] rounded-sm p-3 sm:p-4 h-[62vh] overflow-y-auto text-sm leading-relaxed"
        >
          {lines.map((line, i) => {
            if (line.kind === "cmd") {
              return (
                <div key={i} className="whitespace-pre-wrap break-words">
                  <span className="text-[var(--term-muted)]">sentinel@orion</span>
                  <span className="text-[var(--term-muted)]">:~$ </span>
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

        <p className="text-[var(--term-muted)] text-xs">
          Endpoint:{" "}
          <span className="text-[var(--term-cyan)]">GET /api/analyze?asset=ETH</span>{" "}
          · returns structured JSON · not financial advice.
        </p>
      </div>
    </main>
  );
}

function ResultBlock({ data }: { data: AnalyzeResult }) {
  return (
    <div className="my-2 border-l-2 border-[var(--term-dim)] pl-3">
      <div className="text-[var(--term-cyan)]">── VERDICT: {data.asset} ──</div>
      <div className="mt-1">
        <span className="text-[var(--term-muted)]">sentiment </span>
        <span className={sentimentTone(data.sentiment)}>
          [{data.sentiment.toUpperCase()}]
        </span>
        <span className="text-[var(--term-muted)]">   risk </span>
        <span className={riskTone(data.riskLevel)}>
          [{data.riskLevel.toUpperCase()}]
        </span>
      </div>

      <div className="mt-2 whitespace-pre-wrap break-words">{data.summary}</div>

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

      <div className="mt-2 text-[var(--term-muted)] text-xs">
        {data.model} · {new Date(data.generatedAt).toLocaleString()} ·{" "}
        {data.disclaimer}
      </div>
    </div>
  );
}
