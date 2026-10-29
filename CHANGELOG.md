# Changelog

## Unreleased

- Node and credential icon is the POMA mark instead of a generic document drawing.

## 0.1.1 (2026-10-29)

- Published through npm trusted publishing (GitHub Actions OIDC) instead of an access token. No functional changes.

## 0.1.0 (2026-10-29)

- PrimeCut node: Document (Chunk from a file or URL, wait for the job, return chunksets or chunks), Job (Get Status, Get Results).
- PrimeCut API credential accepting project API keys and account API keys (optional Project ID), with a credential test.
- Include Metadata option on Chunk and Get Results: adds `documentMetadata` to every item and a `labels` array to simplified items.
