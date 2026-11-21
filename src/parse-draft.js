// n8n Code node: "Parse draft" (Run Once for Each Item)
// Validates the model's JSON, falls back to a template if the call failed, then adds signature + opt-out footer.

// Every opener starts the same way, so fallback and model drafts read alike.
const FALLBACK_OPENERS = {
  Friendly: (c) => `Hi ${c} team,\n\nThanks for taking a minute to read this.`,
  Professional: (c) => `Hi ${c} team,\n\nI am reaching out briefly.`,
  Simple: (c) => `Hi ${c} team,`,
};

function extractJson(content) {
  if (typeof content !== 'string') return null;
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const subject = typeof obj.subject === 'string' ? obj.subject.trim() : '';
    const body = typeof obj.body === 'string' ? obj.body.trim() : '';
    if (subject && body && body.length < 1500) return { subject, body };
  } catch { /* fall through */ }
  return null;
}

function fallbackDraft({ lead, offer, style }) {
  const open = (FALLBACK_OPENERS[style] || FALLBACK_OPENERS.Professional)(lead.name);
  return {
    subject: `Quick idea for ${lead.name}`.slice(0, 60),
    body: `${open}\n\nWe help ${lead.category ? lead.category.toLowerCase() + ' businesses' : 'businesses like yours'} with the following: ${offer}\n\nWould it be useful if I sent over a short example?`,
  };
}

function finalize(draft, { senderName, senderCompany, calendarLink, postalAddress }) {
  const parts = [draft.body.trim(), ''];
  if (calendarLink) parts.push(`If easier, grab a time here: ${calendarLink}`, '');
  parts.push('Best,', senderName, senderCompany, '');
  parts.push("If you'd rather not hear from me, reply 'no thanks' and I won't email you again.");
  if (postalAddress) parts.push(postalAddress);
  return { subject: draft.subject, body: parts.join('\n') };
}

function parseDraft({ content, lead, offer, style, cfg }) {
  const parsed = extractJson(content);
  const draft = parsed || fallbackDraft({ lead, offer, style });
  return { ...finalize(draft, cfg), draftSource: parsed ? 'llm' : 'fallback' };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseDraft, extractJson, fallbackDraft, finalize };
if (typeof $input !== 'undefined') {
  const form = $('On form submission').first().json;
  const cfg = $('Config').first().json;
  const { lead } = $('Build prompt').item.json;
  const content = $json.choices && $json.choices[0] && $json.choices[0].message && $json.choices[0].message.content;
  const out = parseDraft({ content, lead, offer: form['What you offer'], style: form['Email Style'], cfg });
  return { json: { ...lead, ...out } };
}
