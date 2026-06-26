/* ============================================================
   Price data providers.

   `getPriceData()` is the single seam between the UI and where
   prices come from. It calls a configured proxy endpoint and
   transparently falls back to the estimate model, so the product
   works with or without a backend.

   Accepted proxy responses (GET `${apiBase}?q=<query>`):
     • Full history:  { series:[{t,price}], category?, currency? }
     • Current only:  { current:<number>, category?, retailer?, currency? }
   For "current only" we anchor the modeled trend to the real price,
   so today's headline number is real and the history is clearly
   labelled as an estimated trend.
   ============================================================ */
import { CONFIG } from "./config.js";
import { generateSeries } from "./model.js";
import { hashStr } from "./util.js";

export const SOURCE = { LIVE: "live", LIVE_CURRENT: "live-current", ESTIMATE: "estimate" };

/* Effective API base: ?api= URL param > localStorage > config.js.
   Lets you turn live data on without editing files (great for testing). */
export function effectiveApiBase() {
  try {
    const p = new URLSearchParams(location.search).get("api");
    if (p) return p;
    const ls = localStorage.getItem("tracer-api-base");
    if (ls) return ls;
  } catch { /* non-browser */ }
  return CONFIG.apiBase;
}

export function isLive() {
  return Boolean(effectiveApiBase());
}

function anchorToPrice(series, current) {
  const last = series[series.length - 1].price || current;
  const k = current / last;
  return series.map((p) => ({ t: p.t, price: Math.round(p.price * k * 100) / 100 }));
}

async function fetchProxy(query, signal) {
  const base = effectiveApiBase().replace(/\/+$/, "");
  const url = `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;
  const headers = { Accept: "application/json" };
  if (CONFIG.apiKey) headers.Authorization = `Bearer ${CONFIG.apiKey}`;

  const res = await fetch(url, { headers, signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);

  // 1) full real history
  if (Array.isArray(json.series)) {
    const series = json.series
      .map((p) => ({ t: +p.t, price: +p.price }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
      .sort((a, b) => a.t - b.t);
    if (series.length >= 8) {
      return {
        series, category: json.category || "Product",
        base: series[0].price, seed: hashStr(query), source: SOURCE.LIVE,
        retailer: json.retailer || null, image: json.image || null,
        ebay: json.ebay || null, rating: json.rating ?? null, reviews: json.reviews ?? null,
      };
    }
  }

  // 2) real current price → anchor the modeled trend to it
  const current = Number(json.current);
  if (Number.isFinite(current) && current > 0) {
    const modeled = generateSeries(query);
    return {
      series: anchorToPrice(modeled.series, current),
      category: json.category || modeled.category,
      base: modeled.base, seed: modeled.seed, source: SOURCE.LIVE_CURRENT,
      retailer: json.retailer || null, currentReal: current,
      image: json.image || null,
      ebay: json.ebay || null, rating: json.rating ?? null, reviews: json.reviews ?? null,
    };
  }

  throw new Error("unrecognized response shape");
}

/**
 * Resolve price history for a parsed query.
 * @param {{title:string}} parsed
 * @param {{signal?:AbortSignal}} [opts]
 */
export async function getPriceData(parsed, opts = {}) {
  const query = parsed.title;
  if (isLive()) {
    try {
      return await fetchProxy(query, opts.signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      console.warn("[Tracer] live price fetch failed, using estimate model:", err.message);
    }
  }
  return { ...generateSeries(query), source: SOURCE.ESTIMATE };
}

/**
 * Resolve a scanned barcode (UPC/EAN) to a product name via the proxy.
 * @param {string} code digits from the scanned barcode
 * @returns {Promise<{title:string, brand?:string, image?:string, category?:string}>}
 */
export async function lookupBarcode(code) {
  const base = effectiveApiBase();
  if (!base) throw new Error("Barcode lookup needs a live data source (set apiBase).");
  const b = base.replace(/\/+$/, "");
  const url = `${b}${b.includes("?") ? "&" : "?"}barcode=${encodeURIComponent(code)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);
  if (!json.title) throw new Error("No product found for that barcode.");
  return json;
}
