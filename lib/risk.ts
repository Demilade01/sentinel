// Deterministic, explainable risk model. Given the live market data Sentinel
// fetched, it computes named risk factors (0-100, higher = riskier) and a
// weighted overall score. This is computed in code (not by the LLM) so the
// risk number is reproducible and auditable.

import type { MarketData } from "@/lib/market-data";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskFactor {
  key: string;
  label: string;
  score: number; // 0-100, higher = riskier
  weight: number;
  note: string;
}

export interface RiskModel {
  riskScore: number; // 0-100 weighted
  riskLevel: RiskLevel;
  factors: RiskFactor[];
}

function bucket(value: number, thresholds: [number, number][], fallback: number): number {
  // thresholds: sorted ascending by cutoff; returns score for first cutoff the
  // value is >= to. Used for "bigger is safer" metrics.
  for (const [cutoff, score] of thresholds) {
    if (value >= cutoff) return score;
  }
  return fallback;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score <= 33) return "low";
  if (score <= 66) return "medium";
  return "high";
}

export function computeRiskModel(d: MarketData): RiskModel {
  const factors: RiskFactor[] = [];

  // --- Liquidity: 24h volume relative to market cap (turnover) ---
  if (d.vol24hUsd != null && d.marketCapUsd) {
    const r = d.vol24hUsd / d.marketCapUsd;
    const score = bucket(
      r,
      [
        [0.08, 15],
        [0.03, 30],
        [0.01, 45],
        [0.003, 60],
        [0.001, 75],
      ],
      90
    );
    factors.push({
      key: "liquidity",
      label: "Liquidity",
      score,
      weight: 0.25,
      note: `24h turnover ${(r * 100).toFixed(2)}% of market cap`,
    });
  } else if (d.vol24hUsd != null) {
    const score = d.vol24hUsd >= 1e7 ? 40 : d.vol24hUsd >= 1e6 ? 60 : 85;
    factors.push({
      key: "liquidity",
      label: "Liquidity",
      score,
      weight: 0.25,
      note: `24h volume only (no market cap)`,
    });
  }

  // --- Volatility: 30d daily return stdev ---
  if (d.volatility30dPct != null) {
    const v = d.volatility30dPct;
    const score = v < 2 ? 15 : v < 4 ? 30 : v < 7 ? 50 : v < 12 ? 70 : 90;
    factors.push({
      key: "volatility",
      label: "Volatility",
      score,
      weight: 0.2,
      note: `${v.toFixed(2)}%/day (30d)`,
    });
  }

  // --- Size / maturity: market cap (fallback to rank) ---
  if (d.marketCapUsd != null) {
    const m = d.marketCapUsd;
    const score = bucket(
      m,
      [
        [1e10, 10],
        [1e9, 25],
        [2.5e8, 40],
        [5e7, 60],
        [1e7, 78],
      ],
      92
    );
    factors.push({
      key: "size",
      label: "Size / maturity",
      score,
      weight: 0.2,
      note: `market cap ${abbr(m)}`,
    });
  } else if (d.marketCapRank != null) {
    const rk = d.marketCapRank;
    const score = rk <= 10 ? 10 : rk <= 50 ? 25 : rk <= 150 ? 40 : rk <= 400 ? 60 : rk <= 1000 ? 78 : 88;
    factors.push({
      key: "size",
      label: "Size / maturity",
      score,
      weight: 0.2,
      note: `market cap rank #${rk}`,
    });
  }

  // --- Contract safety (GoPlus) ---
  const s = d.security;
  if (s) {
    let score = 15;
    const flags: string[] = [];
    if (s.isHoneypot) {
      score += 60;
      flags.push("honeypot");
    }
    if (s.isOpenSource === false) {
      score += 25;
      flags.push("closed-source");
    }
    if ((s.sellTaxPct ?? 0) > 10) {
      score += 25;
      flags.push(`sell tax ${s.sellTaxPct?.toFixed(0)}%`);
    } else if ((s.sellTaxPct ?? 0) > 3) {
      score += 12;
      flags.push(`sell tax ${s.sellTaxPct?.toFixed(0)}%`);
    }
    if ((s.buyTaxPct ?? 0) > 10) {
      score += 15;
      flags.push(`buy tax ${s.buyTaxPct?.toFixed(0)}%`);
    }
    if (s.isMintable) {
      score += 18;
      flags.push("mintable");
    }
    if (s.canTakeBackOwnership) {
      score += 22;
      flags.push("owner can reclaim");
    }
    if (s.hiddenOwner) {
      score += 22;
      flags.push("hidden owner");
    }
    if (s.cannotSellAll) {
      score += 25;
      flags.push("can't sell all");
    }
    if (s.isProxy) {
      score += 10;
      flags.push("proxy (upgradeable)");
    }
    score = Math.min(100, score);
    factors.push({
      key: "contract",
      label: "Contract safety",
      score,
      weight: 0.2,
      note: flags.length ? flags.join(", ") : "no major flags detected",
    });
  } else if (d.contractAddress == null && d.resolvedVia === "symbol/name") {
    // Native asset with no contract to audit — treat as low structural risk.
    factors.push({
      key: "contract",
      label: "Contract safety",
      score: 12,
      weight: 0.15,
      note: "native asset, no token contract to exploit",
    });
  }

  // --- Concentration (GoPlus holders) ---
  if (s && (s.holderCount != null || s.creatorPercent != null || s.lpHolderCount != null)) {
    let score = 30;
    const notes: string[] = [];
    if (s.holderCount != null) {
      if (s.holderCount < 500) {
        score += 30;
        notes.push(`${s.holderCount} holders (low)`);
      } else if (s.holderCount < 5000) {
        score += 12;
        notes.push(`${s.holderCount} holders`);
      } else {
        score -= 10;
        notes.push(`${s.holderCount} holders`);
      }
    }
    if ((s.creatorPercent ?? 0) > 0.2) {
      score += 30;
      notes.push(`creator holds ${(s.creatorPercent! * 100).toFixed(0)}%`);
    } else if ((s.creatorPercent ?? 0) > 0.05) {
      score += 15;
      notes.push(`creator holds ${(s.creatorPercent! * 100).toFixed(0)}%`);
    }
    if (s.lpHolderCount != null && s.lpHolderCount < 20) {
      score += 15;
      notes.push(`${s.lpHolderCount} LP holders`);
    }
    score = Math.max(0, Math.min(100, score));
    factors.push({
      key: "concentration",
      label: "Concentration",
      score,
      weight: 0.15,
      note: notes.join(", ") || "holder distribution",
    });
  }

  // --- Weighted overall (renormalize over available factors) ---
  if (factors.length === 0) {
    return { riskScore: 60, riskLevel: "medium", factors: [] };
  }
  const totalW = factors.reduce((a, f) => a + f.weight, 0);
  const riskScore = Math.round(
    factors.reduce((a, f) => a + f.score * f.weight, 0) / totalW
  );
  return { riskScore, riskLevel: riskLevelFromScore(riskScore), factors };
}

function abbr(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}
