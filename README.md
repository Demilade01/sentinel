# SENTINEL — DeFi Risk & Market Analyst Agent

A single public, stateless, read-only AI agent for the [Orion Agents](https://orionagents.org/hackathon) launchpad. Give it a token, protocol, or wallet and it returns Groq-analyzed **sentiment**, **risk level**, **key metrics**, and **signals** as clean, structured JSON.

Sentinel is designed to plug straight into Orion's **AI Concierge**: when a user describes a DeFi strategy, the Concierge can call Sentinel to get a fast, sober read on any asset involved — no wallet, no auth, no payment headers.

> **Informational analysis only — not financial advice.** Sentinel never tells anyone to buy, sell, or hold. Every response carries an explicit `disclaimer` field.

## The endpoint

One stable HTTPS endpoint. `GET` for the Concierge and quick checks, `POST` for JSON clients.

```bash
# Analyze an asset
curl "https://<your-deploy>/api/analyze?asset=ETH"

# With an optional question
curl "https://<your-deploy>/api/analyze?asset=aave&question=how%20concentrated%20is%20liquidity"

# POST with JSON
curl -X POST "https://<your-deploy>/api/analyze" \
  -H "Content-Type: application/json" \
  -d '{"asset":"ETH"}'

# Self-documenting: no params returns the usage + schema
curl "https://<your-deploy>/api/analyze"
```

### Response schema

```json
{
  "asset": "ETH",
  "summary": "...",
  "sentiment": "bullish | neutral | bearish",
  "riskLevel": "low | medium | high",
  "keyMetrics": [{ "label": "...", "value": "..." }],
  "signals": ["..."],
  "disclaimer": "Informational analysis only, not financial advice.",
  "model": "llama-3.3-70b-versatile",
  "generatedAt": "<iso-8601>"
}
```

### Contract & behavior

- **Public, stateless, read-only.** No auth, no session, no payment headers. Nothing is stored between requests.
- **CORS open** (`Access-Control-Allow-Origin: *`) so the Concierge or any browser client can call it directly.
- **Always valid JSON.** If the model returns prose, Sentinel falls back to keeping that text as the `summary` and fills the enums with safe defaults (`neutral` / `medium`) rather than erroring.
- **Graceful errors.** `400` on invalid input (with which field failed), `502` on an upstream/config failure — never a stack trace and never a secret.
- **No secrets in the URL or output.** `GROQ_API_KEY` lives server-side only.

## Live demo

The landing page (`/`) is a terminal UI: type an asset, watch `> scanning <asset>…`, and read the verdict printed as a monospace readout with sentiment/risk color-coded. It calls the same public `/api/analyze` endpoint you'd register with Orion, so a visitor sees the agent work live.

## Run locally

```bash
npm install
echo "GROQ_API_KEY=your_key_here" > .env.local   # get one at https://console.groq.com/keys
npm run dev
```

Then open http://localhost:3000 and try the terminal, or hit the endpoint directly:

```bash
curl "http://localhost:3000/api/analyze?asset=ETH"
```

## How it works

- **Model:** Groq `llama-3.3-70b-versatile`, low temperature, JSON-enforced output.
- **Framing:** a DeFi analyst system prompt scoped to *informational* sentiment/risk analysis, which keeps Orion's automated vetting score high and the risk level low.
- **Stack:** Next.js App Router route handler (`app/api/analyze/route.ts`) + a terminal demo page (`app/page.tsx`). Deploys to Vercel as one project — no database.

## Deploy

1. Push to GitHub, import into Vercel.
2. Set `GROQ_API_KEY` in the Vercel project's Environment Variables.
3. Deploy. Register the resulting `/api/analyze` URL as your Orion **Endpoint URL** and the site root as the demo link.

## License

MIT.
