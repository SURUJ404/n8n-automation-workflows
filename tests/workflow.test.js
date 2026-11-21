// Structural checks on the generated workflow + a simulated run of every Code node's n8n adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const wf = require('../workflow/lead-pipeline.json');

const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

test('every connection endpoint exists and names/ids are unique', () => {
  for (const [from, kinds] of Object.entries(wf.connections)) {
    assert.ok(byName[from], `missing source ${from}`);
    for (const outs of Object.values(kinds)) for (const group of outs) for (const c of group) assert.ok(byName[c.node], `missing target ${c.node}`);
  }
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length);
  assert.equal(Object.keys(byName).length, wf.nodes.length);
});

test('no stray secrets or ids from the original project', () => {
  const s = JSON.stringify(wf);
  assert.doesNotMatch(s, /apify_api_|1R706zSxy|Prathmesh|Automate Minds|sk-or-/);
});

test('node positions do not overlap', () => {
  const boxes = wf.nodes.map((n) => {
    const w = n.type === 'n8n-nodes-base.stickyNote' ? n.parameters.width : 240; // typical n8n node width
    const h = n.type === 'n8n-nodes-base.stickyNote' ? n.parameters.height : 140;
    return { name: n.name, x: n.position[0], y: n.position[1], w, h };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
  }
});

test('form defaults: Mode starts as Draft only, all fields required', () => {
  const fields = byName['On form submission'].parameters.formFields.values;
  const mode = fields.find((f) => f.fieldLabel === 'Mode');
  assert.equal(mode.fieldOptions.values[0].option, 'Draft only'); // first option = n8n default
  assert.ok(fields.every((f) => f.requiredField === true));
  assert.equal(fields.length, 6);
});

test('config and sheets nodes use placeholders only', () => {
  const s = JSON.stringify(wf);
  assert.match(s, /REPLACE_WITH_SPREADSHEET_ID/);
  assert.match(s, /REPLACE: Your Name/);
  assert.doesNotMatch(s, /\beyJ[A-Za-z0-9_-]{20}/); // no JWT-looking tokens
});

test('sticky note carries setup instructions', () => {
  const sticky = wf.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote');
  assert.ok(sticky, 'no sticky note');
  assert.match(sticky.parameters.content, /## Lead pipeline — setup/);
  assert.match(sticky.parameters.content, /Import from file/);
  assert.match(sticky.parameters.content, /REPLACE_WITH_SPREADSHEET_ID/);
  assert.match(sticky.parameters.content, /Draft only/);
});

test('every non-trigger node is reachable from the form trigger', () => {
  const seen = new Set(['On form submission']);
  const q = ['On form submission'];
  while (q.length) {
    const n = q.pop();
    for (const outs of Object.values(wf.connections[n] || {})) for (const g of outs) for (const c of g) if (!seen.has(c.node)) { seen.add(c.node); q.push(c.node); }
  }
  for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.stickyNote') assert.ok(seen.has(n.name), `${n.name} unreachable`);
});

// ── simulated execution of the Code nodes ───────────────────────────────
function run(name, { json, nodes }) {
  const src = byName[name].parameters.jsCode;
  const fn = new Function('$input', '$', '$json', src);
  const $ = (n) => nodes[n];
  return fn({}, $, json);
}
const form = { 'Business Type': 'Plumber', 'Location': 'Rome', 'Lead Number': 2, 'What you offer': 'Online booking that fills your calendar', 'Email Style': 'Friendly', Mode: 'Draft only' };
const cfg = { maxSendsPerRun: 1, senderName: 'Sam', senderCompany: 'Flow Co', calendarLink: '', postalAddress: '1 Main St', model: 'm' };
const base = { 'On form submission': { first: () => ({ json: form }) }, Config: { first: () => ({ json: cfg }) } };

test('adapters chain together on sample data', () => {
  const places = [{ title: 'Acme Plumbing', website: 'https://www.acme.it', categoryName: 'Plumber' }, { title: 'Old', website: 'https://known.it' }, { title: 'FB', website: 'https://facebook.com/x' }];
  const sel = run('Select leads', { json: {}, nodes: { ...base, 'Google Places': { all: () => places.map((json) => ({ json })) }, 'Read lead log': { all: () => [{ json: { Domain: 'known.it' } }] } } });
  assert.equal(sel.length, 1);
  const lead = sel[0].json;
  assert.equal(lead.domain, 'acme.it');

  const home = '<a href="/contatti-contact">Contact</a> <a href="mailto:Info@acme.it">mail</a>';
  const link = run('Find contact page', { json: { data: home }, nodes: { 'Each lead': { item: { json: lead } } } });
  assert.equal(link.json.contactUrl, 'https://acme.it/contatti-contact');

  const picked0 = run('Pick email', { json: { data: '' }, nodes: { 'Each lead': { item: { json: lead } }, 'Fetch homepage': { item: { json: { data: home } } } } });
  assert.equal(picked0.json.email, 'info@acme.it');
  const picked = run('Summarize site', { json: picked0.json, nodes: { 'Fetch homepage': { item: { json: { data: '<title>Acme</title>' } } } } });
  assert.match(picked.json.siteSummary, /Title: Acme/);
  assert.equal(picked.json.name, 'Acme Plumbing');
  const good = run('Verify email', { json: { Status: 0, Answer: [{ type: 15, data: '10 mx.acme.it.' }] }, nodes: { 'Summarize site': { item: { json: picked.json } } } });
  assert.equal(good.json.emailOk, true);
  const bad = run('Verify email', { json: { Status: 3 }, nodes: { 'Summarize site': { item: { json: picked.json } } } });
  assert.equal(bad.json.emailOk, false);
  assert.equal(bad.json.status, 'no_mx');

  const prompt = run('Build prompt', { json: picked.json, nodes: base });
  assert.equal(prompt.json.request.messages.length, 2);

  const ok = run('Parse draft', { json: { choices: [{ message: { content: '{"subject":"Booking idea","body":"Hi Acme Plumbing team,\\n\\nHello"}' } }] }, nodes: { ...base, 'Build prompt': { item: { json: prompt.json } } } });
  assert.equal(ok.json.draftSource, 'llm');
  assert.equal(ok.json.email, 'info@acme.it');

  const failed = run('Parse draft', { json: { error: 'boom' }, nodes: { ...base, 'Build prompt': { item: { json: prompt.json } } } });
  assert.equal(failed.json.draftSource, 'fallback');
});
