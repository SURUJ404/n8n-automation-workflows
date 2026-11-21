// n8n Code node: "Verify email" (Run Once for Each Item)
// Reads the DNS-over-HTTPS MX answer for the email's domain. Fails closed only on a definite "no mail server".

const SYNTAX = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

function mxVerdict(email, dns) {
  if (!SYNTAX.test(email || '')) return { ok: false, status: 'bad_email' };
  if (!dns || dns.error || typeof dns.Status !== 'number') return { ok: true, status: 'mx_unchecked' }; // lookup failed: don't punish the lead
  if (dns.Status === 3) return { ok: false, status: 'no_mx' }; // NXDOMAIN
  const mx = (dns.Answer || []).filter((a) => a.type === 15 && !/^\d+\s+\.?$/.test(String(a.data).trim()));
  if (dns.Status === 0 && mx.length === 0) return { ok: false, status: 'no_mx' };
  return { ok: true, status: 'mx_ok' };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mxVerdict };
if (typeof $input !== 'undefined') {
  const lead = $('Summarize site').item.json;
  const v = mxVerdict(lead.email, $json);
  return { json: { ...lead, emailOk: v.ok, status: v.ok ? '' : v.status, emailCheck: v.status } };
}
