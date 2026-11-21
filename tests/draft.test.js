const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest } = require('../src/build-prompt');
const { parseDraft, extractJson } = require('../src/parse-draft');

const lead = { name: 'Acme Plumbing', category: 'Plumber', address: 'Rome', website: 'https://acme.com', rating: 4.6, reviews: 120 };
const cfg = { senderName: 'Sam', senderCompany: 'Flow Co', calendarLink: 'https://cal.example/sam', postalAddress: '1 Main St' };

test('request carries style, offer and facts, and demands JSON', () => {
  const r = buildRequest({ lead, offer: 'automated booking', style: 'Simple', senderName: 'Sam', senderCompany: 'Flow Co', model: 'm' });
  assert.equal(r.response_format.type, 'json_object');
  assert.match(r.messages[0].content, /Three or four short sentences/);
  assert.match(r.messages[1].content, /Acme Plumbing/);
  assert.match(r.messages[1].content, /automated booking/);
});
test('system prompt enforces every drafting rule', () => {
  const s = buildRequest({ lead, offer: 'o', style: 'Friendly', senderName: 's', senderCompany: 'c', model: 'm' }).messages[0].content;
  assert.match(s, /at most 110 words/);            // word cap
  assert.match(s, /Tone: Warm and conversational/); // Email Style drives the tone
  assert.match(s, /Hi <company name> team,/);       // mandated greeting
  assert.match(s, /one concrete sentence/);         // single offer sentence
  assert.match(s, /one low-pressure question/);     // single soft CTA
  assert.match(s, /Do not include a signature.*links/); // no signature/links
  assert.match(s, /Subject under 60 characters/);   // subject cap
  assert.match(s, /Never claim to have followed, used, or studied/); // no fake familiarity
  assert.match(s, /never praise their "impressive work"/);           // no flattery
  assert.match(s, /ONLY the facts provided/);       // supplied facts only
  assert.match(s, /reference ONE of them/);         // at most one Site says fact
});
test('extractJson tolerates code fences and rejects junk', () => {
  assert.deepEqual(extractJson('```json\n{"subject":"S","body":"B"}\n```'), { subject: 'S', body: 'B' });
  assert.equal(extractJson('not json'), null);
  assert.equal(extractJson('{"subject":"","body":"x"}'), null);
});
test('parseDraft adds signature, link and opt-out', () => {
  const out = parseDraft({ content: '{"subject":"Hi","body":"Hello"}', lead, offer: 'o', style: 'Friendly', cfg });
  assert.equal(out.draftSource, 'llm');
  assert.match(out.body, /Best,\nSam\nFlow Co/);
  assert.match(out.body, /cal\.example\/sam/);
  assert.match(out.body, /reply 'no thanks' and I won't email you again/);
  assert.match(out.body, /1 Main St/);
});
test('falls back when the model call failed', () => {
  const out = parseDraft({ content: undefined, lead, offer: 'automated booking', style: 'Professional', cfg });
  assert.equal(out.draftSource, 'fallback');
  assert.match(out.body, /Acme Plumbing/);
  assert.ok(out.subject.length <= 60);
});
test('fallback greetings all use the mandated "Hi <company> team," opener', () => {
  for (const style of ['Friendly', 'Professional', 'Simple']) {
    const out = parseDraft({ content: undefined, lead, offer: 'o', style, cfg });
    assert.match(out.body, /^Hi Acme Plumbing team,/, style);
  }
});

test('site summary reaches the prompt', () => {
  const r = buildRequest({ lead: { ...lead, siteSummary: 'Title: Acme\nHeadings: 24/7 emergency repairs' }, offer: 'o', style: 'Friendly', senderName: 's', senderCompany: 'c', model: 'm' });
  assert.match(r.messages[1].content, /Site says:\nTitle: Acme/);
});
