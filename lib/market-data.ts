// Live, keyless DeFi market data for Sentinel.
// Sources: CoinGecko (price / market cap / volume / 24h change, token resolution)
// and DeFiLlama (protocol TVL). No API keys, public endpoints only.

export interface MarketData {
  resolvedName?: string;
  symbol?: string;
  coingeckoId?: string;
  marketCapRank?: number;
  priceUsd?: number;
  marketCapUsd?: number;
  vol24hUsd?: number;
  change24hPct?: number;
  tvlUsd?: number;
  dataSources: string[];
  resolvedVia: "symbol/name" | "evm-address" | "unresolved";
}

const CG = "https://api.coingecko.com/api/v3";
const LLAMA = "https://api.llama.fi";
const COINS = "https://coins.llama.fi";

// Small in-memory TTL cache. This is per-instance runtime memoization to cut
// repeat upstream calls and dodge rate limits — NOT durable storage. The
// endpoint stays stateless and read-only from the caller's perspective.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 60_000;

async function fetchJson<T>(
  url: string,
  { timeoutMs = 6000, retries = 1 } = {}
): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status === 429 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        return null;
      }
      const value = (await res.json()) as T;
      cache.set(url, { at: Date.now(), value });
      return value;
    } catch {
      clearTimeout(timer);
      if (attempt >= retries) return null;
    }
  }
  return null;
}

async function fetchTvl(slug: string): Promise<number | null> {
  const url = `${LLAMA}/tvl/${encodeURIComponent(slug)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as number | null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    const num = Number(text);
    const value = Number.isFinite(num) && num > 0 ? num : null;
    cache.set(url, { at: Date.now(), value });
    return value;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

interface CgSearch {
  coins?: {
    id: string;
    name: string;
    symbol: string;
    market_cap_rank: number | null;
  }[];
}
type CgPrice = Record<
  string,
  {
    usd?: number;
    usd_market_cap?: number;
    usd_24h_vol?: number;
    usd_24h_change?: number;
  }
>;
interface LlamaCoins {
  coins?: Record<string, { price?: number; symbol?: string }>;
}

export async function gatherMarketData(asset: string): Promise<MarketData> {
  const dataSources: string[] = [];

  // ---- EVM contract address path: price via DeFiLlama coins ----
  if (isEvmAddress(asset)) {
    const key = `ethereum:${asset.toLowerCase()}`;
    const coins = await fetchJson<LlamaCoins>(
      `${COINS}/prices/current/${key}`
    );
    const entry = coins?.coins?.[key];
    if (entry?.price) dataSources.push("DeFiLlama");
    return {
      symbol: entry?.symbol,
      priceUsd: entry?.price,
      tvlUsd: undefined,
      dataSources,
      resolvedVia: entry?.price ? "evm-address" : "unresolved",
    };
  }

  // ---- Symbol / name / protocol path ----
  const search = await fetchJson<CgSearch>(
    `${CG}/search?query=${encodeURIComponent(asset)}`
  );
  const coin = search?.coins?.[0];

  let priceUsd: number | undefined;
  let marketCapUsd: number | undefined;
  let vol24hUsd: number | undefined;
  let change24hPct: number | undefined;

  if (coin?.id) {
    const price = await fetchJson<CgPrice>(
      `${CG}/simple/price?ids=${encodeURIComponent(
        coin.id
      )}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
    );
    const p = price?.[coin.id];
    if (p) {
      priceUsd = p.usd;
      marketCapUsd = p.usd_market_cap;
      vol24hUsd = p.usd_24h_vol;
      change24hPct = p.usd_24h_change;
      dataSources.push("CoinGecko");
    }
  }

  // TVL: try the coin name and the raw asset as DeFiLlama protocol slugs.
  const candidates = Array.from(
    new Set([coin?.name ? slugify(coin.name) : "", slugify(asset)].filter(Boolean))
  );
  let tvlUsd: number | undefined;
  for (const slug of candidates) {
    const tvl = await fetchTvl(slug);
    if (tvl) {
      tvlUsd = tvl;
      dataSources.push("DeFiLlama");
      break;
    }
  }

  return {
    resolvedName: coin?.name,
    symbol: coin?.symbol?.toUpperCase(),
    coingeckoId: coin?.id,
    marketCapRank: coin?.market_cap_rank ?? undefined,
    priceUsd,
    marketCapUsd,
    vol24hUsd,
    change24hPct,
    tvlUsd,
    dataSources: Array.from(new Set(dataSources)),
    resolvedVia: dataSources.length ? "symbol/name" : "unresolved",
  };
}

// ---- Formatting helpers (shared by the prompt context) ----
export function fmtUsd(n?: number): string | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

export function fmtPct(n?: number): string | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// Build the real-data context block fed to the model, plus the seeded
// keyMetrics we return regardless of what the model produces.
export function marketDataContext(d: MarketData): {
  contextLines: string[];
  seededMetrics: { label: string; value: string }[];
} {
  const seededMetrics: { label: string; value: string }[] = [];
  const contextLines: string[] = [];

  const price = fmtUsd(d.priceUsd);
  const mcap = fmtUsd(d.marketCapUsd);
  const vol = fmtUsd(d.vol24hUsd);
  const chg = fmtPct(d.change24hPct);
  const tvl = fmtUsd(d.tvlUsd);

  if (price) {
    seededMetrics.push({ label: "Price (USD)", value: price });
    contextLines.push(`price: ${price}`);
  }
  if (chg) {
    seededMetrics.push({ label: "24h Change", value: chg });
    contextLines.push(`24h change: ${chg}`);
  }
  if (mcap) {
    seededMetrics.push({ label: "Market Cap", value: mcap });
    contextLines.push(`market cap: ${mcap}`);
  }
  if (d.marketCapRank) {
    seededMetrics.push({ label: "Market Cap Rank", value: `#${d.marketCapRank}` });
    contextLines.push(`market cap rank: #${d.marketCapRank}`);
  }
  if (vol) {
    seededMetrics.push({ label: "24h Volume", value: vol });
    contextLines.push(`24h volume: ${vol}`);
  }
  if (tvl) {
    seededMetrics.push({ label: "Protocol TVL", value: tvl });
    contextLines.push(`protocol TVL: ${tvl}`);
  }

  return { contextLines, seededMetrics };
}
