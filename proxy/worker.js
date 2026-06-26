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

   Pick an upstream with the PROVIDER env var: "rapid" (default) or
   "bestbuy". Set the matching key as a secret.
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
    const q = u.searchParams.get("q");
    if (!q) return json({ error: "missing q" }, 400);

    try {
      const provider = (env.PROVIDER || "rapid").toLowerCase();

      // ?debug=1 returns the raw upstream product (no cache) for field mapping.
      if (u.searchParams.get("debug") && provider !== "bestbuy") {
        return json(await rapidRaw(q, env), 200, { "Cache-Control": "no-store" });
      }

      const data = provider === "bestbuy" ? await bestBuy(q, env) : await rapidProductSearch(q, env);
      // cache at the edge for an hour to stay inside free tiers
      return json(data, 200, { "Cache-Control": "public, max-age=3600" });
    } catch (err) {
      return json({ error: String(err.message || err) }, 502);
    }
  },
};

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
