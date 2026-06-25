/* ============================================================
   Insights: stats, deal score (Feature 7), forecast + verdict (Feature 6).
   ============================================================ */
import { DAY, fmt, pct, clamp } from "./util.js";
import { EVENTS, seasonalDiscount } from "./model.js";

export function computeStats(series) {
  let lo = series[0], hi = series[0], sum = 0;
  for (const p of series) {
    if (p.price < lo.price) lo = p;
    if (p.price > hi.price) hi = p;
    sum += p.price;
  }
  const avg = sum / series.length;
  const current = series[series.length - 1];
  const prior = series[Math.max(0, series.length - 8)]; // ~1 week ago
  const span = Math.max(0.01, hi.price - lo.price);
  const position = clamp((current.price - lo.price) / span, 0, 1); // 0 = at the low
  const weekDelta = (current.price - prior.price) / prior.price;
  const offHigh = (hi.price - current.price) / hi.price;
  const vsAvg = (current.price - avg) / avg;

  // 30-day momentum
  const ref = series[Math.max(0, series.length - 31)];
  const momentum = (current.price - ref.price) / ref.price;

  return { lo, hi, avg, current, span, position, weekDelta, offHigh, vsAvg, momentum };
}

/* ---- Feature 7: deal score (0–100, higher = better time to buy) ---- */
export function dealScore(s) {
  // Mostly driven by where today's price sits in the yearly range,
  // nudged by distance below average and recent downward momentum.
  const posScore = (1 - s.position) * 70;          // near low → up to 70
  const avgScore = clamp(-s.vsAvg, -0.3, 0.3) / 0.3 * 20; // below avg → up to +20
  const momScore = clamp(-s.momentum, -0.15, 0.15) / 0.15 * 10; // falling → up to +10
  const score = Math.round(clamp(posScore + avgScore + momScore, 1, 99));

  let grade, label, cls;
  if (score >= 80) { grade = "A"; label = "Excellent deal"; cls = "buy"; }
  else if (score >= 62) { grade = "B"; label = "Good deal"; cls = "buy"; }
  else if (score >= 42) { grade = "C"; label = "Fair price"; cls = "fair"; }
  else if (score >= 25) { grade = "D"; label = "Above average"; cls = "wait"; }
  else { grade = "E"; label = "Poor time to buy"; cls = "wait"; }
  return { score, grade, label, cls };
}

/* ---- Feature 6: forecast the next likely price drop ---- */
export function forecast(stats, fromDate = new Date()) {
  const base = stats.avg; // anchor expected discount to the typical price
  let best = null;
  for (const [mo, day, depth, , name] of EVENTS) {
    for (const yr of [fromDate.getFullYear(), fromDate.getFullYear() + 1]) {
      const ev = new Date(yr, mo, day);
      if (ev > fromDate) {
        const days = Math.round((ev - fromDate) / DAY);
        if (!best || days < best.days) {
          best = { name, date: ev, days, depth, expected: base * (1 - depth) };
        }
        break;
      }
    }
  }
  if (!best) return null;
  const savings = stats.current.price - best.expected;
  best.savings = savings;
  best.savingsPct = savings / stats.current.price;
  best.worthWaiting = savings > stats.current.price * 0.06 && best.days <= 75;

  // Build a short dashed projection from today toward the forecast price.
  const last = stats.current;
  const steps = 14;
  best.projection = [{ t: last.t, price: last.price }];
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    best.projection.push({
      t: last.t + (best.date.getTime() - last.t) * f,
      price: last.price + (best.expected - last.price) * f,
    });
  }
  return best;
}

/* ---- Feature 6: verdict that blends current price + forecast ---- */
export function buildVerdict(stats, deal, fc) {
  const nearLow = stats.current.price <= stats.lo.price * 1.02 || stats.position < 0.16;

  if (nearLow && !(fc && fc.worthWaiting)) {
    return {
      cls: "buy",
      label: "Buy now — near its lowest",
      line: `Today's price is within <strong>${pct(stats.position)}</strong> of the cheapest it's been all year. Strong time to buy.`,
    };
  }
  if (fc && fc.worthWaiting) {
    return {
      cls: "wait",
      label: "Wait — a sale is coming",
      line: `<strong>${fc.name}</strong> is about ${fc.days} days out, where this typically falls to around <strong>${fmt.format(fc.expected)}</strong> — roughly <strong>${fmt.format(Math.max(0, fc.savings))}</strong> less than today.`,
    };
  }
  if (deal.score >= 50) {
    return {
      cls: "fair",
      label: "Fair price",
      line: `A reasonable price, though it has dropped to <strong>${fmt.format(stats.lo.price)}</strong> before. ${fc ? `Next likely dip: ${fc.name}, ~${fc.days} days out.` : ""}`,
    };
  }
  return {
    cls: "wait",
    label: "Hold off if you can",
    line: `Priced high for the year — about <strong>${pct((stats.current.price - stats.lo.price) / stats.lo.price)}</strong> above its yearly low of <strong>${fmt.format(stats.lo.price)}</strong>.`,
  };
}
