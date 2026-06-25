/* Shared helpers: formatting, hashing, deterministic RNG. */
import { CONFIG } from "./config.js";

export const DAY = 86400000;

export const fmt = new Intl.NumberFormat(undefined, {
  style: "currency", currency: CONFIG.currency || "USD", maximumFractionDigits: 2,
});
export const fmt0 = new Intl.NumberFormat(undefined, {
  style: "currency", currency: CONFIG.currency || "USD", maximumFractionDigits: 0,
});

export const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;
export const pct1 = (x) => `${(Math.abs(x) * 100).toFixed(1)}%`;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const dateShort = (d) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const dateFull = (d) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/* FNV-1a hash → 32-bit unsigned */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* mulberry32 — small, fast, seedable PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
