import { chromium } from 'playwright';

const base = 'http://localhost:8137/index.html';
const mock = 'http://localhost:8787';
const out = '/tmp/claude-0/-home-user-01010000/4c67ba18-4928-51be-9111-2152ea75aef4/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

function ctxFor(device) {
  return browser.newContext({ ...device, permissions: ['clipboard-read', 'clipboard-write'] });
}
function watch(page) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
}
async function search(page, q) {
  await page.fill('#searchInput', q);
  await page.click('.search-btn');
  await page.waitForSelector('#result:not([hidden]) .chart-svg');
  await page.waitForTimeout(1300);
}
const desktop = { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const assert = (c, m) => { if (!c) { errors.push('[assert] ' + m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// 1) Landing + deal feed
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#deals .deal-card');
  const n = await page.$$eval('#deals .deal-card', els => els.length);
  console.log('DEALS rendered:', n);
  assert(n === 6, 'deal feed shows 6 cards');
  assert(await page.$('.sample-tag') !== null, 'deal feed has a "sample" tag');
  await page.screenshot({ path: `${out}/landing-dark.png` });
  await ctx.close();
}

// 2) SAMPLE (default) mode — must be clearly labelled
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await search(page, 'AirPods Pro');
  const info = await page.evaluate(() => ({
    src: document.querySelector('.src')?.textContent.trim(),
    notice: document.querySelector('.notice.warn')?.textContent.replace(/\s+/g, ' ').trim(),
    price: document.querySelector('.price-now .val')?.textContent,
  }));
  console.log('SAMPLE MODE:', JSON.stringify(info));
  assert(info.src === 'Sample data', 'source badge says "Sample data"');
  assert(/simulated, not live/i.test(info.notice || ''), 'warning banner explains prices are simulated');
  await page.screenshot({ path: `${out}/result-sample.png`, fullPage: true });
  await ctx.close();
}

// 3) LIVE mode via the mock proxy — real current price flows through
{
  const expected = await fetch(`${mock}/?q=${encodeURIComponent('AirPods Pro')}`).then(r => r.json());
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(`${base}?api=${encodeURIComponent(mock)}`, { waitUntil: 'networkidle' });
  await search(page, 'AirPods Pro');
  const info = await page.evaluate(() => ({
    src: document.querySelector('.src.live')?.textContent.trim(),
    notice: document.querySelector('.notice.info')?.textContent.replace(/\s+/g, ' ').trim(),
    price: document.querySelector('.price-now .val')?.textContent,
    lastPoint: window.__lastChartPoint || null,
  }));
  const shown = parseFloat((info.price || '').replace(/[^0-9.]/g, ''));
  console.log('LIVE MODE:', JSON.stringify(info), 'expected current', expected.current);
  assert(/Live price/i.test(info.src || ''), 'source badge says "Live price"');
  assert(Math.abs(shown - expected.current) < 0.02, `headline price (${shown}) equals real current (${expected.current})`);
  assert(/anchored to today/i.test(info.notice || ''), 'banner explains the chart is anchored to the real price');
  await page.screenshot({ path: `${out}/result-live.png`, fullPage: true });
  await ctx.close();
}

// 4) URL paste + exports + range (regression)
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  page.on('download', d => console.log('DOWNLOAD:', d.suggestedFilename()));
  await page.goto(base, { waitUntil: 'networkidle' });
  await search(page, 'https://www.amazon.com/Apple-AirPods-Pro-2nd-Generation/dp/B0BDHWDR12');
  const sub = await page.$eval('.item-sub', e => e.textContent.replace(/\s+/g, ' ').trim());
  console.log('URL RESULT sub:', sub);
  assert(/from Amazon/i.test(sub), 'URL paste detects retailer');
  await page.click('.range button[data-days="90"]'); await page.waitForTimeout(700);
  await page.click('.range button[data-days="365"]'); await page.waitForTimeout(700);
  await page.click('.act[data-act="csv"]'); await page.waitForTimeout(300);
  await page.click('.act[data-act="png"]'); await page.waitForTimeout(1000);
  await ctx.close();
}

// 5) Phone, light
{
  const ctx = await ctxFor(phone); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.body.dataset.theme = 'light'; });
  await search(page, 'PlayStation 5');
  await page.screenshot({ path: `${out}/result-phone-light.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (errors.length) { console.log('\nFAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('\nOK all assertions passed, no JS errors');
