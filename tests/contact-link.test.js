const test = require('node:test');
const assert = require('node:assert/strict');
const { findContactUrl } = require('../src/contact-link');

test('finds a same-site contact link by href or text', () => {
  assert.equal(findContactUrl('<a href="/contact-us">x</a>', 'https://a.com'), 'https://a.com/contact-us');
  assert.equal(findContactUrl('<a class="n" href="/reach"><span>Get in touch</span></a>', 'https://a.com'), 'https://a.com/reach');
});
test('ignores off-site, mailto and falls back to /contact', () => {
  assert.equal(findContactUrl('<a href="https://other.com/contact">c</a><a href="mailto:a@a.com">Contact</a>', 'https://a.com'), 'https://a.com/contact');
  assert.equal(findContactUrl('', 'https://a.com'), 'https://a.com/contact');
});
