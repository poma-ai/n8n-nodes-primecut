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

### Review harness (mocked n8n, no network), after the review fixes

`scratchpad/review-run-primecut/{out,h,h2}.js`, written by the independent reviewer and rerun after the fixes: done-without-download keeps polling and the final round at the deadline collects a late finish; `download: null` is treated as not ready; `/results` 500 "job not ready" maps to "Job … is not finished yet"; a 401 on one job's status stays with that item; 429 pacing retries under one deadline and reports "No job slot became free for '<file>'"; `no_default_project`, `orga_has_no_owner` and a 402 egress reason get their own messages; a binary with no file name goes out as `document.pdf` (extension from the MIME type); item order and `pairedItem` hold in mixed batches.

### Not yet covered

- Return = Chunks and Simplify off in the UI (covered by a script against the real results payload)
- Job > Get Status and Job > Get Results in the UI
- A document with tables, to see table placeholders
- A project API key; a 429 from a real concurrent-job limit
