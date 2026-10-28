# n8n-nodes-primecut

An [n8n](https://n8n.io) community node for [PrimeCut](https://poma-ai.com) by POMA AI. PrimeCut converts documents (PDF, Office files, images, spreadsheets and more) into **chunks** and **chunksets**: structure-aware pieces of text ready for embeddings and vector stores. Use it in place of n8n's default text splitter when you run your own vector store and retrieval.


## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n docs. The package name is `n8n-nodes-primecut`.

## Credentials

Create an API key at [console.poma-ai.com](https://console.poma-ai.com), then add a **PrimeCut API** credential in n8n:

| Key kind | API Key | Project ID |
|----------|---------|------------|
| Project key (`poma_proj_…`), bound to one project | the key | leave empty |
| Account key, can address any of your projects | the key | the project to use, or empty for the account's default PrimeCut project |

The node sends the key as a Bearer token and, when Project ID is set, an `X-Project-ID` header. The credential test lists the account's active jobs (`GET /activeJobs`).

## Operations

| Resource | Operation | What it does |
|----------|-----------|--------------|
| Document | Chunk | Upload a file (binary field) or a URL. PrimeCut converts and chunks it. By default the node waits for the job and returns one item per chunkset (or per chunk). With waiting off it returns the `jobId` right away. |
| Job | Get Status | State of a chunking job started with waiting off. |
| Job | Get Results | The chunksets or chunks of a finished job, same output settings as Chunk, including **Include Metadata** under Options. |

### Output

With **Simplify** on (the default) and **Return** set to Chunksets, each item looks like:

```json
{
  "text": "Sample Document Overview\nDummy PDF file\n[IMAGE:Dummy PDF file]",
  "jobId": "6fc01271-…",
  "fileName": "report.pdf",
  "chunksetIndex": 0,
  "firstChunk": 0,
  "lastChunk": 2,
  "page": 1,
  "heading": "Dummy PDF file",
  "canonicalUrl": "https://example.com/report.pdf",
  "embedText": "…"
}
```

`page` is the first page the chunkset's chunks come from (a document-level chunk reports page 0). `heading` is the nearest section title above the chunkset's leaf chunk (the document title for a set directly under the root). A chunkset is a root-to-leaf path through the document, so `firstChunk` is usually 0 and `lastChunk` identifies the set. `embedText` is PrimeCut's embedding variant of the text (usually the same words with whitespace normalised); embed `text` unless you want it. Image and table placeholders such as `[IMAGE:Dummy PDF file]` stay inline in `text`.

With Return set to Chunks each item carries `text`, `chunkIndex`, `parentChunkIndex`, `depth`, `page`, `lang`. With Simplify off the raw chunkset or chunk objects are returned.

**Include Metadata**, under Options on both Chunk and Get Results, adds `documentMetadata` to every item: the details PrimeCut stored with the document (`source_file`, `source_type`, `file_id`, `version`, `creation_date`, `chunk_page_numbering` and the labels as `meta_tags`). Simplified items also get `labels`, the document's labels as an array, ready to map into a vector store payload for filtering. It is off by default, and without it the output is exactly as shown above.

### Feeding a vector store

n8n's Default Data Loader re-splits text at 1000 characters by default and ignores incoming fields, which would undo PrimeCut's work. Wire it like this (the `examples/chunk-file-to-qdrant.json` workflow does):

- Default Data Loader: Type of Data **JSON**, Mode **Load Specific Data**, Data `{{ $json.text }}`, Text Splitting **Custom**
- Character Text Splitter under it with a chunk size larger than any chunkset, for example 100000, so nothing is re-split
- Metadata on the loader: `page`, `heading`, `fileName`, `chunksetIndex`, `canonicalUrl` mapped from `{{ $json.<field> }}`, plus `labels` when Include Metadata is on

With these settings Qdrant stores one point per chunkset, the whole chunkset text as `content` and the mapped fields in the payload. For a local Qdrant, `docker compose up` in this package starts one next to n8n (credential URL `http://qdrant:6333`, no API key, dashboard at http://127.0.0.1:6333/dashboard). The example uses OpenAI embeddings; any embeddings node works in its place, for example Embeddings Ollama with `bge-m3` for a setup with no external keys besides PrimeCut.

### Chunk behaviour

- Input items are all submitted first, then the node waits for the jobs together under one deadline (**Timeout (Seconds)**, default 600, taken from the first Chunk item).
- When the account is at its concurrent job limit the API answers `429`; the node waits the suggested `Retry-After` and retries within the deadline. Demo accounts allow one job at a time.
- A job is finished when it is `done` and its result is stored; `failed` and `blocked` are final. A job still running at the deadline fails with its job ID in the message so it can be fetched later with **Job > Get Results**. With "Continue on fail" the item carries `{ error, jobId, status: "timeout" }`.
- Results too large to return inline (the API reports `skipped_members`) raise an error pointing at the archive download instead of returning a partial set.

## Using the node as an AI Agent tool

The node declares `usableAsTool`. The operations that make sense for an agent are Chunk from a URL and the Job operations; Chunk from a binary field needs a file an agent cannot supply.

## Compatibility

Works on current n8n releases. Built against n8n-workflow 2.44 on Node 22, with no runtime dependencies.

## Development

```bash
fnm use            # Node 22, from .node-version
npm install
npm run lint
npm run build
npm run dev        # the n8n-node CLI starts n8n with this node loaded, http://localhost:5678
```

`docker compose up` starts a plain n8n container with the built `dist/` mounted as a custom extension, plus a Qdrant container for the vector store example.

## Example workflows

Importable workflows live in [`examples/`](examples). In n8n, choose **Import from File** from the workflow menu, pick the JSON file, then add your credential to the PrimeCut node.

| File | What it shows |
|------|---------------|
| [`chunk-url.json`](examples/chunk-url.json) | Chunk a document by URL, wait, get one item per chunkset |
| [`chunk-file-to-qdrant.json`](examples/chunk-file-to-qdrant.json) | Download a file, chunk it from the binary field, insert the chunksets into Qdrant with the loader settings above |

## Release

A version tag triggers `.github/workflows/publish.yml`, which builds the package and publishes it to npm with a provenance statement. `npm run release` lints, builds, bumps the version, tags and pushes.

## Resources

- [PrimeCut](https://poma-ai.com)
- [POMA API reference](https://api.poma-ai.com/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
