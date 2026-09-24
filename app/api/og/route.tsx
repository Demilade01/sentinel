import { ImageResponse } from "next/og";
import type { CSSProperties, ReactElement } from "react";
import { gatherMarketData, fmtUsd, fmtPct, type MarketData } from "@/lib/market-data";
import { computeRiskModel, type RiskModel, type RiskFactor } from "@/lib/risk";

/* eslint-disable @next/next/no-img-element */

// Dynamic per-asset Open Graph card, styled as a sci-fi "COMPARE THE MARKET" HUD:
// a shield-eye SENTINEL emblem, corner crosshair brackets, and portrait asset
// cards fanned like a heads-up display — each with a token logo, an SVG sparkline,
// a risk band pill, factor bars, and a rank. Deterministic (no LLM) so a shared
// /?asset=X link previews a real, ranked verdict. Deep-linked from generateMetadata.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

// ---- palette (terminal green-on-black + gold trim + risk semantics) ----
const BG = "#050806";
const BG2 = "#0a1f12";
const FG = "#33ff66";
const AMBER = "#ffb642";
const RED = "#ff5c5c";
const CYAN = "#5cf2ff";
const MUTED = "#5f7a67";
const LINE = "#1c3a27";
const BRIGHT = "#eafff0";
const GOLD = "#d4af37";
const TRACK = "#0f2416";
const BRACKET = "rgba(51,255,102,0.42)";

function levelColor(level: "low" | "medium" | "high"): string {
  return level === "low" ? FG : level === "high" ? RED : AMBER;
}
function scoreLevel(score: number): "low" | "medium" | "high" {
  return score <= 33 ? "low" : score <= 66 ? "medium" : "high";
}
const glowFor = (level: "low" | "medium" | "high"): string =>
  level === "low"
    ? "rgba(51,255,102,0.20)"
    : level === "high"
    ? "rgba(255,92,92,0.20)"
    : "rgba(255,182,66,0.20)";

interface AssetResult {
  raw: string;
  market: MarketData;
  risk: RiskModel;
  icon: string | null;
  rank: number;
}

// A drawn suit "pip" — a rotated square (diamond). No glyph → no font fetch.
function Pip({ size, color }: { size: number; color: string }) {
  return (
    <div
      style={{ display: "flex", width: size, height: size, background: color, borderRadius: 2, transform: "rotate(45deg)" }}
    />
  );
}

// Signal-strength bars (drawn) for the RANK footer.
function SignalBars({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end" }}>
      {[7, 11, 15, 19].map((h, i) => (
        <div key={i} style={{ display: "flex", width: 4, height: h, marginRight: 3, borderRadius: 1, background: color }} />
      ))}
    </div>
  );
}

// SENTINEL emblem: a shield with a watchful eye, drawn as inline SVG (no glyph).
function ShieldEye({ size = 40, color = FG }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path d="M24 3 L42 10 L42 24 C42 36 34 43 24 46 C14 43 6 36 6 24 L6 10 Z" stroke={color} strokeWidth={2.5} fill="rgba(51,255,102,0.06)" />
      <path d="M11 24 C16 16.5 32 16.5 37 24 C32 31.5 16 31.5 11 24 Z" stroke={color} strokeWidth={2} fill="none" />
      <circle cx="24" cy="24" r="5.6" stroke={color} strokeWidth={2} fill="none" />
      <circle cx="24" cy="24" r="2.3" fill={color} />
    </svg>
  );
}

// L-shaped crosshair bracket in one of the four frame corners (two borders).
function CornerBracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const s = 26;
  const b = `2px solid ${BRACKET}`;
  const st: CSSProperties = { position: "absolute", display: "flex", width: s, height: s };
  if (pos === "tl") { st.top = 22; st.left = 22; st.borderTop = b; st.borderLeft = b; }
  if (pos === "tr") { st.top = 22; st.right = 22; st.borderTop = b; st.borderRight = b; }
  if (pos === "bl") { st.bottom = 22; st.left = 22; st.borderBottom = b; st.borderLeft = b; }
  if (pos === "br") { st.bottom = 22; st.right = 22; st.borderBottom = b; st.borderRight = b; }
  return <div style={st} />;
}

// Frame chrome shared by every card: felt gradient bg, 4 corner crosshair
// brackets, decorative coordinates (top-right) and the disclaimer (bottom-right).
function HudFrame({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${BG} 0%, ${BG2} 55%, ${BG} 100%)`,
        fontFamily: "sans-serif",
      }}
    >
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />
      <div style={{ position: "absolute", top: 30, right: 56, display: "flex", fontSize: 15, color: MUTED, letterSpacing: 2 }}>
        40.7128° N / 74.0060° W
      </div>
      <div style={{ position: "absolute", bottom: 30, right: 56, display: "flex", fontSize: 14, color: MUTED }}>
        Informational analysis only, not financial advice.
      </div>
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", padding: 40 }}>
        {children}
      </div>
    </div>
  );
}

// Shield emblem + SENTINEL wordmark + agent subtitle (top-left of each card).
function Brand({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <ShieldEye size={40 * scale} />
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 14 }}>
        <div style={{ display: "flex", fontSize: 30 * scale, fontWeight: 700, color: FG, letterSpacing: 5 }}>SENTINEL</div>
        <div style={{ display: "flex", fontSize: 12 * scale, color: MUTED, letterSpacing: 3, marginTop: 2 }}>DeFi RISK &amp; MARKET ANALYST AGENT</div>
      </div>
    </div>
  );
}

function DataSources({ sources }: { sources: string[] }) {
  const line = sources.length ? sources.join("  ·  ") : "CoinGecko · DeFiLlama · GoPlus";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 13, color: MUTED, letterSpacing: 4 }}>DATA SOURCES</div>
      <div style={{ display: "flex", fontSize: 18, color: CYAN, marginTop: 6 }}>{line}</div>
    </div>
  );
}

// SVG sparkline: faint area fill under a polyline of the 30d price series.
function Sparkline({ values, color, w, h }: { values: number[]; color: string; w: number; h: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const line = values
    .map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Real CoinGecko logo (pre-resolved to a data URI) or a drawn initial badge.
function TokenIcon({ icon, symbol, color, size }: { icon: string | null; symbol: string; color: string; size: number }) {
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" style={{ borderRadius: 999, border: `2px solid ${color}` }} />;
  }
  const letter = (symbol || "?").slice(0, 1).toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 999, border: `2px solid ${color}`, background: "rgba(51,255,102,0.05)" }}>
      <div style={{ display: "flex", fontSize: size * 0.42, fontWeight: 700, color }}>{letter}</div>
    </div>
  );
}

// One factor row: label + mini-bar (tinted by risk) + 0–100 score.
function FactorRow({ label, score, trackW, labelW = 86 }: { label: string; score: number | null; trackW: number; labelW?: number }) {
  const c = score != null ? levelColor(scoreLevel(score)) : MUTED;
  const fill = score != null ? Math.max(3, Math.round((score / 100) * trackW)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: 9 }}>
      <div style={{ display: "flex", fontSize: 12, color: MUTED, letterSpacing: 1, width: labelW }}>{label}</div>
      <div style={{ display: "flex", width: trackW, height: 6, background: TRACK, borderRadius: 3 }}>
        <div style={{ display: "flex", width: fill, height: 6, background: c, borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", fontSize: 14, fontWeight: 700, color: c, width: 30, marginLeft: 8, justifyContent: "flex-end" }}>
        {score != null ? score : "–"}
      </div>
    </div>
  );
}

// Portrait asset card for the compare fan: pip + logo header, symbol/name,
// sparkline, RISK pill + score, three factor bars, and a RANK footer.
function AssetCard({ r, cardW, cardH, elevated }: { r: AssetResult; cardW: number; cardH: number; elevated?: boolean }) {
  const { market, risk, icon, rank } = r;
  const c = levelColor(risk.riskLevel);
  const symbol = (market.symbol || r.raw).toUpperCase().slice(0, 6);
  const name = (market.resolvedName || "").toUpperCase().slice(0, 18);
  const spark = market.spark && market.spark.length > 1 ? market.spark : null;
  const sparkUp = spark ? spark[spark.length - 1] >= spark[0] : true;
  const pad = 16;
  const innerW = cardW - pad * 2;
  const trackW = innerW - 86 - 30 - 8;
  const byKey = (k: string): RiskFactor | undefined => risk.factors.find((f) => f.key === k);
  const rows: { label: string; f?: RiskFactor }[] = [
    { label: "LIQUIDITY", f: byKey("liquidity") },
    { label: "VOLATILITY", f: byKey("volatility") },
    { label: "MARKET CAP", f: byKey("size") },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: cardW,
        height: cardH,
        padding: pad,
        background: "linear-gradient(180deg, #0b2015 0%, #071109 100%)",
        border: `2px solid ${elevated ? GOLD : LINE}`,
        borderRadius: 14,
        boxShadow: elevated
          ? `0 20px 44px rgba(0,0,0,0.6), 0 0 34px ${glowFor(risk.riskLevel)}`
          : "0 12px 26px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Pip size={14} color={GOLD} />
        <TokenIcon icon={icon} symbol={symbol} color={c} size={42} />
      </div>
      <div style={{ display: "flex", fontSize: cardW < 200 ? 30 : 34, fontWeight: 700, color: BRIGHT, marginTop: 10 }}>{symbol}</div>
      <div style={{ display: "flex", fontSize: 12, color: MUTED, letterSpacing: 1, height: 16 }}>{name}</div>
      <div style={{ display: "flex", marginTop: 10 }}>
        {spark ? <Sparkline values={spark} color={sparkUp ? FG : RED} w={innerW} h={38} /> : <div style={{ display: "flex", height: 38 }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <div style={{ display: "flex", fontSize: 13, color: MUTED, letterSpacing: 2 }}>RISK</div>
        <div style={{ display: "flex", fontSize: 13, color: c, border: `1px solid ${c}`, borderRadius: 5, padding: "2px 8px", letterSpacing: 1 }}>{risk.riskLevel.toUpperCase()}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 2 }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: c }}>{risk.riskScore}</div>
        <div style={{ display: "flex", fontSize: 15, color: MUTED, marginLeft: 3, paddingBottom: 5 }}>/100</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
        {rows.map((row) => (
          <FactorRow key={row.label} label={row.label} score={row.f ? row.f.score : null} trackW={trackW} />
        ))}
      </div>
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <SignalBars color={c} />
          <div style={{ display: "flex", fontSize: 16, fontWeight: 700, color: c, marginLeft: 8, letterSpacing: 1 }}>RANK #{rank}</div>
        </div>
        <Pip size={10} color={c} />
      </div>
    </div>
  );
}

// The reference layout: headline column on the left, up to 5 asset cards fanned
// (median elevated, gold) on the right. `results` arrive pre-ranked safest→riskiest.
function CompareCard({ results }: { results: AssetResult[] }) {
  const n = results.length;
  const mid = (n - 1) / 2;
  const cardW = n <= 3 ? 208 : n === 4 ? 190 : 176;
  const cardH = n <= 3 ? 340 : 322;
  const spread = n <= 3 ? 122 : n === 4 ? 116 : 106;
  const cx = 325;
  const cy = 252;
  const sources = Array.from(new Set(results.flatMap((r) => r.market.dataSources)));
  const nodes = results.map((r, i) => {
    const off = i - mid;
    const elevated = i === Math.round(mid);
    const left = Math.round(cx - cardW / 2 + off * spread);
    const top = Math.round(cy - cardH / 2 + Math.abs(off) * 20 - (elevated ? 26 : 0));
    const rot = off * (n <= 3 ? 6 : 4);
    return {
      dist: Math.abs(off),
      node: (
        <div key={r.raw} style={{ position: "absolute", left, top, display: "flex", transform: `rotate(${rot}deg)` }}>
          <AssetCard r={r} cardW={cardW} cardH={cardH} elevated={elevated} />
        </div>
      ),
    };
  });
  nodes.sort((a, b) => b.dist - a.dist); // paint center card last → on top
  return (
    <HudFrame>
      <div style={{ display: "flex", flexDirection: "column", width: 470, height: "100%" }}>
        <Brand />
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: FG }}>COMPARE</div>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: BRIGHT }}>THE MARKET</div>
        <div style={{ display: "flex", width: 60, height: 4, background: GOLD, marginTop: 18, marginBottom: 18 }} />
        <div style={{ display: "flex", fontSize: 20, color: MUTED, maxWidth: 430 }}>
          Ranked safest → riskiest by a deterministic multi-factor risk model using live market data.
        </div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <DataSources sources={sources} />
      </div>
      <div style={{ position: "relative", display: "flex", flexGrow: 1, height: "100%" }}>
        {nodes.map((x) => x.node)}
      </div>
    </HudFrame>
  );
}

// Single-asset HUD verdict: identity + price + spark on the left, the full risk
// assessment (big score, band pill, meter, every factor) on the right.
function VerdictCard({ r }: { r: AssetResult }) {
  const { market, risk, icon } = r;
  const c = levelColor(risk.riskLevel);
  const symbol = (market.symbol || r.raw).toUpperCase().slice(0, 8);
  const name = market.resolvedName || "";
  const price = fmtUsd(market.priceUsd);
  const chg = market.change24hPct;
  const chgStr = fmtPct(chg);
  const spark = market.spark && market.spark.length > 1 ? market.spark : null;
  const sparkUp = spark ? spark[spark.length - 1] >= spark[0] : true;
  const meterW = 400;
  return (
    <HudFrame>
      <div style={{ display: "flex", flexDirection: "column", width: 600, height: "100%" }}>
        <Brand />
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <TokenIcon icon={icon} symbol={symbol} color={c} size={72} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 20 }}>
            <div style={{ display: "flex", fontSize: 88, fontWeight: 700, color: BRIGHT }}>{symbol}</div>
            {name ? <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{name}</div> : <div style={{ display: "flex" }} />}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 22 }}>
          <div style={{ display: "flex", fontSize: 44, color: BRIGHT }}>{price ?? "price n/a"}</div>
          {chgStr ? (
            <div style={{ display: "flex", fontSize: 24, color: chg != null && chg >= 0 ? FG : RED, marginLeft: 16, paddingBottom: 6 }}>{chgStr} 24h</div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>
        {spark ? (
          <div style={{ display: "flex", marginTop: 22 }}>
            <Sparkline values={spark} color={sparkUp ? FG : RED} w={480} h={80} />
          </div>
        ) : (
          <div style={{ display: "flex", height: 80, marginTop: 22 }} />
        )}
        <div style={{ display: "flex", flexGrow: 1 }} />
        <DataSources sources={market.dataSources} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, height: "100%", justifyContent: "center", paddingLeft: 34 }}>
        <div style={{ display: "flex", fontSize: 22, color: GOLD, letterSpacing: 5 }}>RISK ASSESSMENT</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 12 }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: c }}>{risk.riskScore}</div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED, marginLeft: 6, paddingBottom: 12 }}>/100</div>
          <div style={{ display: "flex", fontSize: 20, color: c, border: `2px solid ${c}`, borderRadius: 6, padding: "5px 14px", marginLeft: 20, marginBottom: 14, letterSpacing: 2 }}>
            {risk.riskLevel.toUpperCase()}
          </div>
        </div>
        <div style={{ display: "flex", width: meterW, height: 8, background: TRACK, borderRadius: 4, marginTop: 16 }}>
          <div style={{ display: "flex", width: Math.round((meterW * risk.riskScore) / 100), height: 8, background: c, borderRadius: 4 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
          {risk.factors.length ? (
            risk.factors.map((f) => (
              <FactorRow key={f.key} label={f.label.toUpperCase()} score={f.score} trackW={200} labelW={158} />
            ))
          ) : (
            <div style={{ display: "flex", fontSize: 16, color: MUTED, maxWidth: meterW }}>
              Limited data resolved — score shown with lowered confidence.
            </div>
          )}
        </div>
      </div>
    </HudFrame>
  );
}

// No-asset fallback: emblem, wordmark, tagline, example chips, sources.
function DefaultCard() {
  const chips = ["ETH", "SOL", "AAVE", "uniswap", "0x..."];
  return (
    <HudFrame>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}>
        <ShieldEye size={92} />
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: FG, letterSpacing: 8, marginTop: 18 }}>SENTINEL</div>
        <div style={{ display: "flex", fontSize: 20, color: MUTED, letterSpacing: 4, marginTop: 8 }}>DeFi RISK &amp; MARKET ANALYST AGENT</div>
        <div style={{ display: "flex", fontSize: 24, color: BRIGHT, marginTop: 30, maxWidth: 880, textAlign: "center" }}>
          A data-grounded risk score, key metrics, and signals for any token, protocol, or wallet — from one public, stateless, read-only endpoint.
        </div>
        <div style={{ display: "flex", marginTop: 30 }}>
          {chips.map((e) => (
            <div key={e} style={{ display: "flex", fontSize: 20, color: FG, border: `1px solid ${LINE}`, borderRadius: 999, padding: "8px 18px", marginRight: 12 }}>{e}</div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 34 }}>
          <DataSources sources={[]} />
        </div>
      </div>
    </HudFrame>
  );
}

// Pre-resolve a remote logo to a base64 data URI ourselves (timeout-guarded) so
// a slow/failed image degrades to a drawn badge instead of failing the whole PNG.
async function iconDataUri(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 250_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function analyzeOne(raw: string): Promise<AssetResult> {
  const market = await gatherMarketData(raw);
  const risk = computeRiskModel(market);
  const icon = await iconDataUri(market.iconUrl);
  return { raw, market, risk, icon, rank: 0 };
}

function fallbackResult(raw: string): AssetResult {
  const market: MarketData = { dataSources: [], resolvedVia: "unresolved" };
  return { raw, market, risk: computeRiskModel(market), icon: null, rank: 0 };
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
        const settled = await Promise.allSettled(assets.map(analyzeOne));
        const results = settled.map((s, i) => (s.status === "fulfilled" ? s.value : fallbackResult(assets[i])));
        const ranked = [...results].sort((a, b) => a.risk.riskScore - b.risk.riskScore);
        ranked.forEach((r, i) => (r.rank = i + 1));
        card = <CompareCard results={ranked} />;
      } else {
        const one = await analyzeOne(assets[0] ?? raw);
        card = <VerdictCard r={one} />;
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
