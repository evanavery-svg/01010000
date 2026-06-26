# Tracer price proxy

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) that gives Tracer
**real prices**. It exists because a static web app can't call retail price APIs
directly — they block browser (CORS) requests, and putting an API key in
front-end code would expose it. This worker keeps your key server-side, calls
the API, and returns a normalized, CORS-enabled response.

```
Browser (Tracer)  ──GET ?q=airpods──►  Worker (holds key)  ──►  Price API
                  ◄──{ current: 249 }──┘
```

## What you need

At minimum, one **price provider** key. You can also enable two optional
**enrichers** (real eBay price + barcode scanning) — each works independently
and degrades gracefully if its key is missing.

### Price providers (pick one — set with `PROVIDER`)

| Provider | `PROVIDER` | Cost | Gmail OK? | Notes |
|---|---|---|---|---|
| **RapidAPI – Real-Time Product Search** | `rapid` (default) | Free tier | ✅ | Recommended. Current prices + image. |
| **SerpApi – Google Shopping** | `serp` | 100/mo free | ✅ | Clean data incl. rating/reviews. |
| **Best Buy Developer API** | `bestbuy` | Free | ❌ (needs work/edu email) | US Best Buy catalog only. |

### Optional enrichers (set the keys to turn on)

| Feature | Keys | Cost | Gmail OK? | What it adds |
|---|---|---|---|---|
| **eBay Browse** | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Free | ✅ | A real eBay market price in *Compare retailers* (tagged **live**). |
| **UPCitemdb barcode** | none (trial) or `UPCDB_KEY` | Free trial | ✅ | Phone-camera barcode scanning → product search. |

The worker returns the **current** price. Tracer shows that real price as the
headline and anchors an *estimated* trend line to it (clearly labelled). For a
real year-long chart you'd need a paid history API like Keepa — see the main
README.

## Deploy (≈5 minutes, free)

```bash
cd proxy
npm install -g wrangler         # or: npx wrangler ...
wrangler login

# RapidAPI route (recommended):
#   1. Sign up at rapidapi.com and subscribe (free) to
#      "Real-Time Product Search"
#   2. Copy your X-RapidAPI-Key, then:
wrangler secret put RAPIDAPI_KEY     # paste the key when prompted

wrangler deploy
```

`wrangler deploy` prints a URL like
`https://tracer-price-proxy.<you>.workers.dev`.

### SerpApi instead

In `wrangler.toml` set `PROVIDER = "serp"`, then:

```bash
wrangler secret put SERPAPI_KEY   # from serpapi.com
wrangler deploy
```

### Best Buy instead

In `wrangler.toml` set `PROVIDER = "bestbuy"`, then:

```bash
wrangler secret put BESTBUY_KEY
wrangler deploy
```

### Add real eBay prices (optional)

Create a free app at [developer.ebay.com](https://developer.ebay.com) and copy
your **Production** App ID (Client ID) and Cert ID (Client Secret):

```bash
wrangler secret put EBAY_CLIENT_ID
wrangler secret put EBAY_CLIENT_SECRET
wrangler deploy
```

eBay's real price then appears in *Compare retailers*, tagged **live**, with a
link to the actual listing. No `PROVIDER` change needed — it runs alongside
whichever price provider you chose.

### Add barcode scanning (optional)

Works out of the box on the free trial (rate-limited). For higher limits, get a
key at [upcitemdb.com](https://www.upcitemdb.com/api) and:

```bash
wrangler secret put UPCDB_KEY
wrangler deploy
```

Then the camera/scan button in the search bar resolves a scanned barcode to a
product and searches it. (On browsers without the camera Barcode API — e.g.
iOS Safari — it falls back to typing the number.)

## Point Tracer at it

Any one of these — no rebuild needed:

- Append to the URL: `…/index.html?api=https://tracer-price-proxy.you.workers.dev`
- In the browser console: `localStorage.setItem("tracer-api-base", "https://…workers.dev")`
- Permanent: set `apiBase` in [`../js/config.js`](../js/config.js)

When a live source is active, Tracer shows a green **● Live price** badge. With
no source, it shows **Sample data** and a banner so demo prices are never
mistaken for real ones.

## Local test

You can verify the whole path without deploying, using the bundled mock:

```bash
node ../scripts/mock-proxy.mjs 8787      # serves normalized JSON + CORS
# then open: http://localhost:8137/index.html?api=http://localhost:8787
```

## Response shape

The worker normalizes upstream data to what Tracer expects:

```json
{ "current": 249.00, "currency": "USD", "category": "Audio", "retailer": "Amazon" }
```

Tracer also accepts full history if your upstream provides it:

```json
{ "series": [{ "t": 1719273600000, "price": 249.0 }], "category": "Audio" }
```

> Upstream APIs change their JSON field names over time. If you get
> `no price in result`, open `worker.js` and adjust the field picks in
> `rapidProductSearch()` to match your provider's current response.
