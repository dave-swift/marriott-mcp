// Flattening a search connection into rows: the primary photo's full URL.
// Run: node test/rows.test.mjs
import assert from 'node:assert/strict';
import { toRows, primaryImageUrl, pickRates, clusterRate, splitCodes } from '../src/marriott.js';
import { resultsTable } from '../src/format.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

const withSquare = (square) => ({ media: { primaryImage: { edges: [{ node: { imageUrls: { square } } }] } } });

test('builds the square photo URL on cache.marriott.com', () => {
  assert.equal(
    primaryImageUrl(withSquare('/is/image/marriotts7prod/lc-lasbl-bellagio-hero-54904:Square')),
    'https://cache.marriott.com/is/image/marriotts7prod/lc-lasbl-bellagio-hero-54904:Square?wid=564&fit=constrain',
  );
});

test('no media, or a path that is not a Scene7 image, gives null', () => {
  assert.equal(primaryImageUrl({}), null);
  assert.equal(primaryImageUrl(undefined), null);
  assert.equal(primaryImageUrl(withSquare(null)), null);
  assert.equal(primaryImageUrl(withSquare('https://example.com/x.jpg')), null);
  assert.equal(primaryImageUrl(withSquare('//evil.example/is/image/x')), null);
});

test('each row carries its image', () => {
  const conn = {
    edges: [
      { node: { property: { id: 'LASBL', basicInformation: { name: 'Bellagio' }, ...withSquare('/is/image/marriotts7prod/a:Square') } } },
      { node: { property: { id: 'LASXX', basicInformation: { name: 'No photo' } } } },
    ],
  };
  const [a, b] = toRows(conn);
  assert.equal(a.image, 'https://cache.marriott.com/is/image/marriotts7prod/a:Square?wid=564&fit=constrain');
  assert.equal(b.image, null);
});

// The three rates a `--rate points` search gets back for each hotel, as Las Vegas
// gave them for 3 nights from 2026-12-10, in each reservation system's order.
const money = (amount) => ({ amount, currency: 'USD', decimalPoint: 2 });
const points = (n) => ({ lengthOfStay: 3, rateCategory: { code: 'Special', value: 'MRW' }, rateModes: { pointsPerUnit: { points: n } }, status: { code: 'AvailableForSale' } });
const p17 = { lengthOfStay: 3, rateCategory: { code: 'Special', value: 'P17' }, rateModes: null, status: { code: 'NotAvailable' } };
const cash = (night, total) => ({ lengthOfStay: 3, membersOnly: false, rateCategory: { code: 'StandardRates', value: null }, rateModes: { lowestAverageRate: { amount: money(night), totalAmount: money(total) } }, status: { code: 'AvailableForSale' } });
const hotel = (id, rates) => ({ node: { property: { id, basicInformation: { name: id } }, rates } });

test('a points search prices every hotel, whatever order its rates come in', () => {
  const rows = toRows({
    edges: [
      hotel('LASBL', [points(390000), p17, cash(56640, 70454)]), // MARSHA: points first
      hotel('LASVW', [p17, points(156000), cash(28531, 36317)]), // DSP: unavailable P17 first
      hotel('LASFI', [cash(23197, 26300), points(125000)]), // ACRS: cash first
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.price, r.totalPerNight, r.status, r.rateCategory, r.points, r.pointsPerNight]),
    [
      ['LASBL', 566.4, 704.54, 'AvailableForSale', 'StandardRates', 390000, 130000],
      ['LASVW', 285.31, 363.17, 'AvailableForSale', 'StandardRates', 156000, 52000],
      ['LASFI', 231.97, 263, 'AvailableForSale', 'StandardRates', 125000, 41667],
    ],
  );
});

test('a standard search has no points', () => {
  const [r] = toRows({ edges: [hotel('LASFI', [cash(23197, 26300)])] });
  assert.equal(r.totalPerNight, 263);
  assert.equal(r.points, null);
  assert.equal(r.pointsPerNight, null);
});

test('a hotel with only an award rate keeps it, and its status', () => {
  const { rate, pointsRate } = pickRates([p17, points(99000)]);
  assert.equal(rate, pointsRate);
  const [r] = toRows({ edges: [hotel('LASEX', [p17, points(99000)])] });
  assert.equal(r.status, 'AvailableForSale');
  assert.equal(r.totalPerNight, null);
  assert.equal(r.pointsPerNight, 33000);
});

test('the results table shows points per night only when there are some', () => {
  const withPoints = toRows({ edges: [hotel('LASBL', [points(390000), p17, cash(56640, 70454)])] });
  assert.match(resultsTable(withPoints), /Points\/night/);
  assert.match(resultsTable(withPoints), /\| 130,000 \|/);
  const without = toRows({ edges: [hotel('LASFI', [cash(23197, 26300)])] });
  assert.doesNotMatch(resultsTable(without), /Points\/night/);
});

// A search for several codes: each comes back as a "Special" rate with the code as its
// value, alongside whatever else was asked for.
const coded = (code, night, total, status = 'AvailableForSale') => ({ ...cash(night, total), rateCategory: { code: 'Special', value: code }, status: { code: status } });

test('several codes in one search send one CLUSTER entry each', () => {
  assert.deepEqual(clusterRate('wrk222, s9r,WRK222'), [
    { type: 'CLUSTER', value: 'WRK222' },
    { type: 'CLUSTER', value: 'S9R' },
  ]);
  assert.deepEqual(splitCodes('A1,,b2 '), ['A1', 'B2']);
});

test('the cheapest bookable code rate prices the hotel, and says which code', () => {
  const [r] = toRows({ edges: [hotel('LASBL', [coded('WRK222', 50000, 60000), coded('S9R', 45000, 54000), coded('ARG444', 30000, 36000, 'NotAvailable'), cash(56640, 70454)])] });
  assert.equal(r.totalPerNight, 540);
  assert.equal(r.rateCode, 'S9R');
  assert.equal(r.rateCategory, 'Special');
});

test('a code rate wins over a cheaper standard rate, which is only the fallback', () => {
  const [r] = toRows({ edges: [hotel('LASBL', [cash(40000, 50000), coded('WRK222', 50000, 60000)])] });
  assert.equal(r.rateCode, 'WRK222');
  assert.equal(r.totalPerNight, 600);
});

test('when no code applies, the standard rate prices the hotel and is marked', () => {
  const rows = toRows({ edges: [hotel('LASBL', [coded('WRK222', 0, 0, 'NotAvailable'), cash(56640, 70454)])] });
  assert.equal(rows[0].rateCode, null);
  assert.equal(rows[0].rateCategory, 'StandardRates');
  const table = resultsTable(rows, { code: 'WRK222,S9R' });
  assert.match(table, /705 USD!/);
  assert.ok(table.includes('none of the codes W****2,S*R applied here'));
});

test('the results table names the winning code, masked, only for several codes', () => {
  const rows = toRows({ edges: [hotel('LASBL', [coded('WRK222', 50000, 60000), cash(56640, 70454)])] });
  const several = resultsTable(rows, { code: 'WRK222,S9R' });
  assert.ok(several.includes('| Code |'));
  assert.ok(several.includes('| W****2 |'));
  assert.ok(!several.includes('WRK222'));
  const one = resultsTable(rows, { code: 'WRK222' });
  assert.ok(!one.includes('| Code |'));
  assert.ok(!one.includes('WRK222'));
});

console.log(`\n${passed} passed`);
