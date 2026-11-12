/* Isolated browser integration tests: use Playwright via NODE_PATH; no real cloud or user profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'finance-test.invalid') return route.abort();
    const files = { '/': 'index.html', '/app.js': 'app.js', '/cloud.js': 'cloud.js', '/tvmaze.js': 'tvmaze.js', '/style.css': 'style.css', '/vendor/lucide.min.js': 'vendor/lucide.min.js' };
    const file = files[url.pathname];
    if (!file) return route.abort();
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ status: 200, contentType, body: fs.readFileSync(path.join(root, file)) });
  });
  await page.goto('http://finance-test.invalid/');
  await page.evaluate(() => {
    const clone = (v) => JSON.parse(JSON.stringify(v));
    window.fake = { row: null, reads: 0, writes: 0, failRead: false, raceUpdate: false };
    cloudClient = {
      auth: { getSession: async () => ({ data: { user: { id: 'test-user', email: 'test@example.invalid' } }, error: null }), signOut: async () => ({}) },
      database: { from() { return {
        select() { return { async limit() {
          fake.reads++;
          if (fake.holdRead) await new Promise((resolve) => { fake.releaseRead = resolve; });
          if (fake.failRead) return { data: null, error: { message: 'offline' } };
          return { data: fake.row ? [clone(fake.row)] : [], error: null };
        } }; },
        update(payload) {
          const filters = {};
          const query = { eq(k, v) { filters[k] = v; return query; }, async select() {
            if (fake.raceUpdate) { fake.row.updated_at = '2026-11-10T00:00:03.000Z'; fake.raceUpdate = false; }
            if (!fake.row || fake.row.id !== filters.id || fake.row.updated_at !== filters.updated_at) return { data: [], error: null };
            fake.writes++; fake.row = { ...fake.row, ...clone(payload) };
            return { data: [clone(fake.row)], error: null };
          } };
          return query;
        },
      }; } },
    };
    Store.data.transactions = [{ id: 'computer-new', type: 'expense', amount: 20, category: '购物', account: 'wechat', date: '2026-11-12', remark: 'test', createdAt: 1 }];
    Store.save();
    const old = clone(Store.data); old.transactions = [];
    fake.row = { id: 'cloud-row', updated_at: '2026-11-10T00:00:00.000Z', payload: old };
  });

  await page.evaluate(() => onCloudSignedIn({ id: 'test-user', email: 'test@example.invalid' }));
  await page.evaluate(() => switchPage('vault'));
  let status = await page.evaluate(() => ({ local: Store.data.transactions.map((t) => t.id), cloud: fake.row.payload.transactions.length, writes: fake.writes, status: cloudStatus, compared: !!cloudComparison }));
  assert.deepEqual(status, { local: ['computer-new'], cloud: 0, writes: 0, status: '待确认', compared: true }, 'login must not overwrite either side');
  await page.evaluate(() => {
    fake.holdRead = true;
    window.pendingComparison = compareCloud();
  });
  await page.waitForFunction(() => typeof fake.releaseRead === 'function');
  await page.evaluate(() => {
    Store.data.transactions[0].remark = 'edited while comparing'; Store.save();
    fake.holdRead = false; fake.releaseRead();
  });
  assert.equal(await page.evaluate(() => window.pendingComparison), false, 'local edits during comparison invalidate its result');
  assert.equal(await page.evaluate(() => !!cloudComparison), false, 'stale comparison must not be retained');
  await page.evaluate(() => { Store.data.transactions[0].remark = 'newer local'; Store.save(); });
  await page.waitForTimeout(1700);
  status = await page.evaluate(() => ({ writes: fake.writes, compared: !!cloudComparison, status: cloudStatus }));
  assert.deepEqual(status, { writes: 0, compared: false, status: '待确认' }, 'local save must never automatically upload');

  await page.evaluate(() => compareCloud());
  assert.equal(await page.locator('#cloudPushBtn').isEnabled(), true, 'existing cloud version supports explicit manual upload');
  await page.locator('#cloudPullBtn').click();
  await page.evaluate(() => { fake.row.updated_at = '2026-11-10T00:00:01.000Z'; });
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '同步失败');
  assert.equal(await page.evaluate(() => fake.writes), 0, 'changed cloud must invalidate confirmation');

  await page.evaluate(() => compareCloud());
  await page.locator('#cloudPullBtn').click();
  await page.evaluate(() => { Store.data.transactions[0].remark = 'changed during confirmation'; Store.save(); });
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '同步失败');
  assert.equal(await page.evaluate(() => Store.data.transactions[0].remark), 'changed during confirmation', 'local edits made while confirming must not be overwritten');

  await page.evaluate(() => compareCloud());
  await page.locator('#cloudPullBtn').click();
  await page.evaluate(() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key.includes('_backup_before_cloud_')) throw new Error('quota'); return originalSet.call(this, key, value); }; });
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '同步失败');
  assert.deepEqual(await page.evaluate(() => Store.data.transactions.map((t) => t.id)), ['computer-new'], 'backup failure must preserve local data');
  await page.evaluate(() => { Storage.prototype.setItem = originalSet; });

  await page.evaluate(() => compareCloud());
  await page.locator('#cloudPullBtn').click();
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '已同步');
  assert.equal(await page.evaluate(() => Store.data.transactions.length), 0, 'explicit restore uses cloud');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes('_backup_before_cloud_') && JSON.parse(localStorage.getItem(k)).transactions.some((t) => t.id === 'computer-new'))), true, 'restore must keep the prior local backup');
  assert.equal(await page.locator('#cloudExportPreviousBtn').count(), 1, 'prior local backup remains available for export');
  assert.equal(await page.evaluate(() => fake.writes), 0, 'restore must not trigger upload');

  await page.evaluate(() => restoreCloudSession());
  assert.equal(await page.evaluate(() => cloudStatus), '已同步', 'restored login only compares equal snapshots');
  assert.equal(await page.evaluate(() => fake.writes), 0, 'restoring a session never writes cloud data');

  await page.evaluate(() => { Store.data.transactions.push({ id: 'new-local', type: 'expense', amount: 5, category: '购物', account: 'wechat', date: '2026-11-12', createdAt: 2 }); Store.save(); });
  await page.evaluate(() => compareCloud());
  await page.locator('#cloudPushBtn').click();
  await page.evaluate(() => { fake.raceUpdate = true; });
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '同步失败');
  assert.equal(await page.evaluate(() => fake.writes), 0, 'conditional update rejects a cloud change during upload');
  await page.evaluate(() => compareCloud());
  await page.locator('#cloudPushBtn').click();
  await page.locator('#modalOk').click();
  await page.waitForFunction(() => cloudStatus === '已同步');
  assert.equal(await page.evaluate(() => fake.writes), 1, 'explicitly confirmed manual upload succeeds');
  assert.equal(await page.evaluate(() => fake.row.payload.transactions[0].id), 'new-local', 'manual upload uses the confirmed snapshot');

  await page.evaluate(() => { fake.row = null; });
  await page.evaluate(() => compareCloud());
  assert.equal(await page.evaluate(() => cloudStatus), '待确认', 'empty cloud requires confirmation and cannot trigger upload');
  assert.equal(await page.locator('#cloudPushBtn').isDisabled(), true, 'empty cloud cannot be initialized without a verified uniqueness constraint');
  assert.equal(await page.evaluate(() => fake.writes), 1);

  await page.evaluate(() => { fake.failRead = true; });
  await page.evaluate(() => compareCloud());
  assert.equal(await page.evaluate(() => cloudStatus), '同步失败', 'network failure shown');
  assert.equal(await page.evaluate(() => Store.data.transactions[0].id), 'new-local', 'network failure keeps local data');
  await page.evaluate(() => {
    fake.failRead = false;
    Store.data.transactions[0].category = '吃饭';
    Store.sanitize();
    Store.save();
    const legacy = JSON.parse(localStorage.getItem(STORE_KEY));
    legacy.transactions[0].category = '餐饮';
    localStorage.setItem(STORE_KEY, JSON.stringify(legacy));
  });
  assert.equal(await page.evaluate(() => compareCloud()), true, 'equivalent historical local data can be compared after isolated normalization');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(STORE_KEY)).transactions[0].category), '餐饮', 'comparison must not rewrite the persisted original');
  await page.evaluate(() => {
    fake.failRead = false;
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }));
  });
  assert.equal(await page.evaluate(() => compareCloud()), false, 'another tab changing the local book requires a reload before comparing');
  assert.deepEqual(errors, []);
  console.log('Cloud safety integration checks passed (mocked cloud, isolated browser).');
  await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
