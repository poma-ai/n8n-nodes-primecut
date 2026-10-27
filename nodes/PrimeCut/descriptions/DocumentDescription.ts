import type { INodeProperties } from 'n8n-workflow';

import { resultProperties } from './shared';

const show = { resource: ['document'] };

export const documentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'chunk',
		displayOptions: { show },
		options: [
			{
				name: 'Chunk',
				value: 'chunk',
				action: 'Chunk document',
				description:
					'Upload a file or URL, wait for PrimeCut to convert it, and return its chunksets or chunks',
			},
		],
	},
];

export const documentFields: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		default: 'binary',
		description: 'Where the document comes from',
		displayOptions: { show: { ...show, operation: ['chunk'] } },
		options: [
			{ name: 'Binary File', value: 'binary', description: 'A file in the binary data of the item' },
			{ name: 'URL', value: 'url', description: 'A publicly reachable URL PrimeCut fetches itself' },
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description: 'The name of the binary field that holds the file',
		hint: 'The file name is taken from the binary data; PrimeCut infers the format from it',
		displayOptions: { show: { ...show, operation: ['chunk'], source: ['binary'] } },
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. https://example.com/report.pdf',
		description: 'The URL of the document to chunk',
		displayOptions: { show: { ...show, operation: ['chunk'], source: ['url'] } },
	},
	{
		displayName: 'Wait for Result',
		name: 'wait',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until PrimeCut has finished and return the chunks. If off, returns the job ID immediately.',
		displayOptions: { show: { ...show, operation: ['chunk'] } },
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		default: 600,
		typeOptions: { minValue: 1 },
		description:
			'How long the node waits in total for the jobs to finish, and for a job slot to become free, across all input items',
		displayOptions: { show: { ...show, operation: ['chunk'] } },
	},
	...resultProperties({ ...show, operation: ['chunk'], wait: [true] }),
	{
		displayName: 'Options',
		name: 'chunkOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { ...show, operation: ['chunk'] } },
		options: [
			{
				displayName: 'Canonical URL',
				name: 'canonicalUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/docs/report.pdf',
				description:
					'Citation URL stored with the document and returned on every item, so downstream search results can cite the source',
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'string',
				default: '',
				placeholder: 'e.g. confidential, year:2026',
				description:
					'Comma-separated tags stored with the document for filtering later. Matching is case-insensitive and exact.',
			},
		],
	},
];
