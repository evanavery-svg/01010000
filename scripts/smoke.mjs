import { chromium } from 'playwright';

const base = 'http://localhost:8137/index.html';
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

const desktop = { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

async function search(page, q) {
  await page.fill('#searchInput', q);
  await page.click('.search-btn');
  await page.waitForSelector('#result:not([hidden]) .chart-svg');
  await page.waitForTimeout(1300);
}

// 1) Landing + deal feed (dark)
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#deals .deal-card');
  const deals = await page.$$eval('#deals .deal-card', els => els.map(e => ({
    name: e.querySelector('.deal-name')?.textContent,
    score: e.querySelector('.deal-score')?.textContent,
    price: e.querySelector('.deal-price')?.firstChild?.textContent?.trim(),
    spark: !!e.querySelector('svg.spark'),
  })));
  console.log('DEALS:', JSON.stringify(deals));
  await page.screenshot({ path: `${out}/landing-dark.png` });
  await ctx.close();
}

// 2) Landing light
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.body.dataset.theme = 'light'; });
  await page.waitForSelector('#deals .deal-card');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/landing-light.png` });
  await ctx.close();
}

// 3) Text search result (dark desktop) — full feature check
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await search(page, 'AirPods Pro');
  const info = await page.evaluate(() => ({
    name: document.querySelector('.item-name')?.textContent,
    price: document.querySelector('.price-now .val')?.textContent,
    verdict: document.querySelector('.verdict')?.textContent.trim(),
    source: document.querySelector('.src')?.textContent.trim(),
    score: document.querySelector('.g-num')?.textContent.trim(),
    scoreLabel: document.querySelector('.g-label')?.textContent.trim(),
    offers: document.querySelectorAll('.offer').length,
    best: document.querySelector('.offer.best .r-name')?.textContent.trim(),
    forecast: !!document.querySelector('.insight .forecast'),
    legendProj: !!document.querySelector('.sw.proj'),
    actions: Array.from(document.querySelectorAll('.act')).map(a => a.dataset.act),
  }));
  console.log('TEXT RESULT:', JSON.stringify(info, null, 1));

  // range toggle
  await page.click('.range button[data-days="90"]');
  await page.waitForTimeout(900);
  const onRange = await page.$eval('.range button.on', b => b.textContent);
  console.log('RANGE active after 3M click:', onRange);

  // exports
  page.on('download', d => console.log('DOWNLOAD:', d.suggestedFilename()));
  await page.click('.range button[data-days="365"]'); await page.waitForTimeout(900);
  await page.click('.act[data-act="csv"]'); await page.waitForTimeout(400);
  await page.click('.act[data-act="png"]'); await page.waitForTimeout(1200);
  await page.click('.act[data-act="share"]'); await page.waitForTimeout(400);
  const shareMsg = await page.$eval('.act[data-act="share"] span', s => s.textContent);
  console.log('SHARE button label after click:', shareMsg);

  await page.screenshot({ path: `${out}/result-dark.png`, fullPage: true });
  await ctx.close();
}

// 4) URL paste lookup
{
  const ctx = await ctxFor(desktop); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await search(page, 'https://www.amazon.com/Apple-AirPods-Pro-2nd-Generation/dp/B0BDHWDR12');
  const info = await page.evaluate(() => ({
    name: document.querySelector('.item-name')?.textContent,
    sub: document.querySelector('.item-sub')?.textContent.replace(/\s+/g,' ').trim(),
  }));
  console.log('URL RESULT:', JSON.stringify(info));
  await ctx.close();
}

// 5) Result on phone (light)
{
  const ctx = await ctxFor(phone); const page = await ctx.newPage(); watch(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.body.dataset.theme = 'light'; });
  await search(page, 'PlayStation 5');
  await page.screenshot({ path: `${out}/result-phone-light.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (errors.length) { console.log('JS ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('OK no JS errors');
