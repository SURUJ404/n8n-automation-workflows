const test = require('node:test');
const assert = require('node:assert/strict');
const { selectLeads, hostOf } = require('../src/select-leads');

test('hostOf normalises urls', () => {
  assert.equal(hostOf('https://www.Acme.com/about'), 'acme.com');
  assert.equal(hostOf('acme.com'), 'acme.com');
  assert.equal(hostOf(''), null);
  assert.equal(hostOf(undefined), null);
});

test('drops missing sites, socials, closed, and duplicate domains', () => {
  const places = [
    { title: 'A', website: 'https://www.a.com/x' },
    { title: 'A2', website: 'http://a.com' },
    { title: 'NoSite' },
    { title: 'FB', website: 'https://facebook.com/foo' },
    { title: 'Sub', website: 'https://m.facebook.com/foo' },
    { title: 'Closed', website: 'https://c.com', permanentlyClosed: true },
    { title: 'B', website: 'b.io', categoryName: 'Plumber', totalScore: 4.5 },
  ];
  const out = selectLeads(places, { limit: 10 });
  assert.deepEqual(out.map((l) => l.domain), ['a.com', 'b.io']);
  assert.equal(out[1].website, 'https://b.io');
  assert.equal(out[1].category, 'Plumber');
});

test('drops aggregator and directory profiles', () => {
  const sites = ['foursquare.com/venue/x', 'm.yellowpages.com/y', 'thumbtack.com/z',
    'www.angi.com/a', 'bbb.org/us/b', 'trustpilot.com/review/c', 'nextdoor.com/page',
    'bark.com/en/us/d', 'alignable.com/e'];
  const places = sites.map((website, i) => ({ title: `P${i}`, website: `https://${website}` }));
  places.push({ title: 'Real', website: 'https://realbiz.com' });
  assert.deepEqual(selectLeads(places, { limit: 20 }).map((l) => l.domain), ['realbiz.com']);
});

test('skips known domains and respects the limit', () => {
  const places = [1, 2, 3, 4].map((n) => ({ title: `L${n}`, website: `https://s${n}.com` }));
  const out = selectLeads(places, { limit: 2, knownDomains: ['s1.com'] });
  assert.deepEqual(out.map((l) => l.domain), ['s2.com', 's3.com']);
});

test('limit is clamped', () => {
  const places = Array.from({ length: 150 }, (_, i) => ({ title: 'x', website: `https://d${i}.com` }));
  assert.equal(selectLeads(places, { limit: 9999 }).length, 100);
  assert.equal(selectLeads(places, { limit: 'abc' }).length, 10);
});
