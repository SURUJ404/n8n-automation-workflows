// n8n Code node: "Find contact page" (Run Once for Each Item)
// Looks through the homepage HTML for a contact-ish link on the same site.

function findContactUrl(html, origin) {
  const base = new URL(origin);
  const anchor = /<a\s[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const wanted = /contact|get[\s-]?in[\s-]?touch|reach[\s-]?us|enquir|inquir/i;
  let m;
  while ((m = anchor.exec(html || ''))) {
    const [, href, inner] = m;
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (!wanted.test(href) && !wanted.test(inner.replace(/<[^>]+>/g, ' '))) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) return u.href;
    } catch { /* ignore malformed href */ }
  }
  return new URL('/contact', base).href; // blind guess; a 404 is harmless
}

if (typeof module !== 'undefined' && module.exports) module.exports = { findContactUrl };
if (typeof $input !== 'undefined') {
  const lead = $('Each lead').item.json;
  const html = typeof $json.data === 'string' ? $json.data : '';
  return { json: { contactUrl: findContactUrl(html, lead.website) } };
}
