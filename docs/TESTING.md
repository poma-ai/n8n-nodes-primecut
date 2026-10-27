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
| Document > Chunk by URL, wait on, Chunksets, Simplify | Finished in about 20 s. One item: `text`, `jobId`, `fileName: dummy.pdf`, `chunksetIndex 0`, `firstChunk 0`, `lastChunk 2`, `page 1`, `heading "Sample Document Overview"`, `canonicalUrl`, `embedText` |

### Not yet covered

- Chunk from a binary field through the node in the UI (the mapping and request shape are shared with the tested index4.ai node; the API accepted the same headers in V1)
- Return = Chunks and Simplify off in the UI (covered by a script against the real results payload)
- Job > Get Status and Job > Get Results in the UI
- `examples/chunk-file-to-qdrant.json` end to end: the Default Data Loader and Character Text Splitter parameter names in that file were written from n8n's node definitions as remembered, not verified against a running Qdrant; the spec's V1 loader check is still open
- A document with tables, to see table placeholders
- A project API key; a 429 from a real concurrent-job limit
