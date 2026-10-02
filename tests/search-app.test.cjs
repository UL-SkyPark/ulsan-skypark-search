const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

test('Search installs independently and its worker coexists with the status worker', async () => {
  const root = path.resolve(__dirname,'..');
  const prefix = '/ulsan-skypark-search/';
  const server = http.createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://localhost');
      if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      const file = path.resolve(root,relative);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
      response.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.route('https://www.googletagmanager.com/**',route => route.abort());
    await page.goto(base + 'search.html');
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/search-service-worker.js'));
    const searchManifest = JSON.parse(await fs.readFile(path.join(root,'search.webmanifest'),'utf8'));
    const statusManifest = JSON.parse(await fs.readFile(path.join(root,'manifest.webmanifest'),'utf8'));
    assert.notEqual(new URL(searchManifest.id,base).href,new URL(statusManifest.start_url,base).href);
    assert.equal(new URL(searchManifest.start_url,base).href,base + 'search.html');
    assert.equal(new URL(searchManifest.scope,base).href,base + 'search.html');
    assert.equal(new URL(statusManifest.scope,base).href,base + 'status.html');
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    assert.equal(manifest.url,base + 'search.webmanifest');
    assert.deepEqual(manifest.errors,[]);
    const eligibility = await cdp.send('Page.getInstallabilityErrors');
    // Playwright's isolated context is incognito; only that environment restriction is expected.
    assert.deepEqual(eligibility.installabilityErrors.filter(error => error.errorId !== 'in-incognito'),[]);

    // The original broad status registration must not replace the specific search one.
    await page.evaluate(async () => {
      const status = await navigator.serviceWorker.register('./service-worker.js');
      if (!status.active) await new Promise(resolve => {
        const worker = status.installing || status.waiting;
        worker.addEventListener('statechange',() => { if (worker.state === 'activated') resolve(); });
      });
    });
    const scopes = await page.evaluate(async () => ({
      search:(await navigator.serviceWorker.getRegistration('./search.html')).scope,
      status:(await navigator.serviceWorker.getRegistration('./status.html')).scope,
      cacheKeys:await caches.keys()
    }));
    assert.equal(scopes.search,base + 'search.html');
    assert.equal(scopes.status,base);
    assert.ok(scopes.cacheKeys.includes('ulsan-search-shell-v1'));
    assert.ok(scopes.cacheKeys.includes('ulsan-status-shell-v1'));

    // A real install button only appears once Chrome provides its install prompt.
    await page.evaluate(() => {
      window.installCalls = 0;
      const event = new Event('beforeinstallprompt',{cancelable:true});
      event.prompt = async () => { window.installCalls++; };
      event.userChoice = Promise.resolve({outcome:'accepted'});
      window.dispatchEvent(event);
    });
    await page.locator('.search-install-action').click();
    assert.equal(await page.evaluate(() => window.installCalls),1);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.locator('.search-install').isVisible(),false);

    // Cached search shell opens offline; it never substitutes the status page.
    await context.setOffline(true);
    await page.goto(base + 'search.html?mode=memorial');
    assert.match(await page.title(),/고인 검색/);
    assert.equal(await page.locator('#searchForm').count(),1);
    assert.equal(await page.locator('.tab-btn.active').getAttribute('data-mode'),'memorial');
    await page.locator('#keyword').fill('테스트이름');
    await page.locator('#keyword').press('Enter');
    await page.locator('.btn-retry').waitFor();
    assert.match(await page.locator('#result').textContent(),/불러오지 못했습니다/);
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
