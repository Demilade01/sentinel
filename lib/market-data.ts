// Live, keyless DeFi market data for Sentinel.
// Sources: CoinGecko (price, market cap, volume, 24h change, 30d history,
// token resolution + contract), DeFiLlama (protocol TVL), GoPlus (token
// security). No API keys — public endpoints only.

export interface TokenSecurity {
  isOpenSource?: boolean;
  isHoneypot?: boolean;
  buyTaxPct?: number;
  sellTaxPct?: number;
  isProxy?: boolean;
  isMintable?: boolean;
  canTakeBackOwnership?: boolean;
  hiddenOwner?: boolean;
  cannotSellAll?: boolean;
  holderCount?: number;
  lpHolderCount?: number;
  creatorPercent?: number;
  isInDex?: boolean;
}

export interface MarketData {
  resolvedName?: string;
  symbol?: string;
  iconUrl?: string;
  coingeckoId?: string;
  contractAddress?: string;
  marketCapRank?: number;
  priceUsd?: number;
  marketCapUsd?: number;
  vol24hUsd?: number;
  change24hPct?: number;
  change7dPct?: number;
  change30dPct?: number;
  volatility30dPct?: number;
  spark?: number[];
  tvlUsd?: number;
  security?: TokenSecurity;
  dataSources: string[];
  resolvedVia: "symbol/name" | "evm-address" | "unresolved";
}

const CG = "https://api.coingecko.com/api/v3";
const LLAMA = "https://api.llama.fi";
const COINS = "https://coins.llama.fi";
const GOPLUS = "https://api.gopluslabs.io/api/v1";

// Per-instance TTL cache: runtime memoization to cut repeat upstream calls
// and dodge rate limits. NOT durable storage — the endpoint stays stateless.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 60_000;

async function fetchJson<T>(
  url: string,
  { timeoutMs = 6000, retries = 1, headers }: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {}
): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json", ...headers },
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
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}
const toBool = (v: unknown) => (v == null ? undefined : String(v) === "1");
const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ---- CoinGecko / DeFiLlama / GoPlus response shapes (partial) ----
interface CgSearch {
  coins?: {
    id: string;
    name: string;
    symbol: string;
    market_cap_rank: number | null;
    thumb?: string;
    large?: string;
  }[];
}
type CgPrice = Record<
  string,
  { usd?: number; usd_market_cap?: number; usd_24h_vol?: number; usd_24h_change?: number }
>;
interface CgCoin {
  platforms?: Record<string, string>;
}
interface CgChart {
  prices?: [number, number][];
}
interface LlamaCoins {
  coins?: Record<string, { price?: number; symbol?: string }>;
}
interface GoPlusResp {
  result?: Record<string, Record<string, unknown>>;
}

function historyFromPrices(prices: [number, number][]): {
  change7dPct?: number;
  change30dPct?: number;
  volatility30dPct?: number;
  spark?: number[];
} {
  const series = prices.map((p) => p[1]).filter((n) => Number.isFinite(n) && n > 0);
  if (series.length < 3) return {};
  const last = series[series.length - 1];
  const first = series[0];
  const wk = series[Math.max(0, series.length - 8)];
  const change30dPct = ((last - first) / first) * 100;
  const change7dPct = ((last - wk) / wk) * 100;
  // Daily log-ish returns stdev as a volatility proxy (%).
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) rets.push((series[i] - series[i - 1]) / series[i - 1]);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const volatility30dPct = Math.sqrt(variance) * 100;
  // Downsample to ~24 points for a sparkline.
  const step = Math.max(1, Math.floor(series.length / 24));
  const spark = series.filter((_, i) => i % step === 0);
  return { change7dPct, change30dPct, volatility30dPct, spark };
}

async function fetchSecurity(address: string): Promise<TokenSecurity | undefined> {
  const resp = await fetchJson<GoPlusResp>(
    `${GOPLUS}/token_security/1?contract_addresses=${address.toLowerCase()}`,
    { headers: { "User-Agent": "Mozilla/5.0 (Sentinel Agent)" }, timeoutMs: 7000 }
  );
  const t = resp?.result?.[address.toLowerCase()];
  if (!t) return undefined;
  return {
    isOpenSource: toBool(t.is_open_source),
    isHoneypot: toBool(t.is_honeypot),
    buyTaxPct: toNum(t.buy_tax) != null ? (toNum(t.buy_tax) as number) * 100 : undefined,
    sellTaxPct: toNum(t.sell_tax) != null ? (toNum(t.sell_tax) as number) * 100 : undefined,
    isProxy: toBool(t.is_proxy),
    isMintable: toBool(t.is_mintable),
    canTakeBackOwnership: toBool(t.can_take_back_ownership),
    hiddenOwner: toBool(t.hidden_owner),
    cannotSellAll: toBool(t.cannot_sell_all),
    holderCount: toNum(t.holder_count),
    lpHolderCount: toNum(t.lp_holder_count),
    creatorPercent: toNum(t.creator_percent),
    isInDex: toBool(t.is_in_dex),
  };
}

export async function gatherMarketData(asset: string): Promise<MarketData> {
  const dataSources = new Set<string>();

  // ---- EVM contract address path ----
  if (isEvmAddress(asset)) {
    const addr = asset.toLowerCase();
    const key = `ethereum:${addr}`;
    const [coins, security] = await Promise.all([
      fetchJson<LlamaCoins>(`${COINS}/prices/current/${key}`),
      fetchSecurity(addr),
    ]);
    const entry = coins?.coins?.[key];
    if (entry?.price) dataSources.add("DeFiLlama");
    if (security) dataSources.add("GoPlus");
    return {
      symbol: entry?.symbol,
      contractAddress: addr,
      priceUsd: entry?.price,
      security,
      dataSources: [...dataSources],
      resolvedVia: entry?.price || security ? "evm-address" : "unresolved",
    };
  }

  // ---- Symbol / name / protocol path ----
  const search = await fetchJson<CgSearch>(`${CG}/search?query=${encodeURIComponent(asset)}`);
  const coin = search?.coins?.[0];

  const id = coin?.id;
  const [price, coinDetail, chart, tvl] = await Promise.all([
    id
      ? fetchJson<CgPrice>(
          `${CG}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
        )
      : Promise.resolve(null),
    id
      ? fetchJson<CgCoin>(
          `${CG}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`
        )
      : Promise.resolve(null),
    id
      ? fetchJson<CgChart>(
          `${CG}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=30&interval=daily`
        )
      : Promise.resolve(null),
    resolveTvl(coin?.name, asset),
  ]);

  const p = id && price ? price[id] : undefined;
  if (p) dataSources.add("CoinGecko");
  if (tvl != null) dataSources.add("DeFiLlama");

  const hist = chart?.prices ? historyFromPrices(chart.prices) : {};
  if (chart?.prices?.length) dataSources.add("CoinGecko");

  const contractAddress = coinDetail?.platforms?.ethereum || undefined;
  let security: TokenSecurity | undefined;
  if (contractAddress && isEvmAddress(contractAddress)) {
    security = await fetchSecurity(contractAddress);
    if (security) dataSources.add("GoPlus");
  }

  return {
    resolvedName: coin?.name,
    symbol: coin?.symbol?.toUpperCase(),
    iconUrl: coin?.large || coin?.thumb,
    coingeckoId: id,
    contractAddress,
    marketCapRank: coin?.market_cap_rank ?? undefined,
    priceUsd: p?.usd,
    marketCapUsd: p?.usd_market_cap,
    vol24hUsd: p?.usd_24h_vol,
    change24hPct: p?.usd_24h_change,
    change7dPct: hist.change7dPct,
    change30dPct: hist.change30dPct,
    volatility30dPct: hist.volatility30dPct,
    spark: hist.spark,
    tvlUsd: tvl ?? undefined,
    security,
    dataSources: [...dataSources],
    resolvedVia: dataSources.size ? "symbol/name" : "unresolved",
  };
}

async function resolveTvl(name: string | undefined, asset: string): Promise<number | null> {
  const candidates = Array.from(
    new Set([name ? slugify(name) : "", slugify(asset)].filter(Boolean))
  );
  for (const slug of candidates) {
    const tvl = await fetchTvl(slug);
    if (tvl) return tvl;
  }
  return null;
}

// ---- Formatting helpers ----
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
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// Real-data context block for the model + seeded keyMetrics we always return.
export function marketDataContext(d: MarketData): {
  contextLines: string[];
  seededMetrics: { label: string; value: string }[];
} {
  const seededMetrics: { label: string; value: string }[] = [];
  const contextLines: string[] = [];
  const add = (label: string, value?: string, ctx?: string) => {
    if (!value) return;
    seededMetrics.push({ label, value });
    contextLines.push(ctx ?? `${label.toLowerCase()}: ${value}`);
  };

  add("Price (USD)", fmtUsd(d.priceUsd), `price: ${fmtUsd(d.priceUsd)}`);
  add("24h Change", fmtPct(d.change24hPct));
  add("7d Change", fmtPct(d.change7dPct));
  add("30d Change", fmtPct(d.change30dPct));
  if (d.volatility30dPct != null)
    add("30d Volatility", `${d.volatility30dPct.toFixed(2)}%/day`);
  add("Market Cap", fmtUsd(d.marketCapUsd));
  if (d.marketCapRank) add("Market Cap Rank", `#${d.marketCapRank}`);
  add("24h Volume", fmtUsd(d.vol24hUsd));
  add("Protocol TVL", fmtUsd(d.tvlUsd));

  const s = d.security;
  if (s) {
    if (s.isHoneypot != null)
      contextLines.push(`honeypot: ${s.isHoneypot ? "YES (danger)" : "no"}`);
    if (s.buyTaxPct != null || s.sellTaxPct != null)
      contextLines.push(`taxes: buy ${s.buyTaxPct ?? "?"}% / sell ${s.sellTaxPct ?? "?"}%`);
    if (s.isOpenSource != null)
      contextLines.push(`contract open-source: ${s.isOpenSource ? "yes" : "no"}`);
    if (s.holderCount != null) contextLines.push(`holders: ${s.holderCount}`);
    if (s.lpHolderCount != null) contextLines.push(`LP holders: ${s.lpHolderCount}`);
  }

  return { contextLines, seededMetrics };
}
