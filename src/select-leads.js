// n8n Code node: "Select leads" (Run Once for All Items)
// Turns raw Google Places rows into a clean, de-duplicated list of leads.

const BLOCKED_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'yelp.com', 'justdial.com', 'tripadvisor.com',
  'linktr.ee', 'wa.me', 'google.com', 'goo.gl', 'maps.app.goo.gl',
  // social / aggregator / directory profiles that are not the business's own site
  'foursquare.com', 'yellowpages.com', 'thumbtack.com', 'angi.com', 'angieslist.com',
  'bbb.org', 'trustpilot.com', 'nextdoor.com', 'bark.com', 'alignable.com',
];
const MAX_LEADS = 100;

function hostOf(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : 'https://' + raw.trim());
    return u.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function isBlocked(host) {
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith('.' + b));
}

function selectLeads(places, { limit, knownDomains = [], maxPerRun = MAX_LEADS }) {
  const cap = Math.max(1, Math.min(Number(limit) || 10, MAX_LEADS, Number(maxPerRun) || MAX_LEADS));
  const seen = new Set(knownDomains.map((d) => String(d).toLowerCase()));
  const leads = [];
  for (const p of places) {
    if (leads.length >= cap) break;
    if (!p || p.permanentlyClosed || p.temporarilyClosed) continue;
    const host = hostOf(p.website);
    if (!host || isBlocked(host) || seen.has(host)) continue;
    seen.add(host);
    leads.push({
      name: String(p.title || host).trim(),
      domain: host,
      website: 'https://' + host,
      category: p.categoryName || '',
      address: p.address || '',
      phone: p.phone || '',
      rating: p.totalScore ?? '',
      reviews: p.reviewsCount ?? '',
    });
  }
  return leads;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selectLeads, hostOf, isBlocked, MAX_LEADS };
}
if (typeof $input !== 'undefined') {
  const form = $('On form submission').first().json;
  const places = $('Google Places').all().map((i) => i.json);
  const knownDomains = $('Read lead log').all().map((i) => i.json.Domain).filter(Boolean);
  const cfg = $('Config').first().json;
  // In send mode, cap the batch so one run can't blast past the sender's daily limit.
  const maxPerRun = form['Mode'] === 'Send now' ? cfg.maxSendsPerRun : MAX_LEADS;
  return selectLeads(places, { limit: form['Lead Number'], knownDomains, maxPerRun }).map((json) => ({ json }));
}
