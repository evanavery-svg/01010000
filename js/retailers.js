/* ============================================================
   Retailers: URL lookup (Feature 4) + price comparison (Feature 5).
   ============================================================ */
import { CONFIG } from "./config.js";
import { hashStr, mulberry32, titleCase } from "./util.js";

const HOSTS = [
  { re: /amazon\./i,  name: "Amazon" },
  { re: /walmart\./i, name: "Walmart" },
  { re: /bestbuy\./i, name: "Best Buy" },
  { re: /target\./i,  name: "Target" },
  { re: /ebay\./i,    name: "eBay" },
  { re: /newegg\./i,  name: "Newegg" },
  { re: /apple\./i,   name: "Apple" },
  { re: /costco\./i,  name: "Costco" },
];

function cleanSlug(s) {
  return decodeURIComponent(s)
    .replace(/[-_+]/g, " ")
    .replace(/\b(ref|dp|gp|product|sku|item|p|ip|site|pd)\b/gi, " ")
    .replace(/\b[A-Z0-9]{8,}\b/g, " ")     // strip ASIN-like tokens
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Pull a human product name out of a retailer URL. */
function titleFromUrl(u) {
  // Amazon: /Brand-Product-Name/dp/ASIN
  const amz = u.pathname.match(/\/([^/]+)\/(?:dp|gp\/product)\//i);
  if (amz) return cleanSlug(amz[1]);

  // common query params
  for (const k of ["q", "searchTerm", "st", "_nkw", "keyword", "query"]) {
    const v = u.searchParams.get(k);
    if (v) return cleanSlug(v);
  }

  // longest descriptive path segment
  const seg = u.pathname.split("/").filter(Boolean)
    .map(cleanSlug).filter((s) => s.split(" ").length >= 2)
    .sort((a, b) => b.length - a.length)[0];
  return seg || "";
}

function productIdFromUrl(u) {
  const m = u.pathname.match(/\/(?:dp|gp\/product|ip|p)\/([A-Za-z0-9]{6,})/i)
    || u.pathname.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);
  return m ? m[1] : null;
}

/**
 * Parse raw input into a normalized query.
 * @returns {{kind:'url'|'text', title:string, retailer:?string, productId:?string, raw:string}}
 */
export function parseQuery(input) {
  const raw = (input || "").trim();
  const looksUrl = /^(https?:\/\/|www\.)/i.test(raw) || /\.[a-z]{2,}\/\S/i.test(raw);
  if (looksUrl) {
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const host = HOSTS.find((h) => h.re.test(u.hostname));
      const title = titleFromUrl(u);
      if (title) {
        return {
          kind: "url",
          title: titleCase(title),
          retailer: host ? host.name : u.hostname.replace(/^www\./, ""),
          productId: productIdFromUrl(u),
          raw,
        };
      }
    } catch { /* fall through to text */ }
  }
  return { kind: "text", title: raw, retailer: null, productId: null, raw };
}

/**
 * Deterministic set of retailer offers around the current price.
 * Buy links are real searches so they always work.
 */
export function buildOffers(parsed, currentPrice, seed, real = {}) {
  const rnd = mulberry32((seed ^ hashStr("retail")) >>> 0);
  const q = encodeURIComponent(parsed.title);

  const offers = CONFIG.retailers.map((r, i) => {
    // A real, live price for this retailer (e.g. eBay) overrides the estimate.
    const live = real[r.name];
    if (live && Number.isFinite(live.price)) {
      return {
        name: r.name, color: r.color, price: live.price, inStock: true, live: true,
        shipping: live.condition ? `${live.condition} · live` : "Live listing",
        url: live.url || (r.search + q),
        sourceMatch: false,
      };
    }
    // spread roughly -6%..+9% around current; some retailers run cheaper
    const skew = (rnd() - 0.45) * 0.15;
    const price = Math.round(currentPrice * (1 + skew) * 100) / 100;
    const inStock = rnd() > 0.12;
    const prime = rnd() > 0.5;
    return {
      name: r.name,
      color: r.color,
      price,
      inStock,
      shipping: prime ? "Free shipping" : (rnd() > 0.5 ? "Free over $35" : "Ships in 1–2 days"),
      url: r.search + q,
      sourceMatch: parsed.retailer && r.name.toLowerCase() === parsed.retailer.toLowerCase(),
    };
  });

  // cheapest in-stock offer wins the badge
  const inStock = offers.filter((o) => o.inStock);
  const cheapest = (inStock.length ? inStock : offers)
    .reduce((a, b) => (b.price < a.price ? b : a));
  cheapest.best = true;

  offers.sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    return a.price - b.price;
  });
  return offers;
}
