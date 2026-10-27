import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import {
	apiError,
	apiRequest,
	errorText,
	isSuccess,
	mapErrorCode,
	retryAfterSeconds,
	type ApiResponse,
} from './request';

export type JobState = 'pending' | 'processing' | 'indexing' | 'done' | 'failed' | 'blocked';

export interface JobStatus {
	job_id: string;
	status: JobState;
	code?: number;
	detail?: unknown;
	download?: { download_url?: string; size?: number; mime_type?: string; expires_at?: string };
	usage?: IDataObject;
	[key: string]: unknown;
}

export interface JobResults {
	chunks?: IDataObject[];
	chunksets?: IDataObject[];
	images?: IDataObject;
	tables?: IDataObject;
	code?: IDataObject;
	metadata?: IDataObject;
	skipped_members?: Array<{ file: string; reason: string; size_bytes?: number; max_bytes?: number }>;
	[key: string]: unknown;
}

const FIRST_POLL_MS = 2000;
const POLL_INTERVAL_MS = 5000;

/** The body of a 200 from the status route, when it has the shape the node relies on. */
export function asJobStatus(body: unknown): JobStatus | undefined {
	if (!body || typeof body !== 'object') return undefined;
	const candidate = body as JobStatus;
	return typeof candidate.status === 'string' && typeof candidate.job_id === 'string'
		? candidate
		: undefined;
}

/** A PrimeCut job is finished when it failed, was blocked, or is done AND its result is stored. */
export function isSettled(status: JobStatus): boolean {
	if (status.status === 'failed' || status.status === 'blocked') return true;
	return status.status === 'done' && status.download !== undefined;
}

export function isResultReady(status: JobStatus): boolean {
	return status.status === 'done' && status.download !== undefined;
}

/**
 * Submits a request that creates a job, pacing on 429 until the deadline.
 * Returns the response of the final attempt; the caller checks success.
 */
export async function submitWithPacing(
	this: IExecuteFunctions,
	send: () => Promise<ApiResponse>,
	deadline: number,
): Promise<ApiResponse> {
	for (;;) {
		const response = await send();
		if (response.statusCode !== 429) return response;
		const waitMs = retryAfterSeconds(response) * 1000;
		if (Date.now() + waitMs > deadline) return response;
		await sleep(waitMs);
	}
}

/** Fetches the parsed results of a finished job. */
export async function getJobResults(
	this: IExecuteFunctions,
	jobId: string,
	itemIndex: number,
): Promise<JobResults> {
	const response = await apiRequest.call(this, 'GET', `/jobs/${encodeURIComponent(jobId)}/results`);
	if (!isSuccess(response)) throw apiError.call(this, response, itemIndex);
	const results = response.body as JobResults;
	const skipped = results.skipped_members ?? [];
	if (skipped.length > 0) {
		const names = skipped.map((member) => `${member.file} (${member.reason})`).join(', ');
		throw new NodeOperationError(
			this.getNode(),
			`Results for job ${jobId} are too large to return inline. Download them from the POMA console or use the archive endpoint.`,
			{
				description: `Members left out: ${names}`,
				itemIndex,
			},
		);
	}
	return results;
}

/** The shape a job item ends up with when the node does not wait, or on Job > Get Status. */
export interface JobOutcome {
	jobId: string;
	status: JobState | 'timeout';
	code?: number;
	detail?: unknown;
	resultReady?: boolean;
	usage?: IDataObject;
}

export function outcomeFromStatus(status: JobStatus): JobOutcome {
	const done = status.status === 'done';
	return {
		jobId: status.job_id,
		status: status.status,
		...(!done && status.code !== undefined ? { code: status.code } : {}),
		...(status.detail !== undefined && status.detail !== 'done' ? { detail: status.detail } : {}),
		...(done ? { resultReady: status.download !== undefined } : {}),
		...(status.usage ? { usage: status.usage } : {}),
	};
}

/**
 * Throws the error a failed or blocked job deserves. The job's `code` mirrors
 * an HTTP status, so it goes through the same mapping as HTTP responses.
 */
export function failedJobError(
	this: IExecuteFunctions,
	status: JobStatus,
	itemIndex: number,
): NodeOperationError {
	const code = typeof status.code === 'number' ? status.code : status.status === 'blocked' ? 403 : 500;
	const { text, reason } = errorText(status.detail);
	const detail =
		text ||
		(status.detail === undefined || typeof status.detail === 'string'
			? ''
			: JSON.stringify(status.detail));
	const mapped = mapErrorCode(code, detail, reason);
	return new NodeOperationError(this.getNode(), mapped.message, {
		description: `${mapped.description} (job ${status.job_id})`,
		itemIndex,
	});
}

export function timeoutError(
	this: IExecuteFunctions,
	jobId: string,
	itemIndex: number,
	lastProblem?: string,
): NodeOperationError {
	const cause = lastProblem ? ` The last status check did not get an answer: ${lastProblem}.` : '';
	return new NodeOperationError(this.getNode(), `Timed out waiting for PrimeCut job ${jobId}`, {
		description: `Raise 'Timeout (Seconds)', or fetch the result later with Job > Get Results using this job ID.${cause}`,
		itemIndex,
	});
}

export interface PendingJob {
	itemIndex: number;
	jobId: string;
	status?: JobStatus;
	/** Set when a status call answered with a non-transient failure (401, 403, 404, ...). */
	error?: NodeApiError;
	/** The most recent transient failure, kept so a timeout can say why polling got nowhere. */
	lastProblem?: string;
}

function isOpen(job: PendingJob): boolean {
	return job.error === undefined && (job.status === undefined || !isSettled(job.status));
}

/**
 * Polls every open job, one request at a time, in rounds, until each job is
 * settled or the deadline passes. After the deadline one final round runs so
 * jobs that finished during the submit phase are not reported as timed out.
 *
 * A `done` status without a `download` block means the result is not stored
 * yet; the job stays open. A transient answer (5xx, or a request that failed
 * before an answer) also leaves the job open. A non-transient failure is
 * recorded on the job so the caller can report it per item.
 */
export async function pollJobs(
	this: IExecuteFunctions,
	jobs: PendingJob[],
	deadline: number,
): Promise<void> {
	const open = () => jobs.filter(isOpen);
	if (open().length === 0) return;

	const remainingMs = () => Math.max(0, deadline - Date.now());
	let finalRound = remainingMs() === 0;
	if (!finalRound) await sleep(Math.min(FIRST_POLL_MS, remainingMs()));

	for (;;) {
		for (const job of open()) {
			let response: ApiResponse;
			try {
				response = await apiRequest.call(
					this,
					'GET',
					`/jobs/${encodeURIComponent(job.jobId)}/status`,
				);
			} catch (problem) {
				job.lastProblem = (problem as Error).message;
				continue;
			}
			if (response.statusCode === 429) {
				await sleep(Math.min(retryAfterSeconds(response) * 1000, remainingMs()));
				continue;
			}
			if (response.statusCode >= 500) {
				job.lastProblem = `status ${response.statusCode}`;
				continue;
			}
			if (!isSuccess(response)) {
				job.error = apiError.call(this, response, job.itemIndex);
				continue;
			}
			const status = asJobStatus(response.body);
			if (!status) {
				job.lastProblem = 'the status answer had an unexpected shape';
				continue;
			}
			job.status = status;
		}
		if (open().length === 0 || finalRound) return;
		if (remainingMs() === 0) {
			finalRound = true;
			continue;
		}
		await sleep(Math.min(POLL_INTERVAL_MS, remainingMs()));
		if (remainingMs() === 0) finalRound = true;
	}
}
