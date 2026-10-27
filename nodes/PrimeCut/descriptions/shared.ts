import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

/** Return and Simplify, shared by Document > Chunk (when waiting) and Job > Get Results. */
export function resultProperties(show: IDisplayOptions['show']): INodeProperties[] {
	return [
		{
			displayName: 'Return',
			name: 'returnKind',
			type: 'options',
			default: 'chunksets',
			description: 'Which level of the result to return, one item each',
			options: [
				{
					name: 'Chunksets',
					value: 'chunksets',
					description: 'Groups of related chunks, the unit PrimeCut is built around',
				},
				{
					name: 'Chunks',
					value: 'chunks',
					description: 'The individual chunks',
				},
			],
			displayOptions: { show },
		},
		{
			displayName: 'Simplify',
			name: 'simplify',
			type: 'boolean',
			default: true,
			description:
				'Whether to return a simplified version of the response instead of the raw data',
			hint: "Simplified items carry 'text' plus flat fields such as page and fileName, ready for a vector store loader",
			displayOptions: { show },
		},
	];
}
