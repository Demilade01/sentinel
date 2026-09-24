import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { gatherMarketData, fmtUsd, fmtPct, type MarketData } from "@/lib/market-data";
import { computeRiskModel, type RiskModel } from "@/lib/risk";

// Dynamic per-asset Open Graph card. Deterministic (no LLM): renders the live
// price, computed risk score, and top risk factors so shared /?asset=X links
// preview a real verdict. Deep-linked from the page's generateMetadata.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };
const BG = "#050806";
const FG = "#33ff66";
const AMBER = "#ffb642";
const RED = "#ff5c5c";
const CYAN = "#5cf2ff";
const MUTED = "#5f7a67";
const PANEL = "#0c1a11";
const DIM = "#16351f";
const BRIGHT = "#eafff0";

function levelColor(level: "low" | "medium" | "high"): string {
  return level === "low" ? FG : level === "high" ? RED : AMBER;
}
function scoreLevel(score: number): "low" | "medium" | "high" {
  return score <= 33 ? "low" : score <= 66 ? "medium" : "high";
}

function RiskBar({ score, color }: { score: number; color: string }) {
  const segs = 24;
  const filled = Math.max(0, Math.min(segs, Math.round((score / 100) * segs)));
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {Array.from({ length: segs }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 34,
            height: 24,
            borderRadius: 3,
            background: i < filled ? color : "#0f2416",
          }}
        />
      ))}
    </div>
  );
}
function Shell({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: BG,
        color: FG,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: FG, letterSpacing: 4 }}>
          ◈ SENTINEL
        </div>
        <div style={{ display: "flex", fontSize: 22, color: MUTED, letterSpacing: 2 }}>
          DeFi RISK &amp; MARKET ANALYST
        </div>
      </div>
      {children}
    </div>
  );
}
function VerdictCard({ raw, market, risk }: { raw: string; market: MarketData; risk: RiskModel }) {
  const name = market.resolvedName || raw.toUpperCase();
  const sym = market.symbol ? ` (${market.symbol})` : "";
  const price = fmtUsd(market.priceUsd);
  const chg = market.change24hPct;
  const chgStr = fmtPct(chg);
  const col = levelColor(risk.riskLevel);
  const sources = market.dataSources.length ? market.dataSources.join("  ·  ") : "model knowledge only";
  const top = [...risk.factors].sort((a, b) => b.score - a.score).slice(0, 3);

  return (
    <Shell>
      <div style={{ display: "flex", marginTop: 44, fontSize: 68, fontWeight: 700, color: BRIGHT }}>
        {name}
        {sym}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 14 }}>
        <div style={{ display: "flex", fontSize: 56, color: BRIGHT }}>{price ?? "price n/a"}</div>
        {chgStr ? (
          <div
            style={{
              display: "flex",
              fontSize: 34,
              color: chg != null && chg >= 0 ? FG : RED,
              paddingBottom: 6,
              marginLeft: 24,
            }}
          >
            {chgStr} 24h
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, color: MUTED, letterSpacing: 3, marginRight: 20 }}>RISK</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: col }}>{risk.riskScore}</div>
          <div style={{ display: "flex", fontSize: 30, color: MUTED, paddingBottom: 8, marginLeft: 6 }}>/100</div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: col,
              border: `2px solid ${col}`,
              borderRadius: 6,
              padding: "6px 18px",
              marginLeft: 22,
              letterSpacing: 2,
            }}
          >
            {risk.riskLevel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 20 }}>
          <RiskBar score={risk.riskScore} color={col} />
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 34 }}>
        {top.map((f) => {
          const fc = levelColor(scoreLevel(f.score));
          return (
            <div
              key={f.key}
              style={{
                display: "flex",
                flexDirection: "column",
                background: PANEL,
                border: `1px solid ${DIM}`,
                borderRadius: 10,
                padding: "16px 22px",
                marginRight: 16,
              }}
            >
              <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{f.label}</div>
              <div style={{ display: "flex", fontSize: 34, color: fc, marginTop: 4 }}>{f.score}/100</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div style={{ display: "flex", fontSize: 20, color: CYAN }}>sources: {sources}</div>
        <div style={{ display: "flex", fontSize: 18, color: MUTED, marginTop: 8 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </Shell>
  );
}
function DefaultCard() {
  return (
    <Shell>
      <div style={{ display: "flex", marginTop: 60, fontSize: 60, fontWeight: 700, color: BRIGHT }}>
        DeFi risk &amp; market analyst
      </div>
      <div style={{ display: "flex", marginTop: 20, fontSize: 30, color: MUTED, maxWidth: 960 }}>
        Scan any token, protocol, or wallet for a data-grounded risk score, key metrics, and signals — from
        one public, stateless, read-only endpoint.
      </div>
      <div style={{ display: "flex", marginTop: 40 }}>
        {["ETH", "SOL", "AAVE", "uniswap", "0x…"].map((e) => (
          <div
            key={e}
            style={{
              display: "flex",
              fontSize: 24,
              color: FG,
              border: `1px solid ${DIM}`,
              borderRadius: 6,
              padding: "8px 18px",
              marginRight: 14,
            }}
          >
            {e}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div style={{ display: "flex", fontSize: 20, color: CYAN }}>CoinGecko · DeFiLlama · GoPlus</div>
        <div style={{ display: "flex", fontSize: 18, color: MUTED, marginTop: 8 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </Shell>
  );
}

function CompareCard({ assets }: { assets: string[] }) {
  return (
    <Shell>
      <div style={{ display: "flex", marginTop: 50, fontSize: 30, color: AMBER, letterSpacing: 3 }}>
        COMPARE MODE
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 22 }}>
        {assets.map((a) => (
          <div
            key={a}
            style={{
              display: "flex",
              fontSize: 46,
              fontWeight: 700,
              color: BRIGHT,
              marginRight: 28,
              marginBottom: 12,
            }}
          >
            {a.toUpperCase()}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 28, color: MUTED, maxWidth: 980 }}>
        Ranked safest → riskiest by a deterministic multi-factor risk model over live market data.
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div style={{ display: "flex", fontSize: 20, color: CYAN }}>CoinGecko · DeFiLlama · GoPlus</div>
        <div style={{ display: "flex", fontSize: 18, color: MUTED, marginTop: 8 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </Shell>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("asset") || "").trim();
  let card: ReactElement;
  try {
    if (!raw) {
      card = <DefaultCard />;
    } else {
      const assets = Array.from(
        new Set(raw.split(",").map((a) => a.trim()).filter(Boolean))
      ).slice(0, 5);
      if (assets.length > 1) {
        card = <CompareCard assets={assets} />;
      } else {
        const target = assets[0] ?? raw;
        const market = await gatherMarketData(target);
        card = <VerdictCard raw={target} market={market} risk={computeRiskModel(market)} />;
      }
    }
  } catch {
    card = <DefaultCard />;
  }

  return new ImageResponse(card, {
    ...SIZE,
    headers: { "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
  });
}
