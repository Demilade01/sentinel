import type { Metadata } from "next";
import Terminal from "./terminal";

// Reading searchParams for per-asset OG metadata makes this render at request time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function pickAsset(sp: Awaited<SearchParams>): string | undefined {
  const raw = sp.asset;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value || undefined;
}

// Per-scan Open Graph / Twitter card so a shared /?asset=X link previews the
// actual verdict (rendered by app/api/og). Falls back to the site default.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const asset = pickAsset(await searchParams);
  if (!asset) return {};

  const label = asset.includes(",")
    ? asset
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(", ")
    : asset.toUpperCase();

  const title = `SENTINEL scan — ${label}`;
  const description = `Live DeFi risk & market read on ${label}: a data-grounded risk score, key metrics, and signals. Informational only, not financial advice.`;
  const ogUrl = `/api/og?asset=${encodeURIComponent(asset)}`;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: ogUrl, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [ogUrl] },
  };
}

export default function Page() {
  return <Terminal />;
}
