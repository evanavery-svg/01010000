import { chromium } from 'playwright';

const base = 'http://localhost:8137/index.html';
const out = '/tmp/claude-0/-home-user-01010000/4c67ba18-4928-51be-9111-2152ea75aef4/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const errors = [];
async function shot(theme, device, query, file) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(t => { document.body.dataset.theme = t; }, theme);
  if (query) {
    await page.fill('#searchInput', query);
    await page.click('.search-btn');
    await page.waitForSelector('#result:not([hidden]) .chart-svg');
    await page.waitForTimeout(1400); // let the draw animation finish
  }
  await page.screenshot({ path: `${out}/${file}`, fullPage: !!query });
  // sanity: pull the rendered verdict + current price text
  let info = null;
  if (query) {
    info = await page.evaluate(() => ({
      name: document.querySelector('.item-name')?.textContent,
      price: document.querySelector('.price-now .val')?.textContent,
      verdict: document.querySelector('.verdict')?.textContent.trim(),
      low: document.querySelector('.stat.lo .v')?.textContent,
      high: document.querySelector('.stat.hi .v')?.textContent,
      points: document.querySelectorAll('.chart-svg path.price-line').length,
    }));
  }
  await ctx.close();
  return info;
}

const desktop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

console.log('dark/desktop landing');
await shot('dark', desktop, null, 'landing-dark.png');
console.log('light/desktop landing');
await shot('light', desktop, null, 'landing-light.png');
const r1 = await shot('dark', desktop, 'AirPods Pro', 'result-dark.png');
console.log('result dark:', JSON.stringify(r1));
const r2 = await shot('light', phone, 'PlayStation 5', 'result-phone-light.png');
console.log('result phone:', JSON.stringify(r2));
const r3 = await shot('dark', desktop, 'random gizmo 9000', 'result-arbitrary.png');
console.log('arbitrary item:', JSON.stringify(r3));

await browser.close();
if (errors.length) { console.log('JS ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('OK no JS errors');
