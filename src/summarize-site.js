// n8n Code node: "Summarize site" (Run Once for Each Item)
// Boils the homepage down to a few facts the drafting model can safely reference.

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function summarizeSite(html) {
  const src = String(html || '').replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ');
  const title = clean((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const metaTag = src.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*>/i);
  const description = metaTag ? clean((metaTag[0].match(/content=["']([^"']*)["']/i) || [])[1]) : '';
  const headings = [...src.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => clean(m[1])).filter((h) => h.length > 3 && h.length < 120).slice(0, 4);
  const parts = [title && `Title: ${title.slice(0, 120)}`, description && `Description: ${description.slice(0, 240)}`,
    headings.length && `Headings: ${headings.join(' | ')}`].filter(Boolean);
  return parts.join('\n');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { summarizeSite };
if (typeof $input !== 'undefined') {
  return { json: { ...$json, siteSummary: summarizeSite($('Fetch homepage').item.json.data) } };
}
