# Test log

## 2026-10-27: live API and local n8n, account API key

### Live API (curl, `https://api.poma-ai.com/v3`), spec check V1

| Check | Result |
|---|---|
| `GET /me`, `/activeJobs`, `/projects`, `/myUsage` with an account key | 200 each; `/activeJobs` is the credential test |
| `GET /projects/info` with an account key | 401 (project keys only) |
| `POST /primeCut/ingest` with `X-Remote-URL` (the W3C `dummy.pdf`) and `X-Canonical-URL` | 201 `PublicJob` with `job_id`, `status.status: "pending"`, `created_at` |
| `GET /jobs/{id}/status` polled every 3 s | `pending` three times, then `done` with a `download` block (`download_url`, `size`, `mime_type`, `expires_at`, `converter_id`), `usage` (credits 1, pages 1, tokens 9, 14 s runtime) |
| `GET /jobs/{id}/results` | `chunks` (3), `chunksets` (1), `images` (1), `metadata` (7 keys); no `tables`, `code` or `skipped_members` |

Observed result shape (this converter, archive `version: "1.0"`): a chunk has `chunk_index`, `content`, `depth`, `file_id`, `lang`, `lang_confidence`, `page`, `parent_chunk_index`, `to_embed`; a chunkset has `chunkset_index`, `chunks` (indices), `contents`, `file_id`, `to_embed`; `metadata` has `source_file`, `source_type`, `file_id`, `version`, `chunk_page_numbering: "original_1based"`, `creation_date`, `meta_tags`. The document-level chunk reports `page: 0`. Image placeholders stay inline: `[IMAGE:Dummy PDF file]`, with the asset under `images.image_00001`. The spec's section 4.3 was rewritten to this shape (no `start_chunk`, `tokens` or `title`).

### Local n8n UI (`n8nio/n8n:latest`, custom extension, same instance as the index4.ai tests)

| Check | Result |
|---|---|
| Package load | `CUSTOM.primeCut` loads against n8n's bundled n8n-workflow; node appears with its icon |
| `examples/chunk-url.json` imported via Import from URL | Trigger, PrimeCut node and sticky note on the canvas |
| Node parameters | Source, URL, Wait for Result, Timeout, Return, Simplify, Options with Canonical URL and Labels; Return and Simplify shown only while waiting |
| Credential form | API Key and Project ID; saved and accepted with an account key (test `GET /activeJobs`) |
| Document > Chunk by URL, wait on, Chunksets, Simplify | Finished in about 20 s. One item: `text`, `jobId`, `fileName: dummy.pdf`, `chunksetIndex 0`, `firstChunk 0`, `lastChunk 2`, `page 1`, `heading "Dummy PDF file"` (the depth-1 section title; chunk 0 is the document title), `canonicalUrl`, `embedText` |

### Labels header, live (same day)

| `X-Labels` value sent | `metadata.meta_tags` in the results |
|---|---|
| `["confidential","year:2026"]` (JSON array) | `['["confidential"', '"year:2026"]']`: the server splits on commas, it does not parse JSON |
| `confidential,year:2026` | `['confidential', 'year:2026']` |

The node therefore sends labels comma-separated and rejects non-ASCII labels (a header cannot carry them).

### Local Qdrant end to end (same day, `examples/chunk-file-to-qdrant.json`)

Qdrant 1.17.1 in Docker on the Mac (`127.0.0.1:6333`), embeddings from Ollama `bge-m3` on the Mac, n8n reaching both through `host.docker.internal`. The local-test copy of the example swaps Embeddings OpenAI for Embeddings Ollama; the loader, splitter and Qdrant nodes are the same as in the package copy.

| Check | Result |
|---|---|
| Import from URL | All seven nodes and the sticky note; n8n auto-attached the PrimeCut, Qdrant and Ollama credentials (one of each type exists) |
| Document > Chunk from the `data` binary field, wait on, Chunksets, Simplify | One item, `fileName: dummy.pdf`, same chunkset as the URL run |
| Default Data Loader 1.1: Load Specific Data `{{ $json.text }}`, Custom splitting, Character Text Splitter 100000 | Accepted as written; one Qdrant point per chunkset, `content` is the whole chunkset text (no re-split), `metadata.loc.lines` 1 to 3 |
| Loader metadata rows | `page 1`, `heading "Dummy PDF file"`, `fileName dummy.pdf`, `chunksetIndex 0` in the point payload. `canonicalUrl` was absent on the first run because the example set no Canonical URL; the example now sets it in the node's Options |
| Qdrant collection `primecut-demo` | Created by the insert (1024-dim cosine, bge-m3), 1 point |
| Chunk tree, URL versus binary (live API, same file) | Identical: idx 0 depth 0 "Sample Document Overview" (page 0), idx 1 depth 1 "Dummy PDF file", idx 2 depth 2 body; chunkset [0, 1, 2]. The `heading` rule (deepest member above the leaf) therefore yields "Dummy PDF file" on both paths |

### Job operations, timeout path and a multi-section document, local n8n UI (same day)

Run from `local-test/examples/ui-checks.json` (one branch per check, each leaf executed with Execute step so the one-job-at-a-time plan is never hit).

| Check | Result |
|---|---|
| Document > Chunk by URL, Wait for Result off | At once: `{ jobId, status: "pending", createdAt }` |
| Job > Get Status, `{{ $json.jobId }}` from the item above | First call `{ jobId, status: "pending", code: 0 }`; 40 s later `{ jobId, status: "done", detail: "done (cache hit)", resultReady: true, usage: { credits: 0, pages: 0, product: "pro", tokens: 0, total_runtime_sec: 0 } }`. The API serves a repeated URL from cache at no credit cost |
| Job > Get Results, Chunksets, Simplify on, Options Canonical URL | The same simplified item as a waited Chunk run, `canonicalUrl` taken from the Get Results options |
| Job > Get Results, Chunks, Simplify off | Three raw chunk objects; the image chunk carries `image_name: "image_00001.png"` |
| Chunk by URL, Wait on, Timeout 3 | Node error "Timed out waiting for PrimeCut job <id>" with the description "Raise 'Timeout (Seconds)', or fetch the result later with Job > Get Results using this job ID." Even a cached job takes longer than 3 s |
| Same with On Error = Continue | One item `{ error: "Timed out waiting for PrimeCut job <id>", jobId, status: "timeout" }`; a following Job > Get Results on `{{ $json.jobId }}` returned the chunkset. It was already finished 8 s after submission, so the "Job … is not finished yet" branch stayed harness-only |
| Chunk from binary: an HTML file with h1/h2/h3 sections (`local-test/sections.html`, fetched by an HTTP Request node) | 10 chunksets, one per section, from 22 chunks. `fileName: sections.html`; n8n reported the binary's MIME type as `application/json`, PrimeCut went by the file name |
| `heading` rule on that document | Chunkset 0 (title, intro) → "Orbital Logistics Handbook"; chunkset 1 (section 1 intro) → "1. Scheduling"; chunkset 2 → "1.1 Priority classes"; 3 → "1.2 Slot allocation"; 4 → "2. Loading"; 5 → "2.1 Weight limits"; 6 → "2.2 Hazardous goods"; 7 → "3. Tracking". The nearest section title every time |
| Raw chunk tree (Job > Get Results, Chunks, Simplify off) | Headings at depth 1 and 2 with `parent_chunk_index` pointing at their section, bodies one level deeper. A duplicate title chunk carries `metadata: "NOISE"`, a per-chunk field not seen on the PDF |

Observations, not defects of the node: a chunkset's `contents` ends with the heading of the first child section (chunkset 0 ends with "1. Scheduling"), which is how PrimeCut builds the path; and because every chunkset path starts at the root title, `firstChunk` is 0 for all of them, so `lastChunk` is the useful one.

### Review harness (mocked n8n, no network), after the review fixes

`scratchpad/review-run-primecut/{out,h,h2}.js`, written by the independent reviewer and rerun after the fixes: done-without-download keeps polling and the final round at the deadline collects a late finish; `download: null` is treated as not ready; `/results` 500 "job not ready" maps to "Job … is not finished yet"; a 401 on one job's status stays with that item; 429 pacing retries under one deadline and reports "No job slot became free for '<file>'"; `no_default_project`, `orga_has_no_owner` and a 402 egress reason get their own messages; a binary with no file name goes out as `document.pdf` (extension from the MIME type); item order and `pairedItem` hold in mixed batches.

### Not yet covered

- The "Job … is not finished yet" answer from Job > Get Results in the UI (harness only; the live job finished before the call)
- A document with tables, to see table placeholders
- A project API key; a 429 from a real concurrent-job limit
