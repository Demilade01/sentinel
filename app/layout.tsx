import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

// Absolute base for OG/Twitter image URLs. Vercel sets these at build/runtime;
// falls back to localhost for local dev.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "SENTINEL — DeFi Risk & Market Analyst Agent",
  description:
    "A public, stateless, read-only AI agent that scans a token, protocol, or wallet and returns Groq-analyzed sentiment, risk, and key signals as structured JSON. Informational only, not financial advice.",
  openGraph: {
    title: "SENTINEL — DeFi Risk & Market Analyst Agent",
    description:
      "Scan any DeFi asset for sentiment, risk, and key signals. Structured JSON from one public endpoint.",
    type: "website",
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SENTINEL — DeFi Risk & Market Analyst Agent",
    description:
      "Scan any DeFi asset for sentiment, risk, and key signals. Structured JSON from one public endpoint.",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceMono.variable}>
      <body className="crt">{children}</body>
    </html>
  );
}
