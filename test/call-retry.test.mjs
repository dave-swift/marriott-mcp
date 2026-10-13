// Transient-error retry in MarriottClient.call: which failures get one more try, and which never do.
// Run: node test/call-retry.test.mjs
import assert from 'node:assert/strict';
import { MarriottClient } from '../src/marriott.js';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

const OP = 'phoenixShopDatedSearchByGeoQuery';

/** A client whose browser replays `replies` in order and counts the fetches. */
const clientWith = (...replies) => {
  const browser = { calls: 0, evaluate: async () => replies[browser.calls++] };
  const mi = new MarriottClient(browser, { retryDelayMs: 0 });
  mi.signatures.set(OP, 'sig');
  return { mi, browser };
};

const ok = { status: 200, json: { data: { hit: true } } };

await test('a GraphQL error wrapping an nginx HTML page is retried once', async () => {
  const { mi, browser } = clientWith(
    { status: 200, json: { errors: [{ message: '<html><head><title>404 Not Found</title>' }] } },
    ok,
  );
  assert.deepEqual(await mi.call(OP, {}), { hit: true });
  assert.equal(browser.calls, 2);
});

await test('an HTTP 404 or 5xx is retried once', async () => {
  for (const status of [404, 502, 503]) {
    const { mi, browser } = clientWith({ status, json: null, snippet: '<html>' }, ok);
    assert.deepEqual(await mi.call(OP, {}), { hit: true });
    assert.equal(browser.calls, 2);
  }
});

await test('a transient error that repeats surfaces after the single retry', async () => {
  const bad = { status: 502, json: null, snippet: 'Bad Gateway' };
  const { mi, browser } = clientWith(bad, bad, ok);
  await assert.rejects(mi.call(OP, {}), /HTTP 502/);
  assert.equal(browser.calls, 2);
});

await test('a 403 is Akamai and is never retried', async () => {
  const { mi, browser } = clientWith({ status: 403, json: null, snippet: 'Access Denied' }, ok);
  await assert.rejects(mi.call(OP, {}), /HTTP 403/);
  assert.equal(browser.calls, 1);
});

await test('an ordinary GraphQL error is not retried', async () => {
  const { mi, browser } = clientWith(
    { status: 200, json: { errors: [{ message: 'Variable "$search" got invalid value' }] } },
    ok,
  );
  await assert.rejects(mi.call(OP, {}), /invalid value/);
  assert.equal(browser.calls, 1);
});

console.log(`\n${passed} passed`);
