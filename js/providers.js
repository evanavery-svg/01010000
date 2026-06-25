/* ============================================================
   Price data providers (Feature 1: live-data ready).

   `getPriceData()` is the single seam between the UI and where
   prices come from. It tries a live API when one is configured in
   config.js and transparently falls back to the estimate model,
   so the product works perfectly with or without a backend.
   ============================================================ */
import { CONFIG } from "./config.js";
import { generateSeries } from "./model.js";
import { hashStr } from "./util.js";

const SOURCE = { LIVE: "live", ESTIMATE: "estimate" };

async function fetchLive(query, signal) {
  const url = `${CONFIG.apiBase.replace(/\/$/, "")}/history?q=${encodeURIComponent(query)}`;
  const headers = { Accept: "application/json" };
  if (CONFIG.apiKey) headers.Authorization = `Bearer ${CONFIG.apiKey}`;

  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const series = (json.series || [])
    .map((p) => ({ t: +p.t, price: +p.price }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
    .sort((a, b) => a.t - b.t);
  if (series.length < 8) throw new Error("insufficient history");

  return {
    series,
    category: json.category || "Product",
    base: series[0].price,
    seed: hashStr(query),
    source: SOURCE.LIVE,
  };
}

/**
 * Resolve price history for a parsed query.
 * @param {{title:string}} parsed
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<{series,category,base,seed,source}>}
 */
export async function getPriceData(parsed, opts = {}) {
  const query = parsed.title;
  if (CONFIG.apiBase) {
    try {
      return await fetchLive(query, opts.signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      console.warn("[Tracer] live price fetch failed, using estimate model:", err.message);
    }
  }
  return { ...generateSeries(query), source: SOURCE.ESTIMATE };
}

export function isLive() {
  return Boolean(CONFIG.apiBase);
}

export { SOURCE };
