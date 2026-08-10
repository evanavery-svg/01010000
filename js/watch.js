/* ============================================================
   Watchlist (target-price alerts) + real price memory.

   Both live in localStorage. The watchlist remembers items the
   user cares about, each with a target price; the price log
   records every real price the app sees, so charts accumulate
   genuine data points over time.
   ============================================================ */

const WATCH_KEY = "tracer-watch";
const LOG_KEY = "tracer-price-log";

const keyOf = (q) => String(q).trim().toLowerCase();

function load(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ }
}

/* ---- Watchlist: [{ q, target, price, image, live, added }] ---- */

export function getWatchlist() {
  const raw = load(WATCH_KEY, []);
  if (!Array.isArray(raw)) return [];   // corrupt/foreign value — don't take the page down
  return raw.filter((w) => w && w.q && Number.isFinite(w.target));
}

export function getWatch(q) {
  return getWatchlist().find((w) => keyOf(w.q) === keyOf(q)) || null;
}

export function isWatched(q) { return Boolean(getWatch(q)); }

/* Default target: ~8% below today, rounded to a clean number. */
export function defaultTarget(price) {
  const t = price * 0.92;
  return t >= 20 ? Math.floor(t) : Math.round(t * 100) / 100;
}

export function addWatch(q, price, image, live) {
  const list = getWatchlist().filter((w) => keyOf(w.q) !== keyOf(q));
  list.unshift({
    q,
    target: defaultTarget(price),
    price: Number.isFinite(price) ? price : null,
    image: image ?? null,
    live: Boolean(live),
    added: Date.now(),
  });
  save(WATCH_KEY, list.slice(0, 24));
}

export function removeWatch(q) {
  save(WATCH_KEY, getWatchlist().filter((w) => keyOf(w.q) !== keyOf(q)));
}

export function setTarget(q, target) {
  save(WATCH_KEY, getWatchlist().map((w) =>
    keyOf(w.q) === keyOf(q) ? { ...w, target } : w));
}

/* Refresh the last-seen price whenever the user checks a watched item. */
export function updateWatch(q, price, image, live) {
  if (!isWatched(q)) return;
  save(WATCH_KEY, getWatchlist().map((w) =>
    keyOf(w.q) === keyOf(q)
      ? { ...w, price, image: image ?? w.image, live: Boolean(live) }
      : w));
}

/* ---- Real price memory: { [key]: [{ t, p }] } ---- */

const LOG_MAX = 240;              // points kept per item
const LOG_ITEMS = 40;             // items tracked before oldest is dropped
const LOG_MIN_GAP = 6 * 3600e3;   // skip identical prices seen within 6h

export function recordPrice(q, price) {
  if (!Number.isFinite(price) || price <= 0) return;
  const log = load(LOG_KEY, {});
  const k = keyOf(q);
  const arr = Array.isArray(log[k]) ? log[k] : [];
  const last = arr[arr.length - 1];
  const now = Date.now();
  if (last && last.p === price && now - last.t < LOG_MIN_GAP) return;
  arr.push({ t: now, p: price });
  log[k] = arr.slice(-LOG_MAX);

  const keys = Object.keys(log);
  if (keys.length > LOG_ITEMS) {
    keys.sort((a, b) =>
      (log[a][log[a].length - 1]?.t ?? 0) - (log[b][log[b].length - 1]?.t ?? 0));
    for (const dead of keys.slice(0, keys.length - LOG_ITEMS)) delete log[dead];
  }
  save(LOG_KEY, log);
}

export function getRecorded(q) {
  const arr = load(LOG_KEY, {})[keyOf(q)];
  return Array.isArray(arr) ? arr.map((x) => ({ t: x.t, price: x.p })) : [];
}
