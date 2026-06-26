/* ============================================================
   Tracer — app orchestrator (ES module entry).
   ============================================================ */
import { fmt, pct, pct1, escapeHtml, dateShort } from "./util.js";
import { getPriceData, isLive, SOURCE } from "./providers.js";
import { generateSeries } from "./model.js";
import { parseQuery, buildOffers } from "./retailers.js";
import { computeStats, dealScore, forecast, buildVerdict } from "./insights.js";
import { drawChart, sparkline } from "./chart.js";
import { shareItem, exportCSV, exportPNG } from "./exporters.js";

const $ = (s, r = document) => r.querySelector(s);

/* ---------------- Theme ---------------- */
const themeBtn = $("#themeToggle");
const saved = localStorage.getItem("tracer-theme");
if (saved) document.body.dataset.theme = saved;
else if (matchMedia("(prefers-color-scheme: light)").matches) document.body.dataset.theme = "light";
themeBtn.addEventListener("click", () => {
  const next = document.body.dataset.theme === "light" ? "dark" : "light";
  document.body.dataset.theme = next;
  localStorage.setItem("tracer-theme", next);
});
const theme = () => document.body.dataset.theme || "dark";

/* ---------------- State ---------------- */
const resultEl = $("#result");
const tooltip = $("#tooltip");
let state = null;       // { parsed, data, stats, deal, fc }
let activeRange = 365;
let fetchToken = 0;

function rangeSlice(series, days) {
  return days >= series.length ? series : series.slice(series.length - days);
}

/* ---------------- Search flow ---------------- */
async function run(rawInput) {
  const parsed = parseQuery(rawInput);
  if (!parsed.title) { input.focus(); return; }

  const token = ++fetchToken;
  activeRange = 365;
  showSkeleton(parsed);

  let data;
  try {
    data = await getPriceData(parsed);
  } catch (err) {
    if (token !== fetchToken) return;
    resultEl.innerHTML = `<div class="card empty"><p>Couldn't load prices for “${escapeHtml(parsed.title)}”. Please try again.</p></div>`;
    return;
  }
  if (token !== fetchToken) return; // a newer search superseded this one

  state = { parsed, data };
  draw();
  location.hash = encodeURIComponent(parsed.title);
  pushRecent(parsed.title, state.stats?.current?.price ?? null, data.source, data.image ?? null);
}

function showSkeleton(parsed) {
  const detect = parsed.kind === "url"
    ? `<div class="detect">${ICON.info}<span>Detected: <strong>${escapeHtml(parsed.title)}</strong>${parsed.retailer ? ` from ${escapeHtml(parsed.retailer)}` : ""}</span></div>`
    : "";
  resultEl.hidden = false;
  resultEl.innerHTML = `
    ${detect}
    <div class="card item-head skeleton">
      <div class="item-id"><div class="sk" style="height:22px;width:55%"></div><div class="sk" style="height:14px;width:35%;margin-top:10px"></div></div>
      <div class="sk" style="height:42px;width:130px"></div>
    </div>
    <div class="stats skeleton">${"<div class=\"card stat\"><div class=\"sk\" style=\"height:58px\"></div></div>".repeat(4)}</div>
    <div class="card chart-card skeleton"><div class="sk" style="height:240px"></div></div>`;
}

/* ---------------- Render ---------------- */
function draw() {
  const { parsed, data } = state;
  const series = rangeSlice(data.series, activeRange);
  const stats = computeStats(series);
  const deal = dealScore(stats);
  const fc = forecast(stats, new Date());
  const verdict = buildVerdict(stats, deal, fc);
  state.stats = stats; state.deal = deal; state.fc = fc;

  const offers = buildOffers(parsed, stats.current.price, data.seed);
  const cheapest = offers.find((o) => o.best);
  const title = parsed.title;

  let sourceBadge, notice = "";
  if (data.source === SOURCE.LIVE) {
    sourceBadge = `<span class="src live">● Live</span>`;
  } else if (data.source === SOURCE.LIVE_CURRENT) {
    sourceBadge = `<span class="src live">● Live price</span>`;
    notice = `<div class="card notice info reveal d1">${ICON.info}
      <p><strong>Live current price${data.retailer ? ` from ${escapeHtml(data.retailer)}` : ""}.</strong>
      The chart is an estimated trend anchored to today's real price — history isn't live.</p></div>`;
  } else {
    sourceBadge = `<span class="src sample">Sample data</span>`;
    notice = `<div class="card notice warn reveal d1">${ICON.info}
      <p><strong>These prices are simulated, not live.</strong>
      Tracer is showing demo data. Connect a free price source (see the
      <a href="https://github.com/evanavery-svg/01010000/tree/main/proxy" target="_blank" rel="noopener">proxy setup</a>)
      to show real prices.</p></div>`;
  }
  const fromBadge = parsed.kind === "url" && parsed.retailer
    ? `<span class="src">from ${escapeHtml(parsed.retailer)}</span>` : "";

  const imgHtml = data.image
    ? `<div class="prod-img-wrap"><img class="prod-img" src="${escapeHtml(data.image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.prod-img-wrap').remove()"/></div>`
    : "";

  resultEl.innerHTML = `
    ${notice}
    <div class="card item-head reveal d1">
      ${imgHtml}
      <div class="item-id">
        <span class="verdict ${verdict.cls}"><span class="pulse"></span>${verdict.label}</span>
        <h2 class="item-name">${escapeHtml(title)}</h2>
        <p class="item-sub">${escapeHtml(data.category)} ${sourceBadge} ${fromBadge}</p>
      </div>
      <div class="price-now">
        <span class="label">Current price</span>
        <span class="val">${fmt.format(stats.current.price)}</span>
        <span class="delta ${stats.weekDelta >= 0 ? "up" : "down"}">${stats.weekDelta >= 0 ? "▲" : "▼"} ${pct1(stats.weekDelta)} this week</span>
      </div>
      ${scoreGauge(deal)}
    </div>

    <div class="stats reveal d2">
      ${stat("lo", "Yearly low", fmt.format(stats.lo.price), dateShort(new Date(stats.lo.t)))}
      ${stat("hi", "Yearly high", fmt.format(stats.hi.price), dateShort(new Date(stats.hi.t)))}
      ${stat("", "Average", fmt.format(stats.avg), "typical price")}
      ${stat("", "Off peak", pct(stats.offHigh), "below the high")}
    </div>

    <div class="card chart-card reveal d3">
      <div class="chart-head">
        <div class="chart-title">Price history <span>· ${fmt.format(stats.lo.price)}–${fmt.format(stats.hi.price)}</span></div>
        <div class="range" role="tablist" aria-label="Time range">
          ${[["3M", 90], ["6M", 180], ["1Y", 365]].map(([l, d]) =>
            `<button type="button" data-days="${d}" class="${d === activeRange ? "on" : ""}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="chart-wrap" id="chartWrap"></div>
      <div class="chart-foot">
        <div class="legend">
          <span><i class="sw line"></i>Price</span>
          <span><i class="sw avg"></i>Average</span>
          ${activeRange === 365 && fc ? `<span><i class="sw proj"></i>Forecast</span>` : ""}
        </div>
        <div class="actions">
          <button class="act" data-act="share" type="button" title="Share">${ICON.share}<span>Share</span></button>
          <button class="act" data-act="png" type="button" title="Save image">${ICON.image}<span>PNG</span></button>
          <button class="act" data-act="csv" type="button" title="Export CSV">${ICON.csv}<span>CSV</span></button>
        </div>
      </div>
    </div>

    <div class="card insight reveal d3">
      <div class="insight-ico">${ICON.spark}</div>
      <div>
        <p>${verdict.line}</p>
        ${fc ? `<p class="forecast">Forecast: next likely dip is <strong>${fc.name}</strong> (~${fc.days} days), typically around <strong>${fmt.format(fc.expected)}</strong>${fc.savings > 0 ? ` — about <strong>${fmt.format(fc.savings)}</strong> (${pct(fc.savingsPct)}) less than today` : ""}.</p>` : ""}
      </div>
    </div>

    <div class="card compare reveal d3">
      <div class="compare-head">
        <h3>Compare retailers</h3>
        <span class="compare-best">Best: <strong>${fmt.format(cheapest.price)}</strong> at ${escapeHtml(cheapest.name)}</span>
      </div>
      <div class="offers">
        ${offers.map((o) => offerRow(o, cheapest.price)).join("")}
      </div>
      <p class="compare-note">Prices are indicative; tap a retailer to see its live listing.</p>
    </div>
  `;

  resultEl.hidden = false;
  drawChart($("#chartWrap"), series, stats, {
    tooltip,
    projection: activeRange === 365 && fc ? fc.projection : null,
  });

  // range toggles
  resultEl.querySelectorAll(".range button").forEach((b) =>
    b.addEventListener("click", () => { activeRange = +b.dataset.days; draw(); }));

  // export / share actions
  resultEl.querySelectorAll(".act").forEach((b) =>
    b.addEventListener("click", () => handleAction(b)));
}

async function handleAction(btn) {
  const act = btn.dataset.act;
  const { parsed, stats, fc } = state;
  const series = rangeSlice(state.data.series, activeRange);
  try {
    if (act === "share") {
      const r = await shareItem(parsed.title);
      if (r === "copied") flash(btn, "Link copied");
      else if (r === "shared") flash(btn, "Shared");
    } else if (act === "csv") {
      exportCSV(parsed.title, state.data.series);
      flash(btn, "Saved CSV");
    } else if (act === "png") {
      flash(btn, "Rendering…");
      await exportPNG(parsed.title, series, stats, theme(), activeRange === 365 && fc ? fc.projection : null);
      flash(btn, "Saved PNG");
    }
  } catch {
    flash(btn, "Failed");
  }
}

function flash(btn, msg) {
  const label = btn.querySelector("span");
  if (!label) return;
  const prev = label.textContent;
  label.textContent = msg;
  btn.classList.add("ok");
  setTimeout(() => { label.textContent = prev; btn.classList.remove("ok"); }, 1600);
}

/* ---------------- Small render helpers ---------------- */
function stat(cls, k, v, meta) {
  return `<div class="card stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="meta">${meta}</div></div>`;
}

function scoreGauge(deal) {
  const R = 30, C = 2 * Math.PI * R;
  const off = C * (1 - deal.score / 100);
  return `<div class="gauge ${deal.cls}" title="Deal score ${deal.score} out of 100">
    <div class="g-ring">
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r="${R}" class="g-track"/>
        <circle cx="38" cy="38" r="${R}" class="g-val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 38 38)"/>
      </svg>
      <div class="g-num">${deal.score}</div>
    </div>
    <div class="g-meta">
      <span class="g-label">${deal.label}</span>
      <span class="g-cap">Deal score · ${deal.score}/100</span>
    </div>
  </div>`;
}

function offerRow(o, bestPrice) {
  const diff = o.price - bestPrice;
  return `<a class="offer ${o.best ? "best" : ""} ${o.inStock ? "" : "oos"}" href="${o.url}" target="_blank" rel="noopener">
    <span class="r-badge" style="--rc:${o.color}">${escapeHtml(o.name[0])}</span>
    <span class="r-main">
      <span class="r-name">${escapeHtml(o.name)} ${o.best ? `<span class="tag">Best price</span>` : ""}</span>
      <span class="r-sub">${o.inStock ? o.shipping : "Out of stock"}</span>
    </span>
    <span class="r-price">
      <span class="r-val">${fmt.format(o.price)}</span>
      ${!o.best && o.inStock ? `<span class="r-diff">+${fmt.format(diff)}</span>` : ""}
    </span>
    <span class="r-go">${ICON.arrow}</span>
  </a>`;
}

const ICON = {
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>`,
  csv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M12 18v-6M9 15l3 3 3-3"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4.5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  trend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-7"/><path d="M21 8V5h-3"/></svg>`,
};

/* ---------------- Feature 7: deal feed ---------------- */
const POOL = ["AirPods Pro", "PlayStation 5", "MacBook Air", "Nintendo Switch", "Dyson V15",
  "iPad", "Sony WH-1000XM5", "Apple Watch", "Kindle", "GoPro", "iPhone 15", "4K OLED TV",
  "Mechanical Keyboard", "Espresso Machine", "Xbox Series X"];

async function renderDeals() {
  const host = $("#deals");
  if (!host) return;
  // rotate the selection daily, then surface the best-scoring items
  const dayseed = Math.floor(Date.now() / 86400000);
  const shuffled = [...POOL].sort((a, b) =>
    ((dayseed * 9301 + a.length * 49297) % 233280) - ((dayseed * 9301 + b.length * 49297) % 233280));

  // Always modeled — a discovery teaser that never hammers a live API.
  const scored = shuffled.slice(0, 9).map((name) => {
    const data = generateSeries(name);
    const stats = computeStats(data.series);
    return { name, data, stats, deal: dealScore(stats) };
  });
  scored.sort((a, b) => b.deal.score - a.deal.score);
  const top = scored.slice(0, 6);

  host.innerHTML = `
    <div class="deals-head">
      <h2>Trending <span>now</span> <span class="sample-tag">sample</span></h2>
      <p>Deal scores on popular items — green is a good time to buy, red means wait.</p>
    </div>
    <div class="deal-grid">
      ${top.map((d) => `
        <button class="card deal-card" type="button" data-q="${escapeHtml(d.name)}">
          <div class="deal-top">
            <span class="deal-name">${escapeHtml(d.name)}</span>
            <span class="deal-score ${d.deal.cls}">${d.deal.score}</span>
          </div>
          <div class="deal-price">${fmt.format(d.stats.current.price)}
            <span class="deal-off">${pct(d.stats.offHigh)} off peak</span>
          </div>
          ${sparkline(d.data.series.slice(-120), dealColor(d.deal.cls))}
        </button>`).join("")}
    </div>`;

  host.querySelectorAll(".deal-card").forEach((c) =>
    c.addEventListener("click", () => { input.value = c.dataset.q; run(c.dataset.q); scrollToResult(); }));
}
function dealColor(cls) {
  return cls === "buy" ? "#34c759" : cls === "wait" ? "#ff5a5a" : "var(--orange)";
}

/* ---------------- Recent / suggestions ---------------- */
const DEFAULTS = ["AirPods Pro", "PlayStation 5", "MacBook Air", "Nintendo Switch", "Dyson V15"];

// Stored as [{ q, price, live }]; tolerates the old string-only format.
function getRecent() {
  try {
    return JSON.parse(localStorage.getItem("tracer-recent") || "[]")
      .map((x) => (typeof x === "string" ? { q: x, price: null, live: false } : x))
      .filter((x) => x && x.q);
  } catch { return []; }
}
function pushRecent(q, price, source, image) {
  let list = getRecent().filter((x) => x.q.toLowerCase() !== q.toLowerCase());
  list.unshift({ q, price: price ?? null, live: source && source !== SOURCE.ESTIMATE, image: image ?? null });
  list = list.slice(0, 6);
  localStorage.setItem("tracer-recent", JSON.stringify(list));
  renderRecent();
  buildAcPool();
}
function clearRecent() {
  localStorage.removeItem("tracer-recent");
  renderRecent();
  buildAcPool();
}

// Quick-start chips: static discovery prompts (recents get their own section).
function renderSuggests() {
  const box = $("#suggests");
  box.innerHTML = `<span class="chip ghost">Try</span>` +
    DEFAULTS.map((x) => `<button class="chip" type="button">${escapeHtml(x)}</button>`).join("");
  box.querySelectorAll("button.chip").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.textContent; run(b.textContent); scrollToResult(); }));
}

/* ---------------- Recently viewed (Feature 3) ---------------- */
function renderRecent() {
  const host = $("#recent");
  if (!host) return;
  const list = getRecent();
  if (!list.length) { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;
  host.innerHTML = `
    <div class="recent-head">
      <h2>Recently viewed</h2>
      <button class="recent-clear" type="button">Clear</button>
    </div>
    <div class="recent-grid">
      ${list.map((r) => `
        <button class="recent-card" type="button" data-q="${escapeHtml(r.q)}">
          ${r.image
            ? `<img class="rc-img" src="${escapeHtml(r.image)}" alt="" aria-hidden="true" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
            : `<span class="rc-ico">${ICON.clock}</span>`}
          <span class="rc-main">
            <span class="rc-name">${escapeHtml(r.q)}</span>
            <span class="rc-price">${r.price != null
              ? `${fmt.format(r.price)}${r.live ? ` · <span class="rc-live">live</span>` : ""}`
              : "Tap to check"}</span>
          </span>
        </button>`).join("")}
    </div>`;
  host.querySelector(".recent-clear").addEventListener("click", clearRecent);
  host.querySelectorAll(".recent-card").forEach((c) =>
    c.addEventListener("click", () => { input.value = c.dataset.q; run(c.dataset.q); scrollToResult(); }));
}

/* ---------------- Autocomplete (Feature 1) ---------------- */
const acEl = $("#autocomplete");
let acPool = [];      // [{ label, kind:'recent'|'popular', price }]
let acVisible = [];   // currently shown subset
let acIndex = -1;

function buildAcPool() {
  const recent = getRecent().map((r) => ({ label: r.q, kind: "recent", price: r.price }));
  const seen = new Set(recent.map((r) => r.label.toLowerCase()));
  const popular = POOL
    .filter((p) => !seen.has(p.toLowerCase()))
    .map((p) => ({ label: p, kind: "popular", price: null }));
  acPool = [...recent, ...popular];
}

function highlight(label, q) {
  const i = label.toLowerCase().indexOf(q);
  if (i < 0) return escapeHtml(label);
  return escapeHtml(label.slice(0, i)) +
    `<span class="ac-hit">${escapeHtml(label.slice(i, i + q.length))}</span>` +
    escapeHtml(label.slice(i + q.length));
}

function renderAc(raw) {
  const q = raw.trim().toLowerCase();
  // A pasted URL isn't a thing to autocomplete.
  if (/^(https?:\/\/|www\.)/i.test(raw)) { hideAc(); return; }
  acVisible = (q ? acPool.filter((x) => x.label.toLowerCase().includes(q)) : acPool).slice(0, 6);
  acIndex = -1;
  if (!acVisible.length) { hideAc(); return; }
  acEl.innerHTML = acVisible.map((x, i) => `
    <li class="ac-item" role="option" id="ac-opt-${i}" data-i="${i}" aria-selected="false">
      <span class="ac-ico">${x.kind === "recent" ? ICON.clock : ICON.trend}</span>
      <span class="ac-label">${q ? highlight(x.label, q) : escapeHtml(x.label)}</span>
      ${x.price != null ? `<span class="ac-price">${fmt.format(x.price)}</span>` : ""}
    </li>`).join("");
  acEl.hidden = false;
  input.setAttribute("aria-expanded", "true");
  acEl.querySelectorAll(".ac-item").forEach((li) => {
    li.addEventListener("mousedown", (e) => { e.preventDefault(); chooseAc(+li.dataset.i); });
    li.addEventListener("mouseenter", () => setAcIndex(+li.dataset.i));
  });
}
function setAcIndex(i) {
  acIndex = i;
  acEl.querySelectorAll(".ac-item").forEach((li, n) => {
    const on = n === i;
    li.classList.toggle("active", on);
    li.setAttribute("aria-selected", on ? "true" : "false");
  });
  input.setAttribute("aria-activedescendant", i >= 0 ? `ac-opt-${i}` : "");
}
function hideAc() {
  acEl.hidden = true; acIndex = -1;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}
function chooseAc(i) {
  const item = acVisible[i];
  if (!item) return;
  input.value = item.label;
  hideAc();
  run(item.label);
  scrollToResult();
}

function scrollToResult() {
  requestAnimationFrame(() => resultEl.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/* ---------------- Form + routing ---------------- */
const form = $("#searchForm");
const input = $("#searchInput");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  hideAc();
  input.blur();
  run(q);
  scrollToResult();
});

// Autocomplete interactions
input.addEventListener("input", () => renderAc(input.value));
input.addEventListener("focus", () => { if (!input.value.trim()) renderAc(""); });
input.addEventListener("keydown", (e) => {
  if (acEl.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); setAcIndex(Math.min(acIndex + 1, acVisible.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setAcIndex(Math.max(acIndex - 1, 0)); }
  else if (e.key === "Enter" && acIndex >= 0) { e.preventDefault(); chooseAc(acIndex); }
  else if (e.key === "Escape") { hideAc(); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) hideAc(); });
window.addEventListener("hashchange", () => {
  const h = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  if (h && (!state || state.parsed.title.toLowerCase() !== h.toLowerCase())) { input.value = h; run(h); }
});

if (isLive()) $(".data-note")?.setAttribute("hidden", "");

renderSuggests();
renderRecent();
buildAcPool();
renderDeals();
const initial = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
if (initial) { input.value = initial; run(initial); }

/* ---------------- PWA: service worker + install ---------------- */
if ("serviceWorker" in navigator) {
  // Auto-reload once when a new version takes control of the page.
  // Guard against the first install (no prior controller) and reload loops.
  let refreshing = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    location.reload();
  });
  addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
let deferredPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e;
  if (sessionStorage.getItem("tracer-install-dismissed")) return;
  showInstallToast();
});
function showInstallToast() {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<p>Install Tracer for one-tap access</p><button class="install-btn" type="button">Install</button><button class="dismiss" aria-label="Dismiss">×</button>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const close = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 500); };
  t.querySelector(".install-btn").addEventListener("click", async () => { close(); if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } });
  t.querySelector(".dismiss").addEventListener("click", () => { sessionStorage.setItem("tracer-install-dismissed", "1"); close(); });
}
