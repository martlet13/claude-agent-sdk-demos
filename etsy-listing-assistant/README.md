# Etsy Listing Assistant

A **local** Claude Agent SDK demo: generate listing copy and promo frames on the seller’s computer, package them, then create an Etsy **draft** via the seller’s own Open API app.

This is sample code for local development. It is not a hosted SaaS and should not be deployed as a multi-tenant service.

## What it does

| Step | Behavior |
| ---- | -------- |
| **Generate** | Uses the seller’s Anthropic / Claude API key (official API, not a scraped web session) to write title, description, tags, and image briefs |
| **Package** | Saves a listing pack on disk (images, optional digital files, `manifest.json`) |
| **Publish** | Creates a **draft** listing from this machine with the seller’s Etsy key, secret, and OAuth tokens |

```
Seller PC
  ├─ Claude API (seller’s key)     → copy + image briefs
  ├─ Local pack builder            → ~/.etsy-listing-assistant/packs
  └─ Local Etsy Open API client    → draft listing on the seller’s shop
```

## Design rules (v1)

1. **Your keys only** — the demo does not resell model usage or ship a shared Etsy app.
2. **No vendor Etsy proxy** — every Etsy HTTP call leaves from this process.
3. **Drafts only** — the client never sends `state=active`. You review and activate in Seller Manager.
4. **Secrets stay local** — credentials are encrypted under `~/.etsy-listing-assistant/`.
5. **Templates from your shop** — shipping and policy IDs are cloned from a listing you already own.

## Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)
- An Etsy seller account with a **developer app you created**
- OAuth scopes: `listings_r listings_w shops_r`

## Setup

```bash
cd etsy-listing-assistant
npm install
npm run dev
```

- UI: http://localhost:5173
- Local API: http://127.0.0.1:8787

Or build the UI and run a single process:

```bash
npm run build
npm start
```

Then open http://127.0.0.1:8787.

To walk the UI without live Claude or Etsy credentials (local preview only):

```bash
ETSY_ASSISTANT_OFFLINE=1 ETSY_ASSISTANT_MOCK_ETSY=1 npm run dev
```

That mode never calls Anthropic or Etsy. It seeds a local preview shop so you can click through generate → pack → draft. Do not use it to publish to a real shop.

## First run

1. **Claude** — paste your Anthropic API key in Setup.
2. **Etsy app** — create an app at [Your Apps](https://www.etsy.com/developers/your-apps). Register the redirect URI shown in Setup (default `http://127.0.0.1:8787/api/etsy/oauth/callback`). Etsy may require an exact match, including `http` vs `https`.
3. **OAuth** — click Connect shop and grant access. Tokens stay on disk.
4. **Template** — enter one of **your** listing IDs and clone it (shipping profile, readiness, return policy, who/when made).
5. **Generate** — pick a generic preset (wall art, digital download, custom product), optionally attach reference photos, run a theme, edit copy, exclude/reorder images, and open the pack folder.
6. **Create draft** — choose template, shop section, taxonomy, price. Open the draft URL in Seller Manager and activate it yourself. The Open API `createDraftListing` call never sends `state=active`.

Generation is available as soon as a Claude key is saved. Creating a draft still requires Etsy OAuth and at least one template cloned from your shop. Use **Disconnect shop** in Setup to drop tokens and reconnect without re-creating the Etsy app.

## Data on disk

```
~/.etsy-listing-assistant/
  .master.key          # 256-bit key, mode 0600
  credentials.enc      # AES-256-GCM vault (Claude key + Etsy tokens)
  templates.json
  cache/               # shop sections, taxonomy, recent IDs
  packs/<id>/
    manifest.json
    images/
    files/
```

Override the home directory with `ETSY_ASSISTANT_HOME`. Bound long Claude waits with `ETSY_ASSISTANT_GENERATION_TIMEOUT_MS` (default `120000`).

## Tests

```bash
npm test
```

Unit and route tests mock the Etsy HTTP API. They assert that draft create never sends `state=active`.

## Honest limits

- Generation uses the **official Claude API** (preferred by this brief). It does not automate the Claude or ChatGPT website, 2FA, or in-chat image generators.
- Promo frames are rendered locally from model briefs (SVG preview + PNG listing images) so packs always have Etsy-compatible images without scraping image CDNs.
- Claude and Etsy access remain subject to each platform’s terms. UI or API changes can break automation.
- Windows-first desktop installer / Electron packaging is out of scope for this SDK demo; `npm start` is the local app.

## Non-goals

Hosted multi-seller SaaS, vendor-held Etsy tokens, auto-activating listings, Printful/Printify, Canva/Pinterest, or other marketplaces.
