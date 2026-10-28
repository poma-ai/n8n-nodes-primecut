# Changelog

## 0.1.0 (unreleased)

- Pre-publish review fixes: labels are checked before any job is submitted; a Timeout expression that is not a number falls back to the default instead of polling without pause; a failed job with code 401, 404 or 429 reports a document problem rather than a request problem; documentMetadata is a deep copy per item.

- PrimeCut node: Document (Chunk from a file or URL, wait for the job, return chunksets or chunks), Job (Get Status, Get Results).
- PrimeCut API credential accepting project API keys and account API keys (optional Project ID), with a credential test.
- Include Metadata option on Chunk and Get Results: adds `documentMetadata` to every item and a `labels` array to simplified items.
