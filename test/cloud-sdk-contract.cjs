/* Audits the official SDK against an in-memory fake endpoint; no cloud credentials or network. */
const assert = require('node:assert/strict');
const path = require('node:path');
const sdkDir = process.env.WORKBUDDY_SDK_DIR;
if (!sdkDir) throw new Error('Set WORKBUDDY_SDK_DIR to the extracted audited SDK package directory.');
const sdk = require(path.join(sdkDir, 'lib', 'index.cjs'));

async function main() {
  const requests = [];
  const server = { updated_at: '2026-11-10T00:00:00.000Z', payload: { value: 'old' } };
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    requests.push({ url: u, method: init.method, prefer: headers.get('prefer'), body });
    const matched = u.searchParams.get('id') === 'eq.1' && u.searchParams.get('updated_at') === `eq.${server.updated_at}`;
    if (matched) Object.assign(server, body);
    return new Response(JSON.stringify(matched ? [{ id: 1, ...server }] : []), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cloud = sdk.createWorkBuddyCloud({ endpoint: 'https://example.invalid', publishableKey: 'wbpk_test_test', storage: sdk.createMemoryStorage(), fetch });
  const update = (value, version) => cloud.database.from('finance_state').update({ payload: { value }, updated_at: '2026-11-10T00:00:01.000Z' }).eq('id', 1).eq('updated_at', version).select();
  const first = await update('first', '2026-11-10T00:00:00.000Z');
  const stale = await update('stale', '2026-11-10T00:00:00.000Z');
  assert.equal(first.error, null);
  assert.equal(first.data.length, 1);
  assert.equal(stale.data.length, 0);
  assert.equal(server.payload.value, 'first');
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].url.searchParams.get('id'), 'eq.1');
  assert.equal(requests[0].url.searchParams.get('updated_at'), 'eq.2026-11-10T00:00:00.000Z');
  assert.match(requests[0].prefer, /return=representation/);
  console.log('Official SDK request contract passed against a fake endpoint; real server behavior remains unverified.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
