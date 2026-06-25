# Tracer — Price Checker

A sleek, minimalist **price-history checker** built as an installable PWA.
Type any product and see a year of price movement at a glance, plus a clear
verdict on whether now is a good time to buy.

![Tracer icon](icons/icon-192.png)

## Features

- **Search any item** — instant price overview for whatever you type.
- **One year of history** in a smooth, interactive chart (3M / 6M / 1Y).
- **Buy / Fair / Wait verdict** based on where today's price sits in the range.
- **Key stats** — yearly low, yearly high, average, and % off the peak.
- **Next-sale hint** — points you to the next likely seasonal price drop.
- **Apple-inspired design** — black · orange · gray · white, light & dark themes.
- **Fully responsive** — built for phone and desktop alike.
- **Installable PWA** — works offline, add to home screen, runs full-screen.

## Run it

It's a static site — no build step, no dependencies. Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

## Live price data

To keep the app self-contained and demoable offline, price history is produced
by a deterministic model (`getPriceHistory()` in [`js/app.js`](js/app.js)) — the
same query always returns the same history. To show **live** prices, replace
that one function with a `fetch()` to a retail price API; the rest of the UI is
agnostic to where the data comes from, as long as it returns
`{ series: [{ t, price }], category, base }`.

## Project layout

```
index.html              app shell
css/styles.css          design system + responsive layout
js/app.js               data model, stats, SVG chart, interactions, PWA glue
service-worker.js       offline app-shell caching
manifest.webmanifest    PWA manifest
icons/                  generated app icons
scripts/make_icons.py   regenerate icons (pure-stdlib PNG encoder)
```
