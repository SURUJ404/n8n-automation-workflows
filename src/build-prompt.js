// n8n Code node: "Build prompt" (Run Once for Each Item)
// Builds the OpenRouter chat request. Style and offer come from the form, so nothing is niche-specific.

const STYLES = {
  Friendly: 'Warm and conversational. Contractions are fine. Sounds like a helpful peer, not a salesperson.',
  Professional: 'Polished and concise. Formal but not stiff. No slang, no exclamation marks.',
  Simple: 'Very plain. Three or four short sentences. No adjectives you could delete.',
};

function buildRequest({ lead, offer, style, senderName, senderCompany, model }) {
  const system = [
    'You write short cold outreach emails on behalf of a real sender.',
    `Tone: ${STYLES[style] || STYLES.Professional}`,
    'Rules:',
    '- Body is at most 110 words, plain text, no markdown, no emojis.',
    '- If "Site says" facts are given, you may reference ONE of them naturally (in your own words, not quoted); skip it if none is clearly useful.',
    '- Use ONLY the facts provided about the recipient. Never claim to have followed, used, or studied their business, and never praise their "impressive work".',
    '- Start with "Hi <company name> team,".',
    '- State what the sender offers in one concrete sentence tied to the recipient\'s category.',
    '- End with one low-pressure question as the call to action.',
    '- Do not include a signature, placeholders, or links; they are added separately.',
    '- Subject under 60 characters, no clickbait, no all-caps.',
    'Respond with JSON only: {"subject": string, "body": string}.',
  ].join('\n');
  const facts = [
    `Recipient company: ${lead.name}`,
    lead.category && `Category: ${lead.category}`,
    lead.address && `Location: ${lead.address}`,
    lead.rating && `Public Google rating: ${lead.rating} (${lead.reviews || 'n/a'} reviews)`,
    `Website: ${lead.website}`,
    lead.siteSummary && `Site says:\n${lead.siteSummary}`,
  ].filter(Boolean).join('\n');
  const user = `${facts}\n\nSender: ${senderName}, ${senderCompany}\nWhat the sender offers: ${offer}`;
  return {
    model,
    temperature: 0.7,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildRequest, STYLES };
if (typeof $input !== 'undefined') {
  const form = $('On form submission').first().json;
  const cfg = $('Config').first().json;
  const lead = $json;
  return {
    json: {
      lead,
      request: buildRequest({
        lead,
        offer: form['What you offer'],
        style: form['Email Style'],
        senderName: cfg.senderName,
        senderCompany: cfg.senderCompany,
        model: cfg.model,
      }),
    },
  };
}
