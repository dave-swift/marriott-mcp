// Flattening a search connection into rows: the primary photo's full URL.
// Run: node test/rows.test.mjs
import assert from 'node:assert/strict';
import { toRows, primaryImageUrl } from '../src/marriott.js';

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

console.log(`\n${passed} passed`);
