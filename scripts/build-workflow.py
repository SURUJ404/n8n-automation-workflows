#!/usr/bin/env python3
"""Assemble workflow/lead-pipeline.json from src/*.js so the Code nodes stay unit-tested."""
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
NS = uuid.UUID("6f1c3a52-9d0e-4b7a-8a55-3c2f1f0b9e11")  # stable ids -> clean diffs on rebuild

nodes, connections = [], {}


def code(name):
    return (SRC / name).read_text()


def add(name, type_, version, pos, params, **extra):
    node = {
        "id": str(uuid.uuid5(NS, name)),
        "name": name,
        "type": type_,
        "typeVersion": version,
        "position": pos,
        "parameters": params,
    }
    node.update(extra)
    nodes.append(node)


def link(src, dst, out=0, kind="main"):
    outs = connections.setdefault(src, {}).setdefault(kind, [])
    while len(outs) <= out:
        outs.append([])
    outs[out].append({"node": dst, "type": kind, "index": 0})


def assign(name, value, type_="string"):
    return {"id": str(uuid.uuid5(NS, "assign-" + name)), "name": name, "value": value, "type": type_}


def js(name, src_file, pos, each=True):
    add(name, "n8n-nodes-base.code", 2, pos,
        {"mode": "runOnceForEachItem" if each else "runOnceForAllItems", "jsCode": code(src_file)})


def not_empty(left):
    return {
        "options": {"version": 2, "caseSensitive": True, "typeValidation": "loose"},
        "combinator": "and",
        "conditions": [{
            "id": str(uuid.uuid5(NS, "cond-" + left)),
            "leftValue": left,
            "rightValue": "",
            "operator": {"type": "string", "operation": "notEmpty", "singleValue": True},
        }],
    }


SHEET = {"__rl": True, "mode": "id", "value": "REPLACE_WITH_SPREADSHEET_ID"}
TAB = {"__rl": True, "mode": "name", "value": "Lead log"}
COLS = ["Date", "Company", "Domain", "Email", "Phone", "Category", "Rating", "Subject", "Status"]
SHEETS_CRED = {"googleSheetsOAuth2Api": {"id": "", "name": "Google Sheets account"}}
GMAIL_CRED = {"gmailOAuth2": {"id": "", "name": "Gmail account"}}

# Positions sit on a 320x200 grid (nodes are ~240px wide) so nothing overlaps.
# Layout: Notes [0,0]; intake row y=440; per-lead row y=240; MX/draft row y=40;
# no-email / pause row y=640; send-or-draft pair at x=6080 across y=40/240.
# ── 1. Intake ─────────────────────────────────────────────────────────────
add("On form submission", "n8n-nodes-base.formTrigger", 2.2, [0, 440], {
    "formTitle": "Lead pipeline",
    "formDescription": "Find local businesses, pull a real contact email from their site, and draft (or send) a short intro.",
    "formFields": {"values": [
        {"fieldLabel": "Business Type", "placeholder": "e.g. Plumber", "requiredField": True},
        {"fieldLabel": "Location", "placeholder": "e.g. Rome, Italy", "requiredField": True},
        {"fieldLabel": "Lead Number", "fieldType": "number", "placeholder": "max 100", "requiredField": True},
        {"fieldLabel": "What you offer", "fieldType": "textarea",
         "placeholder": "One or two sentences on what you sell and the result it gives", "requiredField": True},
        {"fieldLabel": "Email Style", "fieldType": "dropdown", "requiredField": True,
         "fieldOptions": {"values": [{"option": "Professional"}, {"option": "Friendly"}, {"option": "Simple"}]}},
        {"fieldLabel": "Mode", "fieldType": "dropdown", "requiredField": True,
         "fieldOptions": {"values": [{"option": "Draft only"}, {"option": "Send now"}]}},
    ]},
    "options": {"appendAttribution": False, "buttonLabel": "Run pipeline"},
}, webhookId=str(uuid.uuid5(NS, "webhook")))

add("Config", "n8n-nodes-base.set", 3.4, [320, 440], {
    "assignments": {"assignments": [
        assign("senderName", "REPLACE: Your Name"),
        assign("senderCompany", "REPLACE: Your Company"),
        assign("calendarLink", ""),
        assign("postalAddress", "REPLACE: your business mailing address"),
        assign("model", "openai/gpt-4o-mini"),
        assign("secondsBetweenLeads", 15, "number"),
        assign("maxSendsPerRun", 30, "number"),
    ]},
    "options": {},
})

# ── 2. Discovery ──────────────────────────────────────────────────────────
add("Read lead log", "n8n-nodes-base.googleSheets", 4.6, [640, 440], {
    "operation": "read", "documentId": SHEET, "sheetName": TAB, "options": {},
}, credentials=SHEETS_CRED, executeOnce=True, alwaysOutputData=True)

# Over-fetch x2 because many places have no site and some are already in the log.
add("Google Places", "n8n-nodes-base.httpRequest", 4.2, [960, 440], {
    "method": "POST",
    "url": "https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items",
    "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
    "sendBody": True, "specifyBody": "json",
    "jsonBody": ("={{ JSON.stringify({"
                 " searchStringsArray: [$('On form submission').first().json['Business Type']],"
                 " locationQuery: $('On form submission').first().json['Location'],"
                 " maxCrawledPlacesPerSearch: Math.min($('On form submission').first().json['Lead Number'] * 2, 200),"
                 " language: 'en', skipClosedPlaces: true, scrapeContacts: false, scrapeDirectories: false,"
                 " scrapePlaceDetailPage: false, maxImages: 0, includeWebResults: false }) }}"),
    "options": {"timeout": 300000},
}, credentials={"httpHeaderAuth": {"id": "", "name": "Apify (Authorization: Bearer <token>)"}},
    executeOnce=True, retryOnFail=True, maxTries=2, waitBetweenTries=5000)

js("Select leads", "select-leads.js", [1280, 440], each=False)

# ── 3. Per-lead loop ──────────────────────────────────────────────────────
add("Each lead", "n8n-nodes-base.splitInBatches", 3, [1600, 440], {"batchSize": 1, "options": {}})

# Plain browser UA: some sites reject anything that identifies as a bot.
UA = {"parameters": [{"name": "User-Agent",
                      "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}]}


def fetcher(name, url, pos):
    add(name, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "url": url, "sendHeaders": True, "headerParameters": UA,
        "options": {"timeout": 10000, "redirect": {"redirect": {"maxRedirects": 3}},
                    "response": {"response": {"neverError": True, "responseFormat": "text"}}},
    }, onError="continueRegularOutput")


fetcher("Fetch homepage", "={{ $json.website }}", [1920, 240])
js("Find contact page", "contact-link.js", [2240, 240])
fetcher("Fetch contact page", "={{ $json.contactUrl }}", [2560, 240])
js("Pick email", "pick-email.js", [2880, 240])
js("Summarize site", "summarize-site.js", [3200, 240])
add("Has email?", "n8n-nodes-base.if", 2.2, [3520, 240],
    {"conditions": not_empty("={{ $json.email }}"), "options": {}})
add("Check MX", "n8n-nodes-base.httpRequest", 4.2, [3840, 40], {
    "url": "https://dns.google/resolve",
    "sendQuery": True,
    "queryParameters": {"parameters": [
        {"name": "name", "value": "={{ $json.email.split('@')[1] }}"}, {"name": "type", "value": "MX"}]},
    "options": {"timeout": 8000}}, onError="continueRegularOutput")
js("Verify email", "verify-email.js", [4160, 40])
add("Email OK?", "n8n-nodes-base.if", 2.2, [4480, 40], {
    "conditions": {"options": {"version": 2, "caseSensitive": True, "typeValidation": "loose"},
                   "combinator": "and",
                   "conditions": [{"id": str(uuid.uuid5(NS, "cond-ok")), "leftValue": "={{ $json.emailOk }}",
                                   "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
    "options": {}})

# no email -> log and move on
add("Row: no email", "n8n-nodes-base.set", 3.4, [3520, 640], {
    "assignments": {"assignments": [
        assign("Date", "={{ $now.toISODate() }}"), assign("Company", "={{ $json.name }}"),
        assign("Domain", "={{ $json.domain }}"), assign("Email", "={{ $json.email }}"),
        assign("Phone", "={{ $json.phone }}"), assign("Category", "={{ $json.category }}"),
        assign("Rating", "={{ $json.rating }}"), assign("Subject", ""), assign("Status", "={{ $json.status || 'no_email' }}"),
    ]}, "options": {}})

# ── 4. Draft ──────────────────────────────────────────────────────────────
js("Build prompt", "build-prompt.js", [4800, 40])
add("Draft with OpenRouter", "n8n-nodes-base.httpRequest", 4.2, [5120, 40], {
    "method": "POST", "url": "https://openrouter.ai/api/v1/chat/completions",
    "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
    "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.request) }}",
    "options": {"timeout": 60000},
}, credentials={"httpHeaderAuth": {"id": "", "name": "OpenRouter (Authorization: Bearer <key>)"}},
    onError="continueRegularOutput", retryOnFail=True, maxTries=2, waitBetweenTries=3000)
js("Parse draft", "parse-draft.js", [5440, 40])

add("Send now?", "n8n-nodes-base.if", 2.2, [5760, 40], {
    "conditions": {
        "options": {"version": 2, "caseSensitive": True, "typeValidation": "loose"},
        "combinator": "and",
        "conditions": [{
            "id": str(uuid.uuid5(NS, "cond-mode")),
            "leftValue": "={{ $('On form submission').first().json['Mode'] }}",
            "rightValue": "Send now",
            "operator": {"type": "string", "operation": "equals"},
        }],
    }, "options": {}})

add("Send email", "n8n-nodes-base.gmail", 2.2, [6080, 40], {
    "resource": "message", "operation": "send",
    "sendTo": "={{ $json.email }}", "subject": "={{ $json.subject }}",
    "emailType": "text", "message": "={{ $json.body }}",
    "options": {"appendAttribution": False},
}, credentials=GMAIL_CRED)
add("Create draft", "n8n-nodes-base.gmail", 2.2, [6080, 240], {
    "resource": "draft", "operation": "create",
    "subject": "={{ $json.subject }}", "emailType": "text", "message": "={{ $json.body }}",
    "options": {"sendTo": "={{ $json.email }}"},
}, credentials=GMAIL_CRED)


def row(name, status, pos):
    # .first() rather than .item: Gmail output pairing isn't guaranteed and the
    # loop processes exactly one lead at a time, so the first item is the item.
    p = "$('Parse draft').first().json"
    add(name, "n8n-nodes-base.set", 3.4, pos, {"assignments": {"assignments": [
        assign("Date", "={{ $now.toISODate() }}"), assign("Company", f"={{{{ {p}.name }}}}"),
        assign("Domain", f"={{{{ {p}.domain }}}}"), assign("Email", f"={{{{ {p}.email }}}}"),
        assign("Phone", f"={{{{ {p}.phone }}}}"), assign("Category", f"={{{{ {p}.category }}}}"),
        assign("Rating", f"={{{{ {p}.rating }}}}"), assign("Subject", f"={{{{ {p}.subject }}}}"),
        assign("Status", status),
    ]}, "options": {}})


row("Row: sent", "sent", [6400, 40])
row("Row: drafted", "drafted", [6400, 240])

# ── 5. Log + throttle ─────────────────────────────────────────────────────
add("Log lead", "n8n-nodes-base.googleSheets", 4.6, [6760, 440], {
    "operation": "appendOrUpdate", "documentId": SHEET, "sheetName": TAB,
    "columns": {
        "mappingMode": "defineBelow",
        "value": {c: f"={{{{ $json.{c} }}}}" for c in COLS},
        "matchingColumns": ["Domain"],
        "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False,
                    "display": True, "type": "string", "canBeUsedToMatch": True} for c in COLS],
        "attemptToConvertTypes": False, "convertFieldsToString": True,
    }, "options": {},
}, credentials=SHEETS_CRED)
add("Pause", "n8n-nodes-base.wait", 1.1, [7080, 640],
    {"resume": "timeInterval", "amount": "={{ $('Config').first().json.secondsBetweenLeads }}", "unit": "seconds"},
    webhookId=str(uuid.uuid5(NS, "wait")))

add("Notes", "n8n-nodes-base.stickyNote", 1, [0, 0], {
    "width": 900, "height": 400,
    "content": ("## Lead pipeline — setup\n\n"
                "**1. Google Sheet.** Create a tab named `Lead log` with header row:\n"
                + "`" + ", ".join(COLS) + "`\n\n"
                "**2. Import.** n8n → Workflows → Import from file → `workflow/lead-pipeline.json`.\n\n"
                "**3. Spreadsheet ID.** Set it in *Read lead log* and *Log lead* "
                "(placeholder `REPLACE_WITH_SPREADSHEET_ID`).\n\n"
                "**4. Credentials.** Google Sheets OAuth2 + Gmail OAuth2, plus two *Header Auth* "
                "credentials (`Authorization: Bearer <token>`) for *Google Places* (Apify) and "
                "*Draft with OpenRouter*. Tokens live only in credentials, never in this file.\n\n"
                "**5. Config node.** Replace sender name, company and postal address; optional calendar link; "
                "model, secondsBetweenLeads, maxSendsPerRun.\n\n"
                "**6. Run.** Open the form URL, start with *Mode = Draft only* (the default), review Gmail "
                "drafts, then switch to *Send now* when happy.\n\n"
                "Default mode is *Draft only*. Every outcome (sent / drafted / no_email / no_mx) is logged "
                "by Domain, so no lead is contacted twice."),
})

# ── wiring ────────────────────────────────────────────────────────────────
chain = ["On form submission", "Config", "Read lead log", "Google Places", "Select leads", "Each lead"]
for a, b in zip(chain, chain[1:]):
    link(a, b)
link("Each lead", "Fetch homepage", out=1)  # output 0 = done, 1 = loop
for a, b in [("Fetch homepage", "Find contact page"), ("Find contact page", "Fetch contact page"),
             ("Fetch contact page", "Pick email"), ("Pick email", "Summarize site"), ("Summarize site", "Has email?")]:
    link(a, b)
link("Has email?", "Check MX", out=0)
link("Has email?", "Row: no email", out=1)
link("Check MX", "Verify email")
link("Verify email", "Email OK?")
link("Email OK?", "Build prompt", out=0)
link("Email OK?", "Row: no email", out=1)
for a, b in [("Build prompt", "Draft with OpenRouter"), ("Draft with OpenRouter", "Parse draft"),
             ("Parse draft", "Send now?")]:
    link(a, b)
link("Send now?", "Send email", out=0)
link("Send now?", "Create draft", out=1)
link("Send email", "Row: sent")
link("Create draft", "Row: drafted")
for r in ("Row: sent", "Row: drafted", "Row: no email"):
    link(r, "Log lead")
link("Log lead", "Pause")
link("Pause", "Each lead")

wf = {
    "name": "Lead pipeline",
    "nodes": nodes,
    "connections": connections,
    "active": False,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
    "tags": [],
}
out = ROOT / "workflow" / "lead-pipeline.json"
out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out.relative_to(ROOT)}: {len(nodes)} nodes")
