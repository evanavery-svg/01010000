/* ============================================================
   Deterministic price-history model.
   Same query → same history, so the app is fully functional and
   demoable offline. Swap providers.js to use a live API instead.
   ============================================================ */
import { DAY, hashStr, mulberry32 } from "./util.js";

// Recognizable items get realistic anchors; everything else is
// derived from the query hash so any input returns a sensible price.
const KNOWN = [
  [/airpods?\s*pro/i, 249, "Audio"],
  [/airpods?\s*max/i, 549, "Audio"],
  [/airpods?/i, 129, "Audio"],
  [/iphone\s*15\s*pro/i, 999, "Phones"],
  [/iphone\s*15/i, 799, "Phones"],
  [/iphone/i, 699, "Phones"],
  [/ipad\s*pro/i, 999, "Tablets"],
  [/ipad/i, 449, "Tablets"],
  [/macbook\s*air/i, 1099, "Laptops"],
  [/macbook\s*pro/i, 1599, "Laptops"],
  [/macbook/i, 1199, "Laptops"],
  [/apple\s*watch|watch\s*ultra/i, 399, "Wearables"],
  [/playstation|ps5/i, 499, "Gaming"],
  [/xbox/i, 499, "Gaming"],
  [/nintendo|switch/i, 299, "Gaming"],
  [/sony\s*wh|headphones?|xm5|xm4/i, 349, "Audio"],
  [/kindle/i, 139, "E-readers"],
  [/dyson/i, 429, "Home"],
  [/nike|adidas|sneakers?|shoes?/i, 119, "Apparel"],
  [/tv|oled|qled/i, 899, "TVs"],
  [/coffee|espresso/i, 199, "Home"],
  [/monitor/i, 329, "Displays"],
  [/keyboard/i, 99, "Accessories"],
  [/camera|gopro/i, 449, "Cameras"],
  [/drone/i, 759, "Cameras"],
  [/laptop/i, 899, "Laptops"],
  [/vacuum/i, 299, "Home"],
];

function basePriceFor(query, rnd) {
  for (const [re, price, cat] of KNOWN) {
    if (re.test(query)) return { base: price, category: cat };
  }
  const t = rnd();
  const base = Math.round((20 + Math.pow(t, 1.7) * 880) / 5) * 5 - 0.01;
  return { base, category: "Product" };
}

// Seasonal sale calendar — [month(0-11), day, depth(0-1), spread(days)]
export const EVENTS = [
  [10, 28, 0.18, 9,  "Black Friday"],
  [11, 1,  0.16, 6,  "Cyber Monday"],
  [11, 26, 0.14, 7,  "Boxing Week"],
  [6,  12, 0.15, 6,  "Prime Day"],
  [7,  25, 0.10, 12, "Back-to-school sales"],
  [4,  26, 0.09, 6,  "Memorial Day sales"],
  [8,  4,  0.08, 5,  "Labor Day sales"],
  [1,  12, 0.07, 6,  "Presidents' Day sales"],
];

export function seasonalDiscount(date) {
  let d = 0;
  const y = date.getFullYear();
  for (const [mo, day, depth, spread] of EVENTS) {
    const ev = new Date(y, mo, day).getTime();
    const dist = Math.abs(date.getTime() - ev) / DAY;
    if (dist < spread * 2.2) {
      d = Math.max(d, depth * Math.exp(-(dist * dist) / (2 * spread * spread)));
    }
  }
  return d;
}

/* Build ~1 year of daily prices for a query string. */
export function generateSeries(query) {
  const key = (query || "").trim().toLowerCase();
  const seed = hashStr(key || "tracer");
  const rnd = mulberry32(seed);
  const { base, category } = basePriceFor(key, rnd);

  const days = 365;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * DAY;

  const drift = (rnd() - 0.62) * 0.16;       // net % change across the year
  const volatility = 0.012 + rnd() * 0.02;   // daily noise scale
  let walk = 0;

  const series = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * DAY);
    const progress = i / (days - 1);
    walk = walk * 0.86 + (rnd() - 0.5) * volatility;
    const trend = 1 + drift * progress;
    const wobble = 1 + Math.sin(progress * Math.PI * 3 + (seed % 7)) * 0.02;
    const sale = 1 - seasonalDiscount(date);
    let price = base * trend * wobble * (1 + walk) * sale;
    if (rnd() > 0.985) price *= 0.93; // occasional flash dip
    price = Math.max(base * 0.45, price);
    series.push({ t: date.getTime(), price: Math.round(price * 100) / 100 });
  }
  return { series, category, base, seed };
}
