# Lead pipeline (n8n)

Repository: https://github.com/SURUJ404/n8n-automation-workflows

Find local businesses, pull a **real** contact email from each company's own site, write a short tailored intro, and either save it as a Gmail draft or send it. Every lead is logged so nothing is contacted twice.

```
Form → Config → Read lead log → Google Places (Apify) → Select leads (capped in send mode)
     → [Each lead] → Fetch homepage → Find contact page → Fetch contact page → Pick email → Summarize site
         ├─ no email ─────────────────────────────────────────────────────────┐
         └─ email → Check MX (DNS-over-HTTPS) → Verify email → Email OK?       │
                      ├─ no mail server → Row: no email (status no_mx) ───────┤
                      └─ ok → Build prompt → Draft (OpenRouter) → Parse draft │
                           → Send now? ─ yes → Send email  → Row: sent    ────┤
                                       └ no  → Create draft → Row: drafted ───┤
                                                              Log lead → Pause → next lead
```

## What changed from the original

| Original | Rebuilt |
|---|---|
| LLM was given only a URL and asked for the "best email" (it can't browse, so results were guesses) | Fetches homepage + contact page, extracts `mailto:`, plain text, `[at]` obfuscation and Cloudflare-protected emails, ranks them deterministically (own domain, `info@`/`contact@` first, junk and `noreply` dropped) |
| `Email Style` field collected but never used | Style drives the prompt (Professional / Friendly / Simple) |
| One hardcoded "IT services" email for every business | New **What you offer** field; the model writes per lead from category, location and rating, with rules against inventing familiarity |
| Always sent | **Mode**: *Draft only* (default) or *Send now* |
| `runs/last/dataset/items` (returns the *previous* run) with the token in the URL | `run-sync-get-dataset-items` for this run, token held in an n8n credential |
| Form values interpolated into JSON by string | Request built with `JSON.stringify` (quotes in input can't break it) |
| No dedupe, 10 s wait before logging, log only held emails | Dedupes by domain against the sheet and within the run, skips social/aggregator sites, logs every outcome (`sent`, `drafted`, `no_email`), throttles per lead |
| No opt-out | Footer with reply-to-opt-out and your postal address |
| Generic drafts | Homepage title, meta description and headings are summarized and the model may reference one fact |
| Bad addresses go straight to Gmail | Syntax + MX lookup first (no mail server → logged as `no_mx`, never emailed) |
| No send ceiling | `maxSendsPerRun` in Config (default 30) caps a *Send now* batch |
| Failed LLM call = failed run | Retries, then falls back to a plain template |

## Setup

1. Google Sheet with a tab **Lead log** and header row: `Date, Company, Domain, Email, Phone, Category, Rating, Subject, Status`.
2. n8n → Import from file → `workflow/lead-pipeline.json`.
3. Set the Spreadsheet ID in **Read lead log** and **Log lead**.
4. Edit **Config**: sender name, company, calendar link (optional), postal address, model, seconds between leads.
5. Credentials: Google Sheets OAuth2, Gmail OAuth2, and two *Header Auth* credentials named `Authorization` = `Bearer <token>` for Apify and OpenRouter.
6. Open the form URL, run a small batch in **Draft only**, review the drafts, then switch to **Send now**.

## Known limits

Apify is asked for 2× the requested leads because many places have no website or are already logged, so cost scales accordingly. Lead Number is capped at 100 (30 in *Send now* mode, via Config). Sites that render their content with JavaScript show no static email and are logged `no_email`. MX checks catch dead domains, not dead mailboxes, so some bounces are still possible; keep batches small. If a run selects zero new leads it ends quietly. You're responsible for compliance with CAN-SPAM/GDPR/local rules for cold email.

## Development

The logic in each Code node lives in `src/*.js` as plain functions with unit tests; `scripts/build-workflow.py` inlines them into the workflow JSON (stable uuid5 ids, explicit typeVersions, non-overlapping grid layout).

```
npm test        # 32 tests: extraction, dedupe, drafting rules, workflow wiring,
                #           layout overlap, setup sticky, simulated run of every Code node
npm run build   # regenerate workflow/lead-pipeline.json
```
