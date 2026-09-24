import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { gatherMarketData, fmtUsd, fmtPct, type MarketData } from "@/lib/market-data";
import { computeRiskModel, type RiskModel } from "@/lib/risk";

// Dynamic per-asset Open Graph card, styled as a casino "poker card": the
// deterministic risk score is the card's rank, the risk band is its suit/colour,
// and the risk meter is the odds bar. Deterministic (no LLM) so a shared
// /?asset=X link previews a real verdict. Deep-linked from generateMetadata.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };
const BG = "#050806";
const FELT = "#0c2417";
const CARD = "#0a1d12";
const FG = "#33ff66";
const AMBER = "#ffb642";
const RED = "#ff5c5c";
const CYAN = "#5cf2ff";
const MUTED = "#5f7a67";
const DIM = "#16351f";
const BRIGHT = "#eafff0";
const GOLD = "#d4af37";

function levelColor(level: "low" | "medium" | "high"): string {
  return level === "low" ? FG : level === "high" ? RED : AMBER;
}
function scoreLevel(score: number): "low" | "medium" | "high" {
  return score <= 33 ? "low" : score <= 66 ? "medium" : "high";
}

const CHIP_LABEL: Record<string, string> = {
  liquidity: "LIQ",
  volatility: "VOL",
  size: "SIZE",
  contract: "SAFETY",
  concentration: "CONC",
};

// A drawn suit "pip" — a rotated square (diamond). No unicode glyph, so it never
// triggers a dynamic-font fetch (the earlier ◈ bug).
function Pip({ size, color }: { size: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        background: color,
        borderRadius: 2,
        transform: "rotate(45deg)",
      }}
    />
  );
}

// Corner rank + pip like a playing-card index; bottom-right is flipped 180°.
function CornerBadge({ score, color, flip }: { score?: number; color: string; flip?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        ...(flip ? { bottom: 44, right: 50 } : { top: 44, left: 50 }),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        ...(flip ? { transform: "rotate(180deg)" } : {}),
      }}
    >
      {score != null && (
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color, lineHeight: 1 }}>
          {score}
        </div>
      )}
      <div style={{ display: "flex", marginTop: score != null ? 8 : 0 }}>
        <Pip size={score != null ? 20 : 26} color={color} />
      </div>
    </div>
  );
}

// Poker-chip: nested circles, ring tinted by factor severity.
function Chip({ keyName, label, score }: { keyName: string; label: string; score: number }) {
  const c = levelColor(scoreLevel(score));
  const code = CHIP_LABEL[keyName] ?? label.slice(0, 4).toUpperCase();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 74,
          height: 74,
          borderRadius: 999,
          background: c,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 58,
            height: 58,
            borderRadius: 999,
            background: CARD,
          }}
        >
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: c }}>{score}</div>
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 8, letterSpacing: 1 }}>
        {code}
      </div>
    </div>
  );
}

// The "odds" meter — a segmented felt bar.
function OddsBar({ score, color }: { score: number; color: string }) {
  const segs = 20;
  const filled = Math.max(0, Math.min(segs, Math.round((score / 100) * segs)));
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: segs }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: 18,
            height: 16,
            borderRadius: 2,
            background: i < filled ? color : "#0f2416",
          }}
        />
      ))}
    </div>
  );
}

// Drawn 30d sparkline (bars, not glyphs).
function MiniSpark({ values, up }: { values: number[]; up: boolean }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const color = up ? FG : RED;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: 6,
            height: 6 + ((v - min) / range) * 34,
            marginRight: 2,
            borderRadius: 1,
            background: color,
          }}
        />
      ))}
    </div>
  );
}

// Felt table + gold-framed card shared by every card. Renders the header
// wordmark and two corner indices (rank+pip when scored, else a gold pip).
function CardFrame({
  children,
  corner,
}: {
  children: ReactElement | ReactElement[];
  corner?: { score: number; color: string };
}) {
  const badgeColor = corner ? corner.color : GOLD;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 28,
        background: `linear-gradient(135deg, ${BG} 0%, ${FELT} 52%, ${BG} 100%)`,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          background: CARD,
          borderRadius: 28,
          border: `2px solid ${GOLD}`,
          boxShadow: "inset 0 0 90px rgba(0,0,0,0.55)",
          padding: 44,
        }}
      >
        <CornerBadge score={corner?.score} color={badgeColor} />
        <CornerBadge score={corner?.score} color={badgeColor} flip />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                width: 24,
                height: 24,
                background: FG,
                borderRadius: 5,
                marginRight: 16,
                transform: "rotate(45deg)",
              }}
            />
            <div
              style={{ display: "flex", fontSize: 34, fontWeight: 700, color: FG, letterSpacing: 5 }}
            >
              SENTINEL
            </div>
          </div>
          <div
            style={{ display: "flex", fontSize: 17, color: MUTED, letterSpacing: 3, marginTop: 8 }}
          >
            DeFi RISK &amp; MARKET ANALYST
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function VerdictCard({ raw, market, risk }: { raw: string; market: MarketData; risk: RiskModel }) {
  const symbol = market.symbol || raw.toUpperCase();
  const name = market.resolvedName || "";
  const price = fmtUsd(market.priceUsd);
  const chg = market.change24hPct;
  const chgStr = fmtPct(chg);
  const col = levelColor(risk.riskLevel);
  const sources = market.dataSources.length ? market.dataSources.join("  ·  ") : "model knowledge only";
  const top = [...risk.factors].sort((a, b) => b.score - a.score).slice(0, 3);
  const spark = market.spark && market.spark.length > 1 ? market.spark : null;
  const sparkUp = spark ? spark[spark.length - 1] >= spark[0] : true;

  return (
    <CardFrame corner={{ score: risk.riskScore, color: col }}>
      <div style={{ display: "flex", flexGrow: 1, marginTop: 20, paddingLeft: 34, paddingRight: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 124, fontWeight: 700, color: BRIGHT, lineHeight: 1 }}>
            {symbol}
          </div>
          {name ? (
            <div style={{ display: "flex", fontSize: 30, color: MUTED, marginTop: 8 }}>{name}</div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 24 }}>
            <div style={{ display: "flex", fontSize: 46, color: BRIGHT }}>{price ?? "price n/a"}</div>
            {chgStr ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 27,
                  color: chg != null && chg >= 0 ? FG : RED,
                  paddingBottom: 6,
                  marginLeft: 18,
                }}
              >
                {chgStr} 24h
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>
          {spark ? (
            <div style={{ display: "flex", marginTop: 22 }}>
              <MiniSpark values={spark} up={sparkUp} />
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 460, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 24, color: GOLD, letterSpacing: 5 }}>THE ODDS</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
            <div style={{ display: "flex", fontSize: 28, color: MUTED, marginRight: 14, letterSpacing: 2 }}>
              RISK
            </div>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 700, color: col }}>
              {risk.riskScore}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: MUTED, paddingBottom: 8, marginLeft: 4 }}>
              /100
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: col,
                border: `2px solid ${col}`,
                borderRadius: 6,
                padding: "5px 14px",
                marginLeft: 16,
                letterSpacing: 2,
              }}
            >
              {risk.riskLevel.toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 16 }}>
            <OddsBar score={risk.riskScore} color={col} />
          </div>
          {top.length > 0 ? (
            <div style={{ display: "flex", marginTop: 28 }}>
              {top.map((f) => (
                <Chip key={f.key} keyName={f.key} label={f.label} score={f.score} />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
        <div style={{ display: "flex", fontSize: 18, color: CYAN }}>sources: {sources}</div>
        <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 6 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </CardFrame>
  );
}

function DefaultCard() {
  const chips = ["ETH", "SOL", "AAVE", "uniswap", "0x..."];
  return (
    <CardFrame>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: BRIGHT }}>
          DeFi risk &amp; market analyst
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: MUTED,
            marginTop: 18,
            maxWidth: 900,
            textAlign: "center",
          }}
        >
          Deal any token, protocol, or wallet: a data-grounded risk score, key metrics, and signals
          from one public, stateless, read-only endpoint.
        </div>
        <div style={{ display: "flex", marginTop: 34 }}>
          {chips.map((e) => (
            <div
              key={e}
              style={{
                display: "flex",
                fontSize: 22,
                color: FG,
                border: `1px solid ${DIM}`,
                borderRadius: 999,
                padding: "8px 18px",
                marginRight: 12,
              }}
            >
              {e}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 6 }}>
        <div style={{ display: "flex", fontSize: 19, color: CYAN }}>CoinGecko · DeFiLlama · GoPlus</div>
        <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 6 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </CardFrame>
  );
}

function CompareCard({ assets }: { assets: string[] }) {
  const n = assets.length;
  const mid = (n - 1) / 2;
  return (
    <CardFrame>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          color: GOLD,
          letterSpacing: 5,
          marginTop: 14,
          alignSelf: "center",
        }}
      >
        COMPARE · THE TABLE
      </div>
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {assets.map((a, i) => {
            const rot = Math.round((i - mid) * 7);
            const sym = a.length > 6 ? a.slice(0, 5).toUpperCase() : a.toUpperCase();
            return (
              <div
                key={a}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: 148,
                  height: 208,
                  marginLeft: i === 0 ? 0 : -12,
                  marginRight: -12,
                  padding: 16,
                  background: CARD,
                  border: `2px solid ${GOLD}`,
                  borderRadius: 14,
                  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
                  transform: `rotate(${rot}deg)`,
                }}
              >
                <div style={{ display: "flex", alignSelf: "flex-start" }}>
                  <Pip size={16} color={GOLD} />
                </div>
                <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: BRIGHT }}>
                  {sym}
                </div>
                <div style={{ display: "flex", alignSelf: "flex-end", transform: "rotate(180deg)" }}>
                  <Pip size={16} color={GOLD} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 24,
          color: MUTED,
          alignSelf: "center",
          textAlign: "center",
          maxWidth: 920,
          marginBottom: 6,
        }}
      >
        Ranked safest → riskiest by a deterministic multi-factor risk model over live market data.
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 19, color: CYAN }}>CoinGecko · DeFiLlama · GoPlus</div>
        <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 6 }}>
          Informational analysis only, not financial advice.
        </div>
      </div>
    </CardFrame>
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
