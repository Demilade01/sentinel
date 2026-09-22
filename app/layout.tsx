import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "SENTINEL — DeFi Risk & Market Analyst Agent",
  description:
    "A public, stateless, read-only AI agent that scans a token, protocol, or wallet and returns Groq-analyzed sentiment, risk, and key signals as structured JSON. Informational only, not financial advice.",
  openGraph: {
    title: "SENTINEL — DeFi Risk & Market Analyst Agent",
    description:
      "Scan any DeFi asset for sentiment, risk, and key signals. Structured JSON from one public endpoint.",
    type: "website",
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
