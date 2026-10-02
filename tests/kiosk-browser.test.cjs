// Run with Node.js and Playwright installed: node --test tests/kiosk-browser.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

test('Kiosk keyboard, reset, print lifecycle, stale searches, and normal mode', async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/search.html`;
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const errors = [];
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1024}, reducedMotion:'reduce'});
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.googletagmanager.com/**', route => route.abort());
    await page.route('**/data/*.json', route => route.fulfill({json:[{deadName:'홍길동',ensNo:'1추모의집-01실-001',strDate:'2026-01-01'}]}));
    await page.clock.install();
    await page.goto(url + '?kiosk=1');
    assert.equal(await page.locator('.tab-btn.active').getAttribute('data-mode'), 'memorial');
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'memorial');
    assert.equal(await page.locator('.kiosk-search-actions .kiosk-keyboard-toggle').textContent(), '키보드 열기');
    const input = page.locator('#keyword');
    const key = text => page.locator('.kiosk-key').filter({hasText:new RegExp('^' + text + '$')});
    await page.locator('.kiosk-keyboard-toggle').click();
    for (const char of 'ㅎㅗㅇㄱㅣㄹㄷㅗㅇ') await key(char).click();
    assert.equal(await input.inputValue(), '홍길동');
    await key('삭제').click(); assert.equal(await input.inputValue(), '홍길도');
    await key('ㅇ').click();
    await key('검색').click();
    await page.locator('#result tr[data-idx="0"]').waitFor();
    assert.equal(await page.locator('#kioskKeyboard').isVisible(), false);
    await page.locator('#result tr[data-idx="0"]').click();
    assert.equal(await page.locator('#detailModal').evaluate(el => el.open), true);
    await page.clock.fastForward(75_100);
    assert.equal(await page.locator('.kiosk-notice').isVisible(), true);
    assert.match(await page.locator('.kiosk-notice span').textContent(), /^\d{2}초 후에 첫화면으로 돌아갑니다\.$/);
    // The notice must live inside the modal so its button is not inert.
    await page.locator('#detailModal .kiosk-notice button').click();
    await page.clock.fastForward(89_000);
    assert.equal(await input.inputValue(), '홍길동');
    await page.clock.fastForward(1_100);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('#detailModal').evaluate(el => el.open), false);
    assert.equal(await page.locator('#modalName').textContent(), '');
    assert.equal(await page.locator('.tab-btn.active').getAttribute('data-mode'), 'memorial');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#kioskKeyboard').isVisible(), true);
    assert.equal(await page.locator('.kiosk-keyboard-heading').textContent(), '고인명 입력 · 한글 두벌식');
    assert.equal(new URL(page.url()).searchParams.get('kiosk'), '1');

    // Physical keyboard, English, Shift, selection replacement and maxlength.
    await input.fill(''); await input.click();
    await key('한/영').click(); await key('Shift').click(); await key('A').click();
    await key('b').click(); assert.equal(await input.inputValue(), 'Ab');
    await input.evaluate(el => el.setSelectionRange(0, 2));
    await key('c').click(); assert.equal(await input.inputValue(), 'c');
    await input.fill('a'.repeat(50)); await key('d').click(); assert.equal((await input.inputValue()).length, 50);
    await key('전체 지우기').click(); await input.pressSequentially('홍길동');
    await input.press('Enter'); await page.locator('#result tr[data-idx="0"]').waitFor();
    await page.locator('#result tr[data-idx="0"]').click();
    await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('beforeprint')); });
    await page.locator('#printBtn').click();
    await page.clock.fastForward(120_000);
    assert.equal(await input.inputValue(), '홍길동');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('.kiosk-notice span').textContent(), '10초 후에 첫화면으로 돌아갑니다.');
    await page.clock.fastForward(9_000);
    assert.equal(await input.inputValue(), '홍길동');
    await page.clock.fastForward(1_100);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('#kioskKeyboard').isVisible(), true);
    assert.equal(await page.locator('.kiosk-keyboard-heading').textContent(), '고인명 입력 · 한글 두벌식');
    await page.goto(url + '?kiosk=1&mode=nature#nature');
    await page.locator('#globalLogo').click();
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'memorial');
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.locator('#kioskKeyboard').isVisible(), true);

    // A response arriving after reset must never redisplay the previous search.
    await page.goto(url + '?kiosk=1');
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    await page.route('**/data/*.json', async route => { started(); await hold; await route.fulfill({json:[{deadName:'홍길동'}]}); });
    await input.fill('홍길동'); await input.press('Enter'); await startedPromise;
    await page.clock.fastForward(90_100);
    release();
    await page.waitForFunction(() => loadPromiseMemorial === null && loadPromiseNature === null && loadPromiseScat === null);
    assert.equal(await page.locator('#result').textContent(), '');

    // Waiting on an empty first screen never produces a recurring reset notice.
    await page.unroute('**/data/*.json');
    let responseData = [{deadName:'이전이름',ensNo:'01실-00001'}];
    let status = 200, dataRequests = 0;
    await page.route('**/data/*.json', route => {
      dataRequests++;
      return route.fulfill({status,json:responseData});
    });
    await page.goto(url + '?kiosk=1');
    await page.clock.fastForward(90_100);
    assert.equal(await page.locator('.kiosk-notice').isVisible(), false);
    assert.equal(await page.locator('#kioskKeyboard').isVisible(), true);

    // HTTP failure is distinct from a successful empty search, and retry recovers.
    status = 503;
    await input.fill('이전이름'); await input.press('Enter');
    await page.locator('.btn-retry').waitFor();
    assert.match(await page.locator('#result').textContent(), /불러오지 못했습니다/);
    status = 200;
    await page.locator('.btn-retry').click();
    await page.locator('#result tr[data-idx="0"]').waitFor();
    assert.equal(await page.locator('#result tbody tr:first-child td:first-child').textContent(), '이전이름');
    await page.locator('.kiosk-home').click();

    // Periodic replacement applies while idle, then retains old data when offline.
    responseData = [{deadName:'새이름',ensNo:'01실-00002'}];
    await page.clock.fastForward(300_100);
    await page.waitForFunction(() => excelDataMemorial[0]?.deadName === '새이름');
    assert.equal(await page.locator('.kiosk-notice').isVisible(), false);
    status = 503;
    const beforeFailure = dataRequests;
    const refreshFailure = page.waitForResponse(response => response.url().includes('/data/deceased_data.json') && response.status() === 503);
    await page.clock.fastForward(300_100);
    await refreshFailure;
    assert.ok(dataRequests > beforeFailure);
    await input.fill('새이름'); await input.press('Enter');
    await page.locator('#result tr[data-idx="0"]').waitFor();
    assert.equal(await page.locator('#result tbody tr:first-child td:first-child').textContent(), '새이름');

    // Exact names remain visible even when more than 100 partial matches precede them.
    status = 200;
    responseData = [...Array.from({length:101}, (_,i) => ({deadName:'홍길동' + i,ensNo:'01실-00001'})), {deadName:'홍길동',ensNo:'01실-00002'}];
    await page.goto(url + '?kiosk=1');
    await input.fill('홍길동'); await input.press('Enter');
    await page.locator('#result tr[data-idx="0"]').waitFor();
    assert.equal(await page.locator('#result tbody tr:first-child td:first-child').textContent(), '홍길동');
    assert.equal(await page.locator('#result tbody tr').count(), 100);
    assert.match(await page.locator('.result-title').textContent(), /102건/);
    assert.equal(await page.locator('.table-wrapper').evaluate(el => el.scrollHeight > el.clientHeight), true);
    // Active visitors keep their current snapshot until their session is over.
    responseData = [{deadName:'다른이름'}];
    const activeRequests = dataRequests;
    for (let i = 0; i < 6; i++) {
      await page.clock.fastForward(60_000);
      await page.locator('#keyword').dispatchEvent('input');
    }
    assert.equal(dataRequests, activeRequests);
    assert.equal(await page.locator('#result tbody tr:first-child td:first-child').textContent(), '홍길동');
    await page.locator('.kiosk-home').click();

    // If a visitor starts typing during background fetch, defer applying its data.
    let pendingRefresh;
    await page.route('**/data/deceased_data.json', route => { pendingRefresh = route; });
    const refreshStarted = page.waitForRequest(request => request.url().includes('/data/deceased_data.json'));
    await page.clock.fastForward(300_100);
    await refreshStarted;
    await input.fill('홍길동');
    const refreshResponse = page.waitForResponse(response => response.url().includes('/data/deceased_data.json'));
    await pendingRefresh.fulfill({json:[{deadName:'교체이름'}]});
    await refreshResponse;
    await page.clock.runFor(100);
    await input.press('Enter');
    await page.locator('#result tr[data-idx="0"]').waitFor();
    assert.equal(await page.locator('#result tbody tr:first-child td:first-child').textContent(), '홍길동');
    await page.unroute('**/data/deceased_data.json');

    // A stalled request ends after 10 seconds and offers retry rather than staying busy.
    await page.unroute('**/data/*.json');
    let stalledRoute;
    await page.route('**/data/*.json', route => { stalledRoute = route; });
    await page.goto(url + '?kiosk=1');
    await input.fill('테스트이름'); await input.press('Enter');
    await page.clock.fastForward(10_100);
    await page.locator('.btn-retry').waitFor();
    assert.match(await page.locator('#result').textContent(), /연결이 지연/);
    if (stalledRoute) await stalledRoute.abort().catch(() => {});
    await page.locator('.kiosk-home').click();

    // Check actual opening motion and close spacing on wide, portrait and small screens.
    await page.emulateMedia({reducedMotion:'no-preference'});
    for (const [width,height] of [[1280,1024],[1080,1920],[1366,768],[390,844]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(() => window.kioskController.hideKeyboard());
      await page.clock.runFor(400);
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
      const closedTop = (await page.locator('main').boundingBox()).y;
      await page.locator('.kiosk-keyboard-toggle').evaluate(el => el.click());
      assert.equal(await page.locator('#kioskKeyboard').evaluate(el => el.getAnimations().length), 1);
      assert.equal(await page.locator('#kioskKeyboard').evaluate(el => el.getAnimations()[0].effect.getKeyframes()[0].transform), 'translateY(-24px)');
      await page.clock.runFor(400);
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
      const search = await page.locator('main').boundingBox();
      const keys = await page.locator('#kioskKeyboard').boundingBox();
      assert.ok(search.y < closedTop, 'search panel moves up when opening');
      assert.ok(Math.abs(keys.y - search.y - search.height - (width <= 768 ? 16 : 20)) < 1, 'keyboard stays near search panel without overlap');
    }

    await page.goto(url);
    assert.equal(await page.locator('#kioskKeyboard').count(), 0);
    assert.equal(await input.getAttribute('inputmode'), null);
    await input.fill('일반검색'); await page.clock.fastForward(120_000);
    assert.equal(await input.inputValue(), '일반검색');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
