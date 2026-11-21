const test = require('node:test');
const assert = require('node:assert/strict');
const { pickEmail, decodeCf } = require('../src/pick-email');

test('prefers on-domain role mailbox over others', () => {
  const html = '<p>mail bob@gmail.com or <a href="mailto:Info@Acme.com">us</a> sales@acme.com</p>';
  assert.equal(pickEmail([html], 'acme.com').email, 'info@acme.com');
});
test('ignores junk: images, noreply, placeholder domains', () => {
  const html = 'logo@2x.png noreply@acme.com you@example.com bug@sentry.io';
  assert.equal(pickEmail([html], 'acme.com').email, '');
});
test('handles [at]/(dot) obfuscation', () => {
  assert.equal(pickEmail(['write to hello [at] acme (dot) com'], 'acme.com').email, 'hello@acme.com');
});
test('decodes cloudflare protected emails', () => {
  const key = 0x42;
  const plain = 'info@acme.com';
  const hex = key.toString(16).padStart(2, '0') + [...plain].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCf(hex), plain);
  assert.equal(pickEmail([`<a data-cfemail="${hex}">[email protected]</a>`], 'acme.com').email, plain);
});
test('does not trust an unrelated plain-text address', () => {
  assert.equal(pickEmail(['thanks to jane@webagency.com for the design'], 'acme.com').email, '');
});
test('trusts a third-party mailbox only when published via mailto', () => {
  assert.equal(pickEmail(['<a href="mailto:acme.shop@gmail.com">m</a>'], 'acme.com').email, 'acme.shop@gmail.com');
});
test('searches both pages', () => {
  assert.equal(pickEmail(['', 'contact@acme.com'], 'acme.com').email, 'contact@acme.com');
});
