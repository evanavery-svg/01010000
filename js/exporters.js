/* ============================================================
   Feature 8: share + export (CSV, PNG).
   ============================================================ */
import { renderChartSVG, EXPORT_COLORS } from "./chart.js";
import { dateFull } from "./util.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

/* ---- Share: native sheet on mobile, clipboard fallback ---- */
export async function shareItem(title) {
  const url = `${location.origin}${location.pathname}#${encodeURIComponent(title)}`;
  const data = { title: `Tracer — ${title}`, text: `Price history for ${title} on Tracer`, url };
  try {
    if (navigator.share) { await navigator.share(data); return "shared"; }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (e) {
    if (e?.name === "AbortError") return "cancelled";
    try { await navigator.clipboard.writeText(url); return "copied"; } catch { return "failed"; }
  }
}

/* ---- CSV export of the full history ---- */
export function exportCSV(title, series) {
  const rows = ["date,price", ...series.map((p) => `${new Date(p.t).toISOString().slice(0, 10)},${p.price}`)];
  download(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }), `tracer-${slug(title)}.csv`);
}

/* ---- PNG export: rasterize a self-contained SVG of the chart ---- */
export async function exportPNG(title, series, stats, theme = "dark", projection = null, marks = []) {
  const colors = EXPORT_COLORS[theme] || EXPORT_COLORS.dark;
  const scale = 2;
  const W = 760, H = 300, padTop = 84, padBottom = 28, padX = 24;
  const cardW = W + padX * 2;
  const cardH = H + padTop + padBottom;

  const { svg: chartSvg } = renderChartSVG(series, stats, {
    colors, projection, marks, gradientId: "exp", live: false,
  });
  // strip the outer <svg> wrapper, keep inner markup, then re-embed positioned
  const inner = chartSvg.replace(/^[\s\S]*?>/, "").replace(/<\/svg>\s*$/, "");

  const today = dateFull(new Date());
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}"
      viewBox="0 0 ${cardW} ${cardH}" font-family="-apple-system, system-ui, Segoe UI, Roboto, sans-serif">
    <rect width="${cardW}" height="${cardH}" rx="24" fill="${colors.bg}"/>
    <g transform="translate(${padX}, 26)">
      <circle cx="9" cy="6" r="9" fill="${colors.line}"/>
      <text x="26" y="11" fill="${colors.text}" font-size="17" font-weight="700">Tracer</text>
      <text x="${W}" y="11" text-anchor="end" fill="${colors.axis}" font-size="13">${today}</text>
      <text x="0" y="40" fill="${colors.text}" font-size="22" font-weight="700">${escapeXml(title)}</text>
      <text x="0" y="60" fill="${colors.axis}" font-size="13">Low ${money(stats.lo.price)} · High ${money(stats.hi.price)} · Avg ${money(stats.avg)}</text>
    </g>
    <g transform="translate(${padX}, ${padTop})">
      <svg width="${W}" height="${H}" viewBox="0 0 760 300" preserveAspectRatio="none">${inner}</svg>
    </g>
  </svg>`;

  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(doc);
  const img = new Image();
  img.decoding = "async";
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error("svg render failed"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = cardW * scale; canvas.height = cardH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, cardW, cardH);

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (blob) download(blob, `tracer-${slug(title)}.png`);
  return Boolean(blob);
}

function money(v) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}
