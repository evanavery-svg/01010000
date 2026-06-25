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

## Sample data vs. live prices — read this

By default Tracer shows **sample data**: a deterministic estimate model, not
real prices. The same query always returns the same history, so the app is fully
demoable offline. This is labelled everywhere it appears — a **Sample data**
badge and a banner on every result — so demo figures are never mistaken for
real ones.

### Turning on real prices

A static web page **cannot** call retail price APIs directly: they block browser
(CORS) requests, and an API key in front-end code would be exposed. So Tracer
talks to a tiny proxy you run. There's a ready-to-deploy, free one in
[`proxy/`](proxy/) (a Cloudflare Worker) — see [proxy/README.md](proxy/README.md).

1. Get a free key (e.g. RapidAPI "Real-Time Product Search" — works with a
   Gmail address).
2. `wrangler deploy` the worker with your key as a secret.
3. Point Tracer at it — no rebuild needed:
   - `…/index.html?api=https://your-worker.workers.dev`, or
   - `localStorage.setItem("tracer-api-base", "https://…")`, or
   - set `apiBase` in [`js/config.js`](js/config.js).

The worker returns the **real current price**. Tracer shows it as the headline
(green **● Live price** badge) and anchors the trend line to it — the chart is
still an estimate and says so. A genuine year-long history needs a paid
historical API (e.g. Keepa); the provider seam in
[`js/providers.js`](js/providers.js) accepts that shape too:

```json
{ "series": [{ "t": 1719273600000, "price": 249.0 }], "category": "Audio" }
```

`getPriceData()` calls the proxy when a source is configured and transparently
falls back to the sample model on any error, so the app never breaks.

You can verify the whole live path locally without deploying anything:

```bash
node scripts/mock-proxy.mjs 8787
# open: http://localhost:8137/index.html?api=http://localhost:8787
```

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
proxy/                  deployable Cloudflare Worker for real prices + setup
scripts/make_icons.py   regenerate icons (pure-stdlib PNG encoder)
scripts/mock-proxy.mjs  local stand-in for the price proxy (for testing)
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
