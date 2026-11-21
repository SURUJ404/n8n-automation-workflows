const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSite } = require('../src/summarize-site');
const { mxVerdict } = require('../src/verify-email');
const { selectLeads } = require('../src/select-leads');

test('summarizeSite pulls title, meta description and headings; ignores scripts', () => {
  const html = `<html><head><title>Acme &amp; Sons Plumbing</title>
    <meta name="description" content="24/7 emergency repairs in Rome">
    <script>var h1="<h1>EVIL</h1>"</script></head>
    <body><h1>Fast <b>repairs</b></h1><h2>Boiler installs</h2><h2>x</h2></body></html>`;
  const s = summarizeSite(html);
  assert.match(s, /Title: Acme & Sons Plumbing/);
  assert.match(s, /Description: 24\/7 emergency repairs in Rome/);
  assert.match(s, /Headings: Fast repairs \| Boiler installs/);
  assert.doesNotMatch(s, /EVIL/);
  assert.equal(summarizeSite(undefined), '');
});

test('mxVerdict', () => {
  const mx = { Status: 0, Answer: [{ type: 15, data: '10 mx.acme.it.' }] };
  assert.deepEqual(mxVerdict('a@acme.it', mx), { ok: true, status: 'mx_ok' });
  assert.equal(mxVerdict('a@nope.it', { Status: 3 }).status, 'no_mx');
  assert.equal(mxVerdict('a@nope.it', { Status: 0 }).status, 'no_mx');
  assert.equal(mxVerdict('a@null.it', { Status: 0, Answer: [{ type: 15, data: '0 .' }] }).status, 'no_mx');
  assert.equal(mxVerdict('bad', mx).status, 'bad_email');
  assert.deepEqual(mxVerdict('a@acme.it', { error: 'timeout' }), { ok: true, status: 'mx_unchecked' });
  assert.deepEqual(mxVerdict('a@acme.it', undefined), { ok: true, status: 'mx_unchecked' });
});

test('maxPerRun caps the batch', () => {
  const places = Array.from({ length: 50 }, (_, i) => ({ title: 'x', website: `https://d${i}.com` }));
  assert.equal(selectLeads(places, { limit: 40, maxPerRun: 30 }).length, 30);
  assert.equal(selectLeads(places, { limit: 40 }).length, 40);
});
