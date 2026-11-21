// n8n Code node: "Pick email" (Run Once for Each Item)
// Pulls every email-looking string out of the fetched pages and picks the best one.
// Deterministic on purpose: an LLM that is only handed a URL cannot read the page.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const FILE_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'css', 'js', 'woff', 'woff2', 'ico']);
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|privacy|example|user|name|email|your-?email|test)$/i;
const JUNK_DOMAINS = new Set(['sentry.io', 'wixpress.com', 'example.com', 'domain.com', 'yourdomain.com', 'email.com', 'sentry-next.wixpress.com']);
const PREFERRED = ['info', 'contact', 'hello', 'sales', 'enquiries', 'enquiry', 'office', 'support', 'admin', 'team', 'hi'];

// Cloudflare "email protection": data-cfemail="<hex>", first byte is the XOR key.
function decodeCf(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  } catch {
    return '';
  }
}

function candidates(html) {
  const text = String(html || '');
  const found = new Map(); // email -> viaMailto
  const add = (e, mailto) => {
    const email = e.toLowerCase().replace(/^[^a-z0-9]+|[.]+$/g, '');
    if (!email.includes('@')) return;
    found.set(email, found.get(email) || mailto);
  };
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    let v = m[1];
    try { v = decodeURIComponent(v); } catch { /* keep raw */ }
    add(v, true);
  }
  for (const m of text.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) add(decodeCf(m[1]), true);
  const plain = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');
  for (const m of plain.matchAll(EMAIL_RE)) add(m[0], false);
  return found;
}

function isUsable(email) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (JUNK_LOCAL.test(local) || JUNK_DOMAINS.has(domain)) return false;
  if (FILE_TLDS.has(domain.split('.').pop())) return false;
  if (/^\d+x$/.test(domain.split('.')[0]) || local.length > 64) return false;
  return true;
}

function score(email, viaMailto, siteDomain) {
  const [local, domain] = email.split('@');
  let s = 0;
  if (domain === siteDomain || domain.endsWith('.' + siteDomain)) s += 10;
  const i = PREFERRED.indexOf(local);
  if (i >= 0) s += 8 - i * 0.5;
  if (viaMailto) s += 2;
  return s;
}

function pickEmail(pages, siteDomain) {
  const all = new Map();
  for (const html of pages) for (const [e, mailto] of candidates(html)) all.set(e, all.get(e) || mailto);
  const ranked = [...all.entries()]
    .filter(([e]) => isUsable(e))
    .map(([e, mailto]) => ({ email: e, score: score(e, mailto, siteDomain) }))
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));
  // Only trust addresses on the company's own domain, or a mailbox it published via mailto.
  const best = ranked.find((r) => r.score >= 10 || all.get(r.email));
  return { email: best ? best.email : '', alternatives: ranked.slice(0, 5).map((r) => r.email) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { pickEmail, candidates, isUsable, decodeCf };
if (typeof $input !== 'undefined') {
  const lead = $('Each lead').item.json;
  const home = $('Fetch homepage').item.json.data;
  const contact = $json.data;
  const { email, alternatives } = pickEmail([home, contact], lead.domain);
  return { json: { ...lead, email, alternatives: alternatives.join(', ') } };
}
