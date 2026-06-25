# Tracer — Price Checker

A sleek, minimalist **price-history checker** built as an installable PWA.
Search any product — or paste a product link — and see a year of price
movement at a glance, a deal score, a buy/wait verdict, a forecast of the next
likely sale, and a side-by-side comparison across retailers.

![Tracer icon](icons/icon-192.png)

## Features

- **Search or paste a link** — type an item, or drop in an Amazon / Walmart /
  Best Buy / Target / eBay product URL and Tracer extracts the item.
- **A year of history** in a smooth, interactive chart (3M / 6M / 1Y) with
  hover tooltips and a low/high marker.
- **Deal score (0–100)** — an at-a-glance gauge for how good today's price is.
- **Smart verdict + forecast** — "buy now" vs "wait", with the next likely sale
  (e.g. Prime Day, Black Friday), its expected price, and your potential savings
  drawn as a dashed projection on the chart.
- **Compare retailers** — indicative prices across stores with the cheapest
  flagged and working buy links.
- **Trending feed** — live deal scores on popular items, refreshed daily.
- **Share & export** — share a deep link, download the history as CSV, or save a
  branded PNG of the chart.
- **Apple-inspired design** — black · orange · gray · white, light & dark themes.
- **Installable PWA** — works offline, add to home screen, runs full-screen.
- **Fully responsive** — built for phone and desktop alike.

## Run it

It's a static site — no build step, no dependencies. Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

## Live price data

Out of the box, Tracer uses a deterministic estimate model so it's fully
functional and demoable offline — the same query always returns the same
history. To switch to **live** prices, edit [`js/config.js`](js/config.js):

```js
export const CONFIG = {
  apiBase: "https://your-price-api.example.com", // GET /history?q=<query>
  apiKey:  "optional-bearer-token",
  // ...
};
```

The API should return JSON shaped like:

```json
{ "series": [{ "t": 1719273600000, "price": 249.0 }], "category": "Audio" }
```

`getPriceData()` in [`js/providers.js`](js/providers.js) calls the API when
`apiBase` is set and transparently falls back to the estimate model on any
error, so the app never breaks.

## Architecture

Plain ES modules — no bundler, no framework. Each module has one job:

```
index.html              app shell
css/styles.css          design system + responsive layout
js/config.js            single place to configure live API + retailers
js/util.js              formatting, hashing, seeded RNG
js/model.js             deterministic price-history model + sale calendar
js/providers.js         live-API-or-model data seam (Feature 1)
js/retailers.js         URL lookup (Feature 4) + price comparison (Feature 5)
js/insights.js          stats, deal score (7), forecast + verdict (6)
js/chart.js             SVG chart (shared by live view + PNG export), sparklines
js/exporters.js         share + CSV + PNG export (Feature 8)
js/app.js               UI orchestration, deal feed, routing, PWA glue
service-worker.js       offline app-shell caching
manifest.webmanifest    PWA manifest
icons/                  generated app icons
scripts/make_icons.py   regenerate icons (pure-stdlib PNG encoder)
scripts/smoke.mjs       Playwright smoke test (npm i -D playwright to run)
```

## Verifying

```bash
npm i -D playwright
python3 -m http.server 8137 &
node scripts/smoke.mjs
```

Drives a real headless Chromium across themes and devices, exercises search,
URL paste, range toggles, exports, and the deal feed, and fails on any console
error.
