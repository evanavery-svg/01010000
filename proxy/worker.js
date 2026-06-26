/* ============================================================
   Tracer price proxy — Cloudflare Worker.

   Why this exists: browsers can't call retail price APIs directly
   (CORS), and putting an API key in front-end code exposes it. This
   tiny worker keeps your key server-side, calls the upstream API,
   normalizes the result, and returns it with CORS enabled so the
   Tracer PWA can read it.

   Deploy free on Cloudflare Workers (see proxy/README.md), then point
   Tracer at it:  add ?api=<your-worker-url> to the page, or set
   apiBase in js/config.js.

   Pick the price upstream with the PROVIDER env var:
     "rapid"   (default) — RapidAPI Real-Time Product Search
     "serp"               — SerpApi Google Shopping
     "bestbuy"            — Best Buy Developer API
   Optional enrichers (set their keys to enable; each is best-effort):
     eBay Browse  → adds a real eBay market price to the response
     UPCitemdb    → GET ?barcode=<digits> resolves a product name
   Set the matching keys as secrets (see proxy/README.md).
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const u = new URL(request.url);

    try {
      // ---- Barcode → product name (UPCitemdb) ----
      const barcode = u.searchParams.get("barcode");
      if (barcode) {
        return json(await upcLookup(barcode, env), 200, { "Cache-Control": "public, max-age=86400" });
      }

      const q = u.searchParams.get("q");
      if (!q) return json({ error: "missing q" }, 400);

      const provider = (env.PROVIDER || "rapid").toLowerCase();

      // ?debug=1 returns the raw upstream product (no cache) for field mapping.
      if (u.searchParams.get("debug") && provider === "rapid") {
        return json(await rapidRaw(q, env), 200, { "Cache-Control": "no-store" });
      }

      // Primary price + best-effort eBay market price, in parallel.
      const [data, ebay] = await Promise.all([
        primaryPrice(q, provider, env),
        ebayPrice(q, env).catch(() => null),
      ]);
      if (ebay) data.ebay = ebay;

      // cache at the edge for an hour to stay inside free tiers
      return json(data, 200, { "Cache-Control": "public, max-age=3600" });
    } catch (err) {
      return json({ error: String(err.message || err) }, 502);
    }
  },
};

function primaryPrice(q, provider, env) {
  if (provider === "serp") return serpProductSearch(q, env);
  if (provider === "bestbuy") return bestBuy(q, env);
  return rapidProductSearch(q, env);
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });
}

function toNumber(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/* ---- RapidAPI: "Real-Time Product Search" (free tier, Gmail OK) ----
   Subscribe (free) at rapidapi.com, then:
     npx wrangler secret put RAPIDAPI_KEY
   NOTE: field paths reflect that API's schema at time of writing;
   if it changes, adjust the picks below. */
async function rapidProductSearch(q, env) {
  if (!env.RAPIDAPI_KEY) throw new Error("RAPIDAPI_KEY not set");
  const host = env.RAPIDAPI_HOST || "real-time-product-search.p.rapidapi.com";
  const url = `https://${host}/search?q=${encodeURIComponent(q)}&country=us&limit=1`;
  const r = await fetch(url, {
    headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": host },
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const d = await r.json();
  const p = d?.data?.products?.[0] ?? d?.products?.[0];
  if (!p) throw new Error("no results");

  const price = toNumber(
    p?.offer?.price ?? p?.price ?? p?.typical_price_range?.[0]
  );
  if (!Number.isFinite(price)) throw new Error("no price in result");

  return {
    current: price,
    currency: p?.offer?.currency || "USD",
    category: p?.product_category || "Product",
    retailer: p?.offer?.store_name || "online",
    image: pickImage(p),
  };
}

/* Find a usable product image anywhere in the result object. The API's
   field name for photos varies, so we deep-scan for the first https URL
   that looks like an image (by extension or by a known image-host pattern),
   preferring keys named photo/image/img/thumb. Returns null if none found.
   These URLs embed fine in the browser with referrerpolicy="no-referrer". */
function pickImage(node) {
  const IMG = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)|gstatic|googleusercontent|ggpht|images-amazon|media-amazon|ssl-images-amazon|mzstatic|shopify|cloudfront|scene7|cloudinary|imgix|bbystatic|target\.scene7|samsclubresources/i;
  const seen = new Set();
  const walk = (v, depth) => {
    if (depth > 5 || v == null) return null;
    if (typeof v === "string") {
      return /^https:\/\/\S{12,}/.test(v) && IMG.test(v) ? v : null;
    }
    if (Array.isArray(v)) {
      for (const x of v) { const r = walk(x, depth + 1); if (r) return r; }
      return null;
    }
    if (typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      // visit photo-ish keys first
      const keys = Object.keys(v).sort(
        (a, b) => imgRank(b) - imgRank(a)
      );
      for (const k of keys) { const r = walk(v[k], depth + 1); if (r) return r; }
    }
    return null;
  };
  return walk(node, 0);
}
function imgRank(k) { return /(photo|image|img|thumb|picture)/i.test(k) ? 1 : 0; }

/* Debug: return the raw first product object + its top-level keys, so the
   exact photo field can be identified. Reached via ?debug=1. */
async function rapidRaw(q, env) {
  if (!env.RAPIDAPI_KEY) throw new Error("RAPIDAPI_KEY not set");
  const host = env.RAPIDAPI_HOST || "real-time-product-search.p.rapidapi.com";
  const url = `https://${host}/search?q=${encodeURIComponent(q)}&country=us&limit=1`;
  const r = await fetch(url, {
    headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": host },
  });
  const d = await r.json();
  const p = d?.data?.products?.[0] ?? d?.products?.[0] ?? null;
  return { status: r.status, topKeys: d ? Object.keys(d) : [], productKeys: p ? Object.keys(p) : [], product: p };
}

/* ---- Best Buy Developer API (free key; needs a non-free-email account) ----
   Get a key at developer.bestbuy.com, then:
     npx wrangler secret put BESTBUY_KEY
   and set PROVIDER=bestbuy. */
async function bestBuy(q, env) {
  if (!env.BESTBUY_KEY) throw new Error("BESTBUY_KEY not set");
  const url =
    `https://api.bestbuy.com/v1/products(search=${encodeURIComponent(q)})` +
    `?apiKey=${env.BESTBUY_KEY}&format=json&show=name,salePrice,categoryPath.name` +
    `&pageSize=1&sort=bestSellingRank.asc`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const d = await r.json();
  const p = d?.products?.[0];
  if (!p) throw new Error("no results");

  const cat = Array.isArray(p.categoryPath) && p.categoryPath.length
    ? p.categoryPath[p.categoryPath.length - 1].name : "Product";
  return { current: p.salePrice, currency: "USD", category: cat, retailer: "Best Buy" };
}

/* ---- SerpApi: Google Shopping (free tier, Gmail OK) ----
   Get a key at serpapi.com, then:
     npx wrangler secret put SERPAPI_KEY
   and set PROVIDER=serp. */
async function serpProductSearch(q, env) {
  if (!env.SERPAPI_KEY) throw new Error("SERPAPI_KEY not set");
  const url = `https://serpapi.com/search.json?engine=google_shopping&gl=us&hl=en` +
    `&q=${encodeURIComponent(q)}&api_key=${env.SERPAPI_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const d = await r.json();
  const p = d?.shopping_results?.[0];
  if (!p) throw new Error("no results");

  const price = toNumber(p.extracted_price ?? p.price);
  if (!Number.isFinite(price)) throw new Error("no price in result");

  return {
    current: price,
    currency: "USD",
    category: "Product",
    retailer: p.source || "online",
    image: (typeof p.thumbnail === "string" && p.thumbnail.startsWith("https://")) ? p.thumbnail : pickImage(p),
    rating: Number.isFinite(+p.rating) ? +p.rating : null,
    reviews: Number.isFinite(+p.reviews) ? +p.reviews : null,
  };
}

/* ---- eBay Browse API (free, Gmail OK) ----
   Create an app at developer.ebay.com (Production keyset), then:
     npx wrangler secret put EBAY_CLIENT_ID
     npx wrangler secret put EBAY_CLIENT_SECRET
   Adds a real eBay market price to every response. Optional. */
let ebayTok = { value: null, exp: 0 };
async function ebayToken(env) {
  const now = Date.now();
  if (ebayTok.value && now < ebayTok.exp - 60000) return ebayTok.value;
  const basic = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!r.ok) throw new Error(`ebay token ${r.status}`);
  const d = await r.json();
  ebayTok = { value: d.access_token, exp: now + (d.expires_in || 7200) * 1000 };
  return ebayTok.value;
}
async function ebayPrice(q, env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return null;
  const token = await ebayToken(env);
  const url = "https://api.ebay.com/buy/browse/v1/item_summary/search" +
    `?q=${encodeURIComponent(q)}&limit=5&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE}")}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!r.ok) throw new Error(`ebay ${r.status}`);
  const d = await r.json();
  const it = (d?.itemSummaries || []).find((i) => toNumber(i?.price?.value) > 0);
  if (!it) return null;
  return {
    price: toNumber(it.price.value),
    currency: it.price.currency || "USD",
    url: it.itemWebUrl || null,
    condition: it.condition || null,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
    title: it.title || null,
  };
}

/* ---- UPCitemdb: barcode → product (free trial works without a key) ----
   Optional paid key for higher limits:
     npx wrangler secret put UPCDB_KEY
   Reached via GET ?barcode=<digits>. */
async function upcLookup(code, env) {
  const clean = String(code).replace(/[^0-9]/g, "");
  if (clean.length < 8) throw new Error("invalid barcode");

  let url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${clean}`;
  const headers = {};
  if (env.UPCDB_KEY) {
    url = `https://api.upcitemdb.com/prod/v1/lookup?upc=${clean}`;
    headers.user_key = env.UPCDB_KEY;
    headers.key_type = "3scale";
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`upc ${r.status}`);
  const d = await r.json();
  const it = d?.items?.[0];
  if (!it) throw new Error("no product for that barcode");

  const image = Array.isArray(it.images) ? it.images.find((x) => /^https:\/\//.test(x)) || null : null;
  return {
    title: it.title || it.brand || null,
    brand: it.brand || null,
    category: it.category || null,
    image,
  };
}
