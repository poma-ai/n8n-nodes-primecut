import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { documentFields, documentOperations } from './descriptions/DocumentDescription';
import { jobFields, jobOperations } from './descriptions/JobDescription';
import {
	asJobStatus,
	failedJobError,
	getJobResults,
	isResultReady,
	isSettled,
	outcomeFromStatus,
	pollJobs,
	submitWithPacing,
	timeoutError,
	type PendingJob,
} from './transport/jobs';
import { fileNameFromResults, resultsToItems, type ReturnKind } from './transport/output';
import {
	apiError,
	apiRequest,
	contentDisposition,
	isSuccess,
	jsonHeaderValue,
	urlHeaderValue,
} from './transport/request';

interface ChunkOptions {
	canonicalUrl?: string;
	labels?: string;
}

interface PublicJob {
	job_id: string;
	created_at?: string;
	status?: { status?: string };
}

interface ChunkJob extends PendingJob {
	fileName: string;
	canonicalUrl?: string;
}

export class PrimeCut implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PrimeCut',
		name: 'primeCut',
		icon: { light: 'file:primecut.svg', dark: 'file:primecut.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Chunk a document from a URL or file into chunksets with PrimeCut, or fetch the results of a chunking job',
		defaults: {
			name: 'PrimeCut',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'primeCutApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'document',
				options: [
					{ name: 'Document', value: 'document' },
					{ name: 'Job', value: 'job' },
				],
			},
			...documentOperations,
			...documentFields,
			...jobOperations,
			...jobFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const results: INodeExecutionData[][] = items.map(() => []);
		const pending: ChunkJob[] = [];
		let deadline = 0;

		const push = (i: number, json: IDataObject) => {
			results[i].push({ json, pairedItem: { item: i } });
		};

		const fail = (i: number, error: unknown, extra: IDataObject = {}) => {
			const nodeError =
				error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			if (this.continueOnFail()) {
				push(i, { error: nodeError.message, ...extra });
				return;
			}
			throw nodeError;
		};

		// Phase 1: every operation runs now; chunk jobs that wait are only submitted.
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'document' && operation === 'chunk') {
					const wait = this.getNodeParameter('wait', i, true) as boolean;
					const timeout = this.getNodeParameter('timeout', i, 600) as number;
					if (deadline === 0) deadline = Date.now() + Math.max(1, timeout) * 1000;

					const { fileName, canonicalUrl, ...request } = await buildChunkRequest.call(this, i);
					const response = await submitWithPacing.call(
						this,
						async () => await apiRequest.call(this, 'POST', '/primeCut/ingest', request),
						deadline,
					);
					if (response.statusCode === 429) {
						throw new NodeOperationError(
							this.getNode(),
							`No job slot became free for '${fileName}' within the timeout`,
							{
								description:
									"Raise 'Timeout (Seconds)', run fewer executions at once, or wait for running jobs to finish",
								itemIndex: i,
							},
						);
					}
					if (!isSuccess(response)) throw apiError.call(this, response, i);
					const job = response.body as PublicJob;
					if (wait) {
						pending.push({ itemIndex: i, jobId: job.job_id, fileName, canonicalUrl });
					} else {
						push(i, {
							jobId: job.job_id,
							status: job.status?.status ?? 'pending',
							createdAt: job.created_at ?? null,
						});
					}
				} else if (resource === 'job' && operation === 'getStatus') {
					const jobId = getJobId.call(this, i);
					const response = await apiRequest.call(
						this,
						'GET',
						`/jobs/${encodeURIComponent(jobId)}/status`,
					);
					if (!isSuccess(response)) throw apiError.call(this, response, i);
					const status = asJobStatus(response.body);
					if (!status) {
						throw new NodeOperationError(
							this.getNode(),
							`The status of job ${jobId} came back in an unexpected shape`,
							{ description: 'Try again; if it persists, check the job in the console', itemIndex: i },
						);
					}
					push(i, outcomeFromStatus(status) as unknown as IDataObject);
				} else if (resource === 'job' && operation === 'getResults') {
					const jobId = getJobId.call(this, i);
					const jobResults = await getJobResults.call(this, jobId, i);
					const kind = this.getNodeParameter('returnKind', i, 'chunksets') as ReturnKind;
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					const mapped = resultsToItems(jobResults, kind, simplify, {
						jobId,
						fileName: fileNameFromResults(jobResults),
					});
					for (const item of mapped) push(i, item);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				fail(i, error);
			}
		}

		// Phase 2: wait for the submitted jobs together, under one deadline, then
		// fetch and map the results of the ones that finished.
		if (pending.length > 0) {
			await pollJobs.call(this, pending, deadline);
			for (const job of pending) {
				const i = job.itemIndex;
				try {
					if (job.error) throw job.error;
					if (job.status === undefined || !isSettled(job.status)) {
						fail(i, timeoutError.call(this, job.jobId, i, job.lastProblem), {
							jobId: job.jobId,
							status: 'timeout',
						});
						continue;
					}
					if (!isResultReady(job.status)) {
						fail(
							i,
							failedJobError.call(this, job.status, i),
							outcomeFromStatus(job.status) as unknown as IDataObject,
						);
						continue;
					}
					const kind = this.getNodeParameter('returnKind', i, 'chunksets') as ReturnKind;
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					const jobResults = await getJobResults.call(this, job.jobId, i);
					const mapped = resultsToItems(jobResults, kind, simplify, {
						jobId: job.jobId,
						fileName: job.fileName,
						canonicalUrl: job.canonicalUrl,
					});
					for (const item of mapped) push(i, item);
				} catch (error) {
					fail(i, error, { jobId: job.jobId });
				}
			}
		}

		return [results.flat()];
	}
}

async function buildChunkRequest(
	this: IExecuteFunctions,
	i: number,
): Promise<{
	body?: Buffer;
	headers: Record<string, string>;
	fileName: string;
	canonicalUrl?: string;
}> {
	const source = this.getNodeParameter('source', i) as string;
	const options = this.getNodeParameter('chunkOptions', i, {}) as ChunkOptions;
	const headers: Record<string, string> = {};
	let body: Buffer | undefined;
	let fileName: string;

	if (source === 'binary') {
		const propertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const binary = this.helpers.assertBinaryData(i, propertyName);
		body = await this.helpers.getBinaryDataBuffer(i, propertyName);
		fileName = binary.fileName || 'document';
		// The API infers the format from the file name. The body is always raw bytes;
		// application/json would be read as a JSON job description instead.
		headers['Content-Type'] = 'application/octet-stream';
		headers['Content-Disposition'] = contentDisposition(fileName);
	} else {
		const url = (this.getNodeParameter('url', i) as string).trim();
		if (!url) {
			throw new NodeOperationError(this.getNode(), "'URL' is empty", {
				description: 'Enter the public URL of the document to chunk',
				itemIndex: i,
			});
		}
		headers['X-Remote-URL'] = urlHeaderValue(url);
		fileName = fileNameFromUrl(url);
	}

	const canonicalUrl = options.canonicalUrl?.trim() || undefined;
	if (canonicalUrl) headers['X-Canonical-URL'] = urlHeaderValue(canonicalUrl);

	const labels = (options.labels ?? '')
		.split(',')
		.map((label) => label.trim())
		.filter((label) => label.length > 0);
	if (labels.length > 0) headers['X-Labels'] = jsonHeaderValue(labels);

	return { body, headers, fileName, canonicalUrl };
}

function fileNameFromUrl(url: string): string {
	try {
		const last = new URL(url).pathname.split('/').filter(Boolean).pop();
		return last ? decodeURIComponent(last) : url;
	} catch {
		return url;
	}
}

function getJobId(this: IExecuteFunctions, i: number): string {
	const jobId = (this.getNodeParameter('jobId', i) as string).trim();
	if (!jobId) {
		throw new NodeOperationError(this.getNode(), "'Job ID' is empty", {
			description: 'Enter the job ID returned by Document > Chunk',
			itemIndex: i,
		});
	}
	return jobId;
}
