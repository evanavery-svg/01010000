/* ============================================================
   SVG price chart. One renderer drives both the on-screen chart
   (using CSS variables) and the PNG export (using resolved hex),
   so they always look identical.
   ============================================================ */
import { fmt, fmt0, dateFull } from "./util.js";

const VIEW = { W: 760, H: 300, padL: 8, padR: 8, padT: 18, padB: 26 };

// Palettes keyed by purpose. Live view uses CSS vars; export uses hex.
export const LIVE_COLORS = {
  line: "var(--orange)", area: "var(--orange)", grid: "var(--stroke)",
  avg: "var(--text-3)", axis: "var(--text-3)", lo: "#34c759", hi: "#ff5a5a",
  ring: "var(--bg)", proj: "var(--orange-soft)",
};
export const EXPORT_COLORS = {
  dark: { line: "#ff6a00", area: "#ff6a00", grid: "rgba(255,255,255,.09)", avg: "#6e6e76",
          axis: "#8a8a92", lo: "#34c759", hi: "#ff5a5a", ring: "#0a0a0b", proj: "#ff8a3d",
          bg: "#141416", text: "#f5f5f7" },
  light: { line: "#ff6a00", area: "#ff6a00", grid: "rgba(0,0,0,.08)", avg: "#9a9aa3",
           axis: "#7a7a83", lo: "#1fb255", hi: "#ff5a5a", ring: "#ffffff", proj: "#ff8a3d",
           bg: "#ffffff", text: "#0a0a0b" },
};

function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/* Core renderer → returns { svg, scale } where scale maps data→screen. */
export function renderChartSVG(series, stats, opts = {}) {
  const c = opts.colors || LIVE_COLORS;
  const { W, H, padL, padR, padT, padB } = VIEW;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const proj = opts.projection && opts.projection.length > 1 ? opts.projection : null;
  const gid = opts.gradientId || "areaGrad";

  const allT = series.map((p) => p.t).concat(proj ? proj.map((p) => p.t) : []);
  const tMin = Math.min(...allT), tMax = Math.max(...allT);
  const tSpan = Math.max(1, tMax - tMin);

  const allP = series.map((p) => p.price).concat(proj ? proj.map((p) => p.price) : []);
  let min = Math.min(...allP), max = Math.max(...allP);
  const padV = (max - min) * 0.18 || max * 0.1;
  min -= padV; max += padV;

  const X = (t) => padL + ((t - tMin) / tSpan) * innerW;
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * innerH;

  const pts = series.map((p) => [X(p.t), Y(p.price)]);
  const line = smoothPath(pts);
  const histRight = X(series[series.length - 1].t);
  const area = `${line} L ${histRight} ${padT + innerH} L ${X(series[0].t)} ${padT + innerH} Z`;
  const avgY = Y(stats.avg);

  let grid = "";
  for (let k = 0; k <= 3; k++) {
    const val = min + (max - min) * (k / 3);
    const gy = Y(val);
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${c.grid}" stroke-width="1"/>`;
    grid += `<text x="${padL + 2}" y="${(gy - 5).toFixed(1)}" fill="${c.axis}" font-size="11" font-family="inherit">${fmt0.format(val)}</text>`;
  }

  let xlab = "";
  const step = Math.max(1, Math.floor(series.length / 5));
  for (let i = 0; i < series.length; i += step) {
    const d = new Date(series[i].t);
    xlab += `<text x="${X(series[i].t).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="${c.axis}" font-size="11" font-family="inherit">${d.toLocaleDateString(undefined, { month: "short" })}</text>`;
  }

  let projPath = "";
  if (proj) {
    const ppts = proj.map((p) => [X(p.t), Y(p.price)]);
    projPath = `<path d="${smoothPath(ppts)}" fill="none" stroke="${c.proj}" stroke-width="2.2"
      stroke-linecap="round" stroke-dasharray="2 6" opacity="0.9"/>
      <circle cx="${ppts[ppts.length - 1][0].toFixed(1)}" cy="${ppts[ppts.length - 1][1].toFixed(1)}" r="4" fill="${c.proj}"/>`;
  }

  const hover = opts.live ? `<g class="hover-g" style="opacity:0">
      <line class="hover-line" y1="${padT}" y2="${padT + innerH}" stroke="${c.grid}"/>
      <circle class="hover-dot" r="5" fill="${c.line}" stroke="${c.ring}" stroke-width="3"/>
    </g>` : "";

  const bg = opts.bg ? `<rect width="${W}" height="${H}" fill="${opts.bg}"/>` : "";

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      class="${opts.live ? "chart-svg" : ""}" aria-label="Price over time"
      xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, system-ui, sans-serif">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${c.area}" stop-opacity="0.28"/>
          <stop offset="1" stop-color="${c.area}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${bg}${grid}
      <path class="area-fill" d="${area}" fill="url(#${gid})"/>
      <line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${W - padR}" y2="${avgY.toFixed(1)}" stroke="${c.avg}" stroke-width="1.2" stroke-dasharray="4 5" opacity="0.7"/>
      <path class="price-line" d="${line}" fill="none" stroke="${c.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${projPath}${xlab}
      <circle cx="${X(stats.hi.t).toFixed(1)}" cy="${Y(stats.hi.price).toFixed(1)}" r="5" fill="${c.hi}" stroke="${c.ring}" stroke-width="2.5"/>
      <circle cx="${X(stats.lo.t).toFixed(1)}" cy="${Y(stats.lo.price).toFixed(1)}" r="5" fill="${c.lo}" stroke="${c.ring}" stroke-width="2.5"/>
      ${hover}
    </svg>`;

  return { svg, X, Y, view: VIEW };
}

/* Draw into a live container + wire hover/touch tooltip. */
export function drawChart(container, series, stats, opts = {}) {
  const { svg, X, Y, view } = renderChartSVG(series, stats, { ...opts, live: true, colors: LIVE_COLORS });
  container.innerHTML = svg;
  const el = container.querySelector("svg");

  // entrance animation
  const path = el.querySelector(".price-line");
  const len = path.getTotalLength();
  el.style.setProperty("--len", len);
  container.classList.add("draw");
  void path.getBoundingClientRect();

  setupHover(container, el, series, X, Y, view, opts.tooltip);
  return el;
}

function setupHover(wrap, svg, series, X, Y, view, tooltip) {
  const g = svg.querySelector(".hover-g");
  if (!g) return;
  const hLine = g.querySelector(".hover-line");
  const hDot = g.querySelector(".hover-dot");
  const tMin = series[0].t, tMax = series[series.length - 1].t;

  function move(clientX) {
    const rect = svg.getBoundingClientRect();
    const rel = (clientX - rect.left) / rect.width;
    const targetT = tMin + rel * (tMax - tMin);
    // nearest sample
    let i = Math.round((rel) * (series.length - 1));
    i = Math.max(0, Math.min(series.length - 1, i));
    const p = series[i];
    const sx = X(p.t), sy = Y(p.price);
    g.style.opacity = "1";
    hLine.setAttribute("x1", sx); hLine.setAttribute("x2", sx);
    hDot.setAttribute("cx", sx); hDot.setAttribute("cy", sy);

    if (tooltip) {
      const px = rect.left + (sx / view.W) * rect.width;
      const py = rect.top + (sy / view.H) * rect.height;
      tooltip.hidden = false;
      tooltip.innerHTML = `<div class="tt-price">${fmt.format(p.price)}</div><div class="tt-date">${dateFull(new Date(p.t))}</div>`;
      const tw = tooltip.offsetWidth;
      const cx = Math.max(tw / 2 + 6, Math.min(window.innerWidth - tw / 2 - 6, px));
      tooltip.style.left = `${cx}px`;
      tooltip.style.top = `${py}px`;
    }
  }
  function end() { g.style.opacity = "0"; if (tooltip) tooltip.hidden = true; }

  wrap.addEventListener("pointermove", (e) => { e.preventDefault(); move(e.clientX); });
  wrap.addEventListener("pointerdown", (e) => move(e.clientX));
  wrap.addEventListener("pointerleave", end);
  wrap.addEventListener("pointercancel", end);
}

/* Tiny sparkline for deal-feed cards. */
export function sparkline(series, color = "var(--orange)") {
  const W = 120, H = 36;
  const prices = series.map((p) => p.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = max - min || 1;
  const pts = series.map((p, i) => [
    (i / (series.length - 1)) * W,
    H - ((p.price - min) / span) * (H - 4) - 2,
  ]);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" aria-hidden="true">
    <path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
