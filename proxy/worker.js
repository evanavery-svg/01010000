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

    const q = new URL(request.url).searchParams.get("q");
    if (!q) return json({ error: "missing q" }, 400);

    try {
      const provider = (env.PROVIDER || "rapid").toLowerCase();
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

  // Fetch price + Google image in parallel to minimise latency
  const [r, image] = await Promise.all([
    fetch(url, { headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": host } }),
    googleImage(q),
  ]);

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
    image,
  };
}

/* Fetch the first embeddable image URL from Google Image Search.
   Runs server-side so there are no CORS / referrer issues for the browser.
   Returns null silently on any failure — images are always optional. */
async function googleImage(q) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q + " product")}&tbm=isch&hl=en&safe=active`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Google embeds full-res image URLs as encoded strings in the page JS.
    // Look for https:// image URLs that are NOT Google's own hosting.
    const re = /"(https:\/\/(?!(?:encrypted-tbn|www\.gstatic|lh[0-9]\.google|www\.google))[^"\\]{20,}\.(?:jpg|jpeg|png|webp)(?:\?[^"\\]{0,120})?)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      // Skip tiny icons / logos (usually short paths)
      if (m[1].length > 40) return m[1];
    }
    return null;
  } catch {
    return null;
  }
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
