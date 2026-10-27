import type { INodeProperties } from 'n8n-workflow';

import { resultProperties } from './shared';

const show = { resource: ['job'] };

export const jobOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getStatus',
		displayOptions: { show },
		options: [
			{
				name: 'Get Results',
				value: 'getResults',
				action: 'Get job results',
				description: 'Return the chunksets or chunks of a finished job',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get job status',
				description: 'Get the state of a chunking job started with waiting switched off',
			},
		],
	},
];

export const jobFields: INodeProperties[] = [
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
		description: 'The job ID returned by Document > Chunk',
		displayOptions: { show: { ...show, operation: ['getStatus', 'getResults'] } },
	},
	...resultProperties({ ...show, operation: ['getResults'] }),
	{
		displayName: 'Options',
		name: 'resultOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { ...show, operation: ['getResults'] } },
		options: [
			{
				displayName: 'Canonical URL',
				name: 'canonicalUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/docs/report.pdf',
				description:
					'Citation URL to put on every item, the same value given when the document was chunked',
			},
		],
	},
];
