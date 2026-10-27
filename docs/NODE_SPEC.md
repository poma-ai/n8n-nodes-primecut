# n8n nodes for index4.ai and PrimeCut: node spec

Linear: POMA-1259 (spec), parent POMA-1258. Status: v2.2, 2026-10-26. v1 was reviewed by two independent reviewers (Claude reviewer agent, Gemini 3.1 Pro); v2 applied their findings and went through one re-review round with both; v2.1 applies the re-review findings; v2.2 changes D3 and section 3 to accept account keys as well as project keys, at the owner's request. Codex was unavailable (MCP connection closed).

This document decides what the n8n packages are before any code is written: package layout, credentials, the two nodes and their operations, output shapes, error handling, and the constraints n8n's verification process imposes. The scaffold ticket (POMA-1260) starts from this document.

## 1. Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Package layout | **Two packages, one node each: `n8n-nodes-index4ai` and `n8n-nodes-primecut`.** index4.ai ships first. | n8n's verification guideline: "Each package should integrate one third-party service." The products sit on different hosts, have different consoles, and index4.ai product routes require a key for a project with the `grill` product (per the API descriptions; confirmed in V2). To an n8n reviewer and to a user these are two services. Both reviewers flagged the one-package layout as the likeliest rejection. Cost: two repos, two submissions. The ticket's earlier lean ("one package, two nodes") is reversed here; this is the main decision for the ticket owner to confirm. Both npm names were free on 2026-10-26. |
| D2 | Node style | Programmatic (`execute()`) for both nodes | Needed for binary input (`getBinaryDataBuffer`), joining chunk pages onto chunksets, submit-all-then-poll, and item pairing. Declarative nodes can poll (Firecrawl, which is declarative, polls inside a `postReceive` hook), so polling alone is not the reason. |
| D3 | Credentials | One credential type per package accepting **both project API keys and account API keys**: API Key plus an optional Project ID. An `authenticate` function adds `Authorization: Bearer` and sends `X-Project-ID` only when Project ID is set. | Decided 2026-10-26 (v2.2) after the owner asked for account keys. A generic headers block cannot omit an empty header, hence the function. The test request must accept every key kind, so it is `GET /docs?limit=1` (index4.ai) rather than `/projects/info`, which takes project keys only. An account key without Project ID uses the account's default project; `400 no_default_project` and `409 project_id_conflict` get their own messages. |
| D4 | HTTP | `this.helpers.httpRequestWithAuthentication` only; octet-stream uploads; no multipart | Verified nodes allow no runtime dependencies. Octet-stream ingest takes every option the node exposes as headers. The form route's extra `doc_metadata` field is therefore not exposed in v1. |
| D5 | Job plumbing | Hidden inside the node. "Wait for Result" on by default with an execution-level timeout. A "Job" resource with "Get Status" (both nodes) and "Get Results" (PrimeCut) for manual control. | Firecrawl exposes the same shape (operation plus wait). |
| D6 | PrimeCut output | One item per chunkset: `text` plus flat metadata fields, `pairedItem` set | The Vector Store insert path in n8n goes through the Default Data Loader, whose defaults **re-split text at 1000 characters** and ignore input metadata. The output shape therefore only works with the loader configured as in section 4.5; the template ships those settings and the README documents them. This wiring is verified against a real `/results` payload before the shape is frozen (section 8, V1). |
| D7 | Agent tool flag | `usableAsTool: true` on **both** nodes. index4.ai tool-safe operations: Search, Search in Document, Document Get, Get Many, Ingest from URL, Job Get Status. Not tool-safe: Ingest from binary, Delete. PrimeCut tool-safe operations: Chunk from URL, Job Get Status, Job Get Results. Not tool-safe: Chunk from binary. | Verified community nodes show in the AI Agent tool picker (n8n changelog: "Surface unofficial verified community node tools in AI Tools picker"; later: "Add support for verified community nodes as agent tools"). The lint rule `node-usable-as-tool` (error level) requires the property on every regular node and its autofix inserts `true`; `n8n-workflow` types it as `true | UsableAsToolDescription`, so `false` does not compile. PrimeCut therefore sets it too, and its README says which operations make sense as tools. Node descriptions are written so they read well as a tool description (V6 checks that n8n uses the node description for the tool). |
| D8 | Concurrency and timeout | Submit every input item first, then poll all jobs under one execution-level deadline. `429 too_many_jobs` on submit: wait `Retry-After` (default 5 s) and retry within the deadline. | Demo PrimeCut accounts allow one active job; paid accounts allow many. Submitting first and polling together uses whatever capacity the account has, and a batch of files on a demo account still works because the 429 retry serialises it. |
| D9 | Versioning | Node `version: 1`; package `0.1.0` until publish, then `1.0.0` (POMA-1261) | n8n node versioning is independent of the npm version. |

## 2. Package layout (per package)

```
n8n-nodes-index4ai/                     (n8n-nodes-primecut mirrors this)
  package.json        name, keyword n8n-community-node-package, MIT, author name+email,
                      homepage, repository https://github.com/poma-ai/n8n-nodes-index4ai
  credentials/
    Index4AiApi.credentials.ts          with icon
    index4ai.svg
  nodes/Index4Ai/
    Index4Ai.node.ts
    Index4Ai.node.json                  codex: categories, alias, docs links
    index4ai.svg, index4ai.dark.svg
    descriptions/                       resource and operation property blocks
    transport/                          request helper, polling, error mapping
  .github/workflows/publish.yml         from the @n8n/node-cli scaffold (provenance)
  .github/workflows/ci.yml              lint + build on push
  README.md
```

Lint rules from `@n8n/eslint-plugin-community-nodes` (recommended config, error level) that shape this layout:

- `valid-node-categories`: codex `categories` must come from: Data & Storage, Finance & Accounting, Marketing & Content, Productivity, Miscellaneous, Sales, Development, Analytics, Communication, Utility. Both nodes use `["Data & Storage", "Development"]`. "AI" is not allowed.
- `require-node-description-fields`: `subtitle` is required.
- `cred-class-field-icon-missing`: credentials need an icon.
- `valid-author`: author name and email in package.json. `require-homepage` warns without `homepage`.
- `missing-paired-item`: every output item carries `pairedItem: { item: i }`.
- `no-restricted-globals`: no `setTimeout`/`setInterval`; use `sleep` from `n8n-workflow`.
- `resource-operation-pattern`: more than five operations need a Resource parameter; both nodes use Resource then Operation.
- `node-usable-as-tool`: every regular node must declare `usableAsTool` (see D7).

Scaffold command (Node 22; on this machine the CLI's native dependency `isolated-vm` failed to build on Node 25.9):

```
npm create @n8n/node@latest n8n-nodes-index4ai -- --template programmatic/example
```

package.json rules from n8n's verification page: `n8n-nodes-` prefix, keyword, `n8n.nodes` and `n8n.credentials` arrays, `files: ["dist"]`, no `dependencies`, `peerDependencies: { "n8n-workflow": "*" }`, `@n8n/node-cli` >= 0.23.0 as devDependency (0.53.x current), npm `repository` and `author` matching the public GitHub repo.

## 3. Credentials

### 3.1 `index4AiApi` (display name "index4.ai API")

| Field | Type | Notes |
|-------|------|-------|
| API Key | string, password | A project API key (`poma_proj_…`) or an account API key from console.index4.ai. |
| Project ID | string, optional | With an account key: the project to use, or empty for the account's default index4.ai project. With a project key: leave empty (a different value answers `409 project_id_conflict`). Sent as `X-Project-ID` only when set. |
| Base URL | hidden, default `https://api.index4.ai/v1` | Hidden. Exists so an on-prem option (POMA-1138) can be added without a node change. |

Authenticate: a function (`IAuthenticate`) that sets `Authorization: Bearer <key>` and, when Project ID is non-empty, `X-Project-ID`. Test: `GET /docs?limit=1`, which accepts login tokens, account keys and project keys. A PrimeCut project key, or an account key with no usable project, answers 4xx and fails the test; no body rule is needed.

### 3.2 `primeCutApi` (display name "PrimeCut API")

Same three fields. Base URL default `https://api.poma-ai.com/v3`. Key from console.poma-ai.com. Test: a PrimeCut route that accepts every key kind; confirm which in V2 (`GET /activeJobs` is the candidate).

Keys are per product: index4.ai routes require a project with the `grill` product and PrimeCut routes a `primecut` project. Protected projects reject account keys by design. The README says which console issues which key.

## 4. PrimeCut node

| Field | Value |
|-------|-------|
| displayName | PrimeCut |
| name | primeCut (type `n8n-nodes-primecut.primeCut`) |
| description | Chunk a document from a URL or file into chunksets with PrimeCut, or fetch the results of a chunking job |
| subtitle | `={{$parameter["operation"] + ": " + $parameter["resource"]}}` |
| group | `['transform']` |
| inputs / outputs | Main / Main |
| usableAsTool | true (D7) |
| credentials | `primeCutApi`, required |
| codex | categories `["Data & Storage", "Development"]`; alias: chunk, chunking, chunkset, rag, document, pdf, text splitter, embeddings, vector store, parse, ocr |

### 4.1 Resources and operations

**Resource: Document**

| Operation | Action (nodes panel) | What it does |
|-----------|----------------------|--------------|
| Chunk | Chunk document | Upload a file or URL, wait for the job, return chunksets |

**Resource: Job**

| Operation | Action | What it does |
|-----------|--------|--------------|
| Get Status | Get job status | `GET /jobs/{id}/status` |
| Get Results | Get job results | `GET /jobs/{id}/results`, same output parameters as Chunk |

### 4.2 Document → Chunk parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| Source | options: Binary File, URL | Binary File | |
| Input Binary Field | string | `data` | Shown for Binary File. Filename and MIME type come from the binary metadata. |
| URL | string | | Shown for URL. Sent as `X-Remote-URL`. Placeholder "e.g. https://example.com/report.pdf". |
| Wait for Result | boolean | true | "Whether to wait until PrimeCut has finished and return the chunks. If off, returns the job ID immediately." |
| Timeout (Seconds) | number | 600 | Always shown. One deadline for the whole execution, not per item; it also bounds the 429 retries when not waiting. |
| Return | options: Chunksets, Chunks | Chunksets | Shown when waiting, and on Job → Get Results. |
| Simplify | boolean | true | Shown wherever Return is shown. "Whether to return a simplified version of the response instead of the raw data." True: `text` plus up to nine metadata fields per item (4.3). False: the raw chunkset or chunk objects, one per item. |
| Options → Canonical URL | string | | `X-Canonical-URL`. |
| Options → Labels | string, comma separated | | Sent as `X-Labels` with a JSON array string value (the API example shows `["confidential", "year:1982"]`). |

Not exposed in v1: `X-Completion` (the callback's method and payload are not documented in the API spec; add once V3 in section 8 has recorded them), `X-Base-URL`, `X-Meta-Int-*`, `X-Unencrypted-Strings`, `X-Footer-Only`, `X-Include-Links-Summary`, `doc_metadata` (form route only).

### 4.3 Output shape (Simplify on, Return = Chunksets)

Field names as observed in a live `/results` payload on 2026-10-27 (V1, converter `hotfix-v1.1.5`, archive `version: "1.0"`): a chunk has `chunk_index`, `content`, `depth`, `file_id`, `lang`, `lang_confidence`, `page`, `parent_chunk_index`, `to_embed`; a chunkset has `chunkset_index`, `chunks` (the chunk indices it spans), `contents`, `file_id`, `to_embed`. `metadata` has `source_file`, `source_type`, `file_id`, `version`, `chunk_page_numbering` (`original_1based`; a document-level chunk reports page 0). There is no `start_chunk`, `end_chunk`, `tokens` or `title` field. Placeholders stay inline in the text, for example `[IMAGE:Dummy PDF file]`, with the asset in the `images` map keyed `image_00001`.

```json
{
  "text": "<chunkset contents>",
  "jobId": "550e…",
  "fileName": "report.pdf",
  "chunksetIndex": 12,
  "firstChunk": 40,
  "lastChunk": 47,
  "page": 7,
  "heading": "Sample Document Overview",
  "canonicalUrl": "https://…"
}
```

Fields are flat, not nested under `metadata`, because the Default Data Loader maps metadata per key with expressions like `{{ $json.page }}`. `firstChunk` and `lastChunk` are the smallest and largest entry of `chunks`; `page` is the first page greater than 0 among the chunkset's chunks (else 0); `heading` is the content of the shallowest chunk in the set when that chunk is not the only one. When `to_embed` is present and differs from `contents`, it is added as `embedText` (tenth field, the UX cap). `fileId`, `chunks` and the raw `metadata` stay in the raw output only. Every item has `pairedItem: { item: i }`.

Return = Chunks: one item per chunk, `text` = `content`, the chunk's own fields in camelCase (`chunkIndex`, `parentChunkIndex`, `depth`, `page`, `lang`), plus `jobId`, `fileName`, and `embedText` when it differs.

`JobResults.skipped_members` non-empty means the payload is incomplete; the node throws ("Results for job … are too large to return inline. Download them from the POMA console or use the archive endpoint.") rather than emitting a partial set.

Placeholders: `JobResults` also carries `tables`, `images` and `code` maps keyed by placeholder IDs. Whether chunkset text contains placeholders or inlined content is decided from a real payload (section 8, V1). Until then v1 returns `text` as the API returns it and does not attach the maps.

### 4.4 Behaviour

1. For each input item: `POST /primeCut/ingest` with the file bytes (or `X-Remote-URL`), `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded>`, and `Content-Type: application/octet-stream` always (the route reads `application/json` as a JSON job description, and the format comes from the file name; same rule as the index4.ai node). Response 201 `PublicJob`; the node reads `job_id`, `created_at` and `status.status`.
   On `429 too_many_jobs`: wait `Retry-After` seconds (default 5; `sleep` from `n8n-workflow` takes milliseconds, so multiply by 1000) and retry the same item while the deadline allows.
2. Not waiting: return `{ jobId, status, createdAt }` per item.
3. Waiting: after all items are submitted, poll `GET /jobs/{id}/status` for the open jobs one at a time in a round every 5 s (first round after 2 s), never in parallel; a 429 on a status call (not documented for this route, handled defensively) waits `Retry-After` seconds before the next call. Terminal states: `done`, `failed`, `blocked`. For PrimeCut, a `done` status without a `download` block means the result is not stored yet; keep polling. Once `download` is present, `GET /jobs/{id}/results` once and map per Return and Simplify.
4. `failed` or `blocked`: throw per item with the job's `code` mapped through section 6 and `detail` stringified; `continueOnFail` yields `{ error, jobId, status, code, detail }`.
5. Deadline reached: run one final status round over every submitted job and fetch results for any that are `done`, so work finished during the submit phase is not lost. Then, for jobs still open, throw "Timed out waiting for PrimeCut job <jobId>" with the description "Raise 'Timeout (Seconds)' or fetch the result later with Job → Get Results using this job ID"; with `continueOnFail`, emit `{ error, jobId, status: "timeout" }`. Items never submitted (the deadline passed during 429 retries) get "No job slot became free for '<fileName>' within the timeout" instead.

Page and token limits (250 pages or 250,000 tokens) apply to demo accounts per the API description. The node does not split documents; it maps the job failure code the API returns.

### 4.5 Vector Store wiring (what the template and README specify)

PrimeCut → Vector Store (insert) → Default Data Loader with:

- Type of Data: JSON; Mode: Load Specific Data; Data: `{{ $json.text }}`
- Text Splitting: Custom, with a Character Text Splitter whose chunk size exceeds any chunkset (for example 100000) so nothing is re-split
- Metadata: `page`, `title`, `fileName`, `chunksetIndex`, `canonicalUrl` mapped from `{{ $json.<field> }}`

Without these settings n8n re-chunks at 1000 characters and drops the metadata. This is verified in V1 before the output shape is frozen.

## 5. index4.ai node

| Field | Value |
|-------|-------|
| displayName | index4.ai |
| name | index4Ai (type `n8n-nodes-index4ai.index4Ai`) |
| description | Search documents indexed in index4.ai and return the most relevant passages for a question. Also ingests, lists and deletes documents. |
| subtitle | `={{$parameter["operation"] + ": " + $parameter["resource"]}}` |
| group | `['transform']` |
| usableAsTool | true |
| credentials | `index4AiApi`, required |
| codex | categories `["Data & Storage", "Development"]`; alias: rag, retrieval, search, semantic search, vector store, knowledge base, document q&a, ingest, index, chat with documents, agent tool |

The description leads with search because n8n hands it to the model as the tool description.

### 5.1 Resources and operations

**Resource: Document**

| Operation | Action | API |
|-----------|--------|-----|
| Ingest | Ingest document | `POST /ingest` |
| Get | Get document | `GET /docs/{docId}` |
| Get Many | Get many documents | `GET /docs` with `limit` and `cursor`; "Return All" toggle and "Limit" (default 50) |
| Delete | Delete document | `DELETE /docs/{docId}`; the API's `{ doc_id, vectors_deleted, storage_deleted }` is mapped to `[{ "deleted": true }]` |

**Resource: Search**

| Operation | Action | API |
|-----------|--------|-----|
| Search | Search documents | `POST /search` |
| Search in Document | Search in document | `POST /searchInDoc` with `doc_filter` |

**Resource: Job**

| Operation | Action | API |
|-----------|--------|-----|
| Get Status | Get job status | `GET /jobs/{id}/status` (for Ingest with waiting off) |

Document ID fields are Resource Locators: "From list" (backed by `GET /docs`, showing title or filename) and "By ID".

Not in v1: `PATCH /docs/{docId}` (attributes), `/attributes`, images, tables, pages. Add when a template needs them.

### 5.2 Document → Ingest parameters

Source, Input Binary Field, URL as in PrimeCut. Then:

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| Wait for Indexing | boolean | true | "Whether to wait until the document is indexed and searchable before returning." index4.ai reports `done` only after indexing. |
| Timeout (Seconds) | number | 600 | Execution-level deadline as in D8. |
| Options → Attributes | json | | `X-Attributes`. Names must match `^[a-z0-9_]{1,64}$`, are permanent once used, and the header is capped at 2048 characters. `datetime` and `encrypted_text` need `X-Attribute-Schema`, which v1 does not expose. |
| Options → Canonical URL | string | | `X-Canonical-URL`. |

`X-Labels` is deprecated upstream and not exposed.

Output: `{ jobId, docId, status, deduplicated }`. `docId` is `jobId` unless the final status carries `grill.doc_id`, which wins. `deduplicated` is `null` when the `grill` block is absent (the API says absent means no information).

Ingest polls `/jobs/{id}/status` as in 4.4 steps 3 to 5 with terminal states `done`, `failed`, `blocked`, with one difference: **`done` is terminal as it stands**. index4.ai jobs never carry a `download` block (the API says it is absent for the whole life of an index4.ai job), so the PrimeCut "wait for `download`" rule must not apply, and `/results` is never called.

### 5.3 Document → Get and Get Many output

`DocInfo` has 17 fields, so as a tool node the operation carries an **Output** parameter: Simplified (doc_id, title, filename, pages, chunkset_count, ingested_at, canonical_url, attributes), Raw, Selected Fields (multi-select, `doc_id` always included). Get Many returns one item per document, not the wrapper.

### 5.4 Search parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| Query | string, required | | Placeholder "e.g. What were the Q3 liquidity ratios?". The field an agent fills via `$fromAI`. |
| Document | resource locator, required | | Search in Document only; sent as `doc_filter`. |
| Result Format | options: Prompt-Ready Text, Structured Results | Prompt-Ready Text | `format: prompt_ready` returns one item `{ context }` (the rendered block, what a tool should return). `format: json` returns one item per `results[]` entry. |
| Output | options: Simplified, Raw, Selected Fields | Simplified | Shown for Structured Results only (`SearchResult` has 12 fields). Simplified: `doc_id`, `title`, `content`, `pages`, `canonical_url`, `score`. Selected Fields always includes `doc_id`. |
| Options → Document IDs | string, comma separated | | `doc_ids`. Search only (hidden on Search in Document). |
| Options → Exclude Document IDs | string | | `exclude_doc_ids`. Search only. |
| Options → Minimum Relevance | number 0-1 | | `min_relevance` (backend default about 0.3) |
| Options → Target Tokens | number | 5000 | `target_tokens` |
| Options → Maximum Tokens | number | 15000 | `max_tokens` |
| Options → Attribute Filters | json | | `attribute_filters` |
| Options → Return Assets | boolean | false | "Whether to include extracted figures and tables referenced by the results" |

Search is a single request. 503 with `Retry-After` is retried once after the given delay; 502 `embedding_unavailable` is not retried.

## 6. Error handling

Error bodies are usually the JSON envelope `{ error, code, reason }`, but `/jobs/*` routes and some ingest failures answer `text/plain`. The mapper reads JSON when the content type is JSON, otherwise uses the body text, and always falls back to the HTTP status. The same table maps a failed job's `code`.

| Code | Where | Message (what happened) | Description (how to fix) |
|------|-------|-------------------------|--------------------------|
| 401 | HTTP | The API key was rejected | Check the key in the credential, and that its project (or the Project ID) has the index4.ai product |
| 402 | HTTP or job | The account has no credits left for this request | Top up at the console; if `reason` is `legacy_pricing_retired`, switch to the current plan |
| 403 | HTTP or job (`blocked`) | The request was refused for this project | Check the project's protection settings and that the key belongs to it |
| 400 | HTTP | The request was rejected: `<message from the response body>` | Check the file name, URL and options |
| 400 `no_default_project` | HTTP | No project is selected for this account API key | Enter the 'Project ID' in the credential, or set a default project in the console |
| 409 `project_id_conflict` | HTTP | The 'Project ID' in the credential does not match the project key's project | Clear 'Project ID' when using a project key, or use an account key |
| 404 | HTTP | The document or job was not found (index4.ai) / The job was not found (PrimeCut) | Check the ID, and that it belongs to this project |
| 409 | job | The job ended without a recorded result code | Check the job in the console or try again |
| 413 | job | The document is too large | Split the document and try again; for index4.ai a 413 after conversion means the indexing capacity was exceeded, so contact support |
| 415 | job | The document type is not supported | Convert the document to a supported format and try again |
| 422 | job | The document could not be read | Check that the file is not damaged, encrypted or empty |
| 429 | HTTP | handled by retry; at the deadline: Timed out waiting for a free job slot | Raise 'Timeout (Seconds)' or run fewer executions at once |
| 5xx | HTTP or job | index4.ai / PrimeCut did not complete the request | Try again later |

Messages avoid the words "error", "problem", "failure", "mistake", name the parameter display name where one is involved, and carry the item index via `itemIndex`. `continueOnFail` is honoured on every operation.

## 7. Verification checklist (per package)

Before publish:

- [ ] Scaffolded with `npm create @n8n/node@latest` (programmatic template), `@n8n/node-cli` >= 0.23.0
- [ ] `npm run lint` clean, `npm run build` clean, `npm run dev` shows the node in the nodes panel (and, if V5 confirms it for an unverified local node, in the AI Agent tool picker)
- [ ] No `dependencies`; no env var or filesystem access
- [ ] MIT; README with auth, operations, example workflows, the Vector Store wiring from 4.5
- [ ] package.json `author` (name and email), `homepage`, `repository` matching `github.com/poma-ai/<package>`
- [ ] SVG icons for node (light and dark) and credential
- [ ] All UI text in English; Title Case display names, sentence case actions and descriptions, no articles in actions

Publish and submit:

- [ ] Published only by `.github/workflows/publish.yml` with provenance (required from 1 May 2026); npm Trusted Publisher: owner `poma-ai`, repo `<package>`, workflow `publish.yml`
- [ ] `npx @n8n/scan-community-package <package>` clean against the published package
- [ ] Submitted at creators.n8n.io/nodes (POMA-1262)

## 8. Verifications to run during scaffold (POMA-1260), before the shape is frozen

| # | What | Why |
|---|------|-----|
| V1 | Run a real PDF through `/primeCut/ingest` and `/results`; confirm chunk and chunkset indices line up, how placeholders appear in text, and that the 4.5 loader settings insert chunksets unsplit into Qdrant | D6 rests on it |
| V2 | Credential test (`GET /docs?limit=1`) with a project key, an account key plus Project ID, and an account key without Project ID on an account with and without a default project; a PrimeCut key against `GET /docs` (expect a 4xx); whether `X-Project-ID` is harmless on `/jobs/{id}/status`; which PrimeCut route serves as its credential test | D3, README wording. **Done 2026-10-26 for the account key** (see `n8n-nodes-index4ai/docs/TESTING.md`); project key, PrimeCut key and the PrimeCut test route still open |
| V3 | Fire `X-Completion` at a Wait node's resume URL; record method and payload | Decides whether a Completion Webhook option can be added after v1 |
| V4 | Confirm the octet-stream body limit for ingest and state it in the parameter description | User-facing limit |
| V5 | On n8n 2.x (via `npm run dev`), confirm the index4.ai tool appears in the AI Agent picker without any environment variable; record the minimum n8n version for the README | D7. **Done 2026-10-26 on n8n 3.x (`n8nio/n8n:latest`)**: "index4.ai Tool" appears, no environment variable set |
| V6 | Confirm how n8n derives a community tool's description (node description, or operation action) and adjust the description strings | D7 wording. **Done 2026-10-26**: the tool view shows "Tool Description: Set Automatically" with the node description; no change needed |

## 9. Risks

| # | Risk | Handling |
|---|------|----------|
| R1 | Two packages means two repos, two release pipelines, two verification queues | Accept; index4.ai first, PrimeCut follows once the first passes and lessons are applied. Ticket titles that say `n8n-nodes-poma` need renaming. |
| R2 | Verification queue turnaround is unpublished; a forum thread reports the automated check stalling for days | Plan the launch date after submission. |
| R3 | Account keys without a Project ID depend on the account having a default index4.ai project | The `no_default_project` message tells the user what to set. |
| R4 | Output shape may change after V1 | Do V1 first in POMA-1260, before writing the mapping code. |

## 10. Reference nodes

- Firecrawl (`@mendable/n8n-nodes-firecrawl` 2.2.0, verified): declarative with `requestDefaults`, `usableAsTool: true`, `group: ['transform']`, versions `[1, 1.1]`, credential with a visible Base URL field and a `GET /team/credit-usage` test request, polling via `sleep` in a `postReceive` hook. Its codex lists "Developer Tools", which the current lint rule rejects, so it is not a model for the codex file.
- n8n-nodes-starter `Example.node.ts`: `execute()` loop with `continueOnFail` and `NodeOperationError` with `itemIndex`.

## 11. Sources

- n8n docs: submit community nodes, verification guidelines, UX guidelines, n8n-node CLI, Default Data Loader (docs.n8n.io)
- `@n8n/eslint-plugin-community-nodes` rule sources (n8n-io/n8n monorepo); n8n CHANGELOG entries on verified community node tools
- n8n-nodes-starter `publish.yml` and `package.json`; `@n8n/create-node` 0.54.3 scaffold output
- POMA v3 OpenAPI (`api.poma-ai.com/api/v3/openapi.yaml`), index4.ai v1 OpenAPI (`api.index4.ai/v1/openapi.yaml`)
- poma-core `chunking/chunksets.py`, `MIGRATION-chunks-jsonl.md`; poma-ai/index4ai-mcp README
