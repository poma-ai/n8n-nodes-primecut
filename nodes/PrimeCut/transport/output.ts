import { deepCopy, type IDataObject } from 'n8n-workflow';

import type { JobResults } from './jobs';

export type ReturnKind = 'chunksets' | 'chunks';

/** What the node knows about the document, from the request or from the results' metadata. */
export interface DocumentContext {
	jobId: string;
	fileName: string;
	canonicalUrl?: string;
	/** The results' metadata block, present only when the user asked for it. */
	metadata?: IDataObject;
}

interface Chunk extends IDataObject {
	chunk_index?: number;
	content?: string;
	depth?: number;
	page?: number;
	parent_chunk_index?: number | null;
	lang?: string;
	to_embed?: string;
}

interface Chunkset extends IDataObject {
	chunkset_index?: number;
	chunks?: number[];
	contents?: string;
	to_embed?: string;
}

/** The file name the results describe, when the request did not carry one (Job > Get Results). */
export function fileNameFromResults(results: JobResults): string {
	const metadata = results.metadata ?? {};
	const source = typeof metadata.source_file === 'string' ? metadata.source_file : '';
	const type = typeof metadata.source_type === 'string' ? metadata.source_type : '';
	if (source && type && !source.toLowerCase().endsWith(`.${type.toLowerCase()}`)) {
		return `${source}.${type}`;
	}
	return source || 'document';
}

function withEmbedText(target: IDataObject, text: string | undefined, embed: string | undefined) {
	if (typeof embed === 'string' && embed !== text) target.embedText = embed;
}

/** The document's labels, which PrimeCut stores as `meta_tags` in the results' metadata. */
export function labelsFromMetadata(metadata: IDataObject | undefined): string[] {
	const tags = metadata?.meta_tags;
	return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * Adds the results' metadata block to an item when the user asked for it, as
 * `documentMetadata`: a raw chunk can carry a `metadata` field of its own
 * (observed: `"NOISE"` on a duplicate title chunk), which must stay intact.
 * Simplified items also get a flat `labels` array, so a vector store loader
 * can map it like the other flat fields. Each item gets its own copy, so a
 * downstream node editing one item in place cannot change the others.
 */
function withMetadata(item: IDataObject, doc: DocumentContext, simplified: boolean): IDataObject {
	if (!doc.metadata) return item;
	const out: IDataObject = { ...item };
	if (simplified) out.labels = labelsFromMetadata(doc.metadata);
	out.documentMetadata = deepCopy(doc.metadata);
	return out;
}

/**
 * One n8n item per chunkset: `text` plus flat fields a vector store loader can
 * map. Page and heading come from the chunks the set spans.
 */
export function simplifyChunkset(
	chunkset: Chunkset,
	chunksByIndex: Map<number, Chunk>,
	doc: DocumentContext,
): IDataObject {
	const indices = Array.isArray(chunkset.chunks)
		? chunkset.chunks.filter((n): n is number => typeof n === 'number')
		: [];
	const members = indices.map((n) => chunksByIndex.get(n)).filter((c): c is Chunk => !!c);

	const pages = members.map((c) => c.page).filter((p): p is number => typeof p === 'number');
	const page = pages.find((p) => p > 0) ?? pages[0] ?? 0;

	// A chunkset spans a root-to-leaf path of the document tree (observed: title,
	// section, body). The heading is the deepest member above the leaf, which is
	// the nearest section title; a two-member set yields the document title.
	let heading: string | undefined;
	if (members.length > 1) {
		const leafDepth = members.reduce((max, c) => Math.max(max, c.depth ?? 0), 0);
		const ancestors = members.filter((c) => (c.depth ?? 0) < leafDepth);
		const nearest = ancestors.reduce<Chunk | undefined>(
			(best, c) => (best === undefined || (c.depth ?? 0) > (best.depth ?? 0) ? c : best),
			undefined,
		);
		const text = typeof nearest?.content === 'string' ? nearest.content.trim() : '';
		if (text) heading = text.length > 200 ? `${text.slice(0, 197)}...` : text;
	}

	const out: IDataObject = {
		text: chunkset.contents ?? '',
		jobId: doc.jobId,
		fileName: doc.fileName,
		chunksetIndex: chunkset.chunkset_index ?? null,
		// reduce rather than spread: a chunkset can span thousands of chunks
		firstChunk: indices.length ? indices.reduce((a, b) => (b < a ? b : a)) : null,
		lastChunk: indices.length ? indices.reduce((a, b) => (b > a ? b : a)) : null,
		page,
	};
	if (heading !== undefined) out.heading = heading;
	if (doc.canonicalUrl) out.canonicalUrl = doc.canonicalUrl;
	withEmbedText(out, chunkset.contents, chunkset.to_embed);
	return out;
}

/** One n8n item per chunk: `text` plus the chunk's own fields in camelCase. */
export function simplifyChunk(chunk: Chunk, doc: DocumentContext): IDataObject {
	const out: IDataObject = {
		text: chunk.content ?? '',
		jobId: doc.jobId,
		fileName: doc.fileName,
		chunkIndex: chunk.chunk_index ?? null,
		parentChunkIndex: chunk.parent_chunk_index ?? null,
		depth: chunk.depth ?? null,
		page: chunk.page ?? null,
		lang: chunk.lang ?? null,
	};
	if (doc.canonicalUrl) out.canonicalUrl = doc.canonicalUrl;
	withEmbedText(out, chunk.content, chunk.to_embed);
	return out;
}

/** Maps a results payload to output items per the Return and Simplify settings. */
export function resultsToItems(
	results: JobResults,
	kind: ReturnKind,
	simplify: boolean,
	doc: DocumentContext,
): IDataObject[] {
	const chunks = (results.chunks ?? []) as Chunk[];
	const chunksets = (results.chunksets ?? []) as Chunkset[];
	if (kind === 'chunks') {
		return simplify
			? chunks.map((c) => withMetadata(simplifyChunk(c, doc), doc, true))
			: chunks.map((c) => withMetadata(c, doc, false));
	}
	if (!simplify) return chunksets.map((cs) => withMetadata(cs, doc, false));
	const byIndex = new Map<number, Chunk>();
	for (const chunk of chunks) {
		if (typeof chunk.chunk_index === 'number') byIndex.set(chunk.chunk_index, chunk);
	}
	return chunksets.map((cs) => withMetadata(simplifyChunkset(cs, byIndex, doc), doc, true));
}
