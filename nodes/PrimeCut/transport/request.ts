import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface ApiResponse {
	statusCode: number;
	headers: Record<string, string | undefined>;
	body: unknown;
}

export interface ApiRequestOptions {
	body?: IDataObject | Buffer;
	qs?: IDataObject;
	headers?: Record<string, string>;
}

const CREDENTIAL_NAME = 'primeCutApi';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default pause before retrying after a 429, in seconds. Matches the API's documented default. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Sends one request to the PrimeCut API and returns the full response without
 * throwing on HTTP status codes. Callers decide what a non-2xx status means,
 * because the API answers some routes with JSON envelopes and others with
 * text/plain bodies, and because 429 is a pacing signal rather than a failure.
 */
export async function apiRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: ApiRequestOptions = {},
): Promise<ApiResponse> {
	const credentials = (await this.getCredentials(CREDENTIAL_NAME)) as {
		baseUrl?: string;
		projectId?: string;
	};
	const baseUrl = (credentials.baseUrl ?? 'https://api.poma-ai.com/v3').replace(/\/+$/, '');

	// The POMA API answers a malformed X-Project-ID with a 503 rather than a
	// 400 (observed 2026-10-26), so check the shape here and say what is wrong.
	const projectId = (credentials.projectId ?? '').trim();
	if (projectId && !UUID_PATTERN.test(projectId)) {
		throw new NodeOperationError(this.getNode(), "'Project ID' in the credential is not a UUID", {
			description:
				'Copy the project ID from console.poma-ai.com (36 characters with dashes), or leave it empty',
		});
	}

	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers: {
			Accept: 'application/json',
			...options.headers,
		},
		qs: options.qs,
		body: options.body,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	if (options.body !== undefined && !Buffer.isBuffer(options.body)) {
		requestOptions.json = true;
	}

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_NAME,
		requestOptions,
	)) as { statusCode: number; headers: Record<string, string | undefined>; body: unknown };

	return {
		statusCode: response.statusCode,
		headers: response.headers ?? {},
		body: parseBody(response.body),
	};
}

/** The API usually answers with JSON, but `/jobs/*` routes answer text/plain on some statuses. */
function parseBody(body: unknown): unknown {
	if (typeof body !== 'string') return body;
	const trimmed = body.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return body;
		}
	}
	return body;
}

export function isSuccess(response: ApiResponse): boolean {
	return response.statusCode >= 200 && response.statusCode < 300;
}

/**
 * Seconds to wait before retrying, from the Retry-After header or the body's
 * `retry_after_seconds`, falling back to the API default. Capped so a wild
 * value cannot park an execution for hours.
 */
export function retryAfterSeconds(response: ApiResponse, capSeconds = 60): number {
	const header = response.headers['retry-after'] ?? response.headers['Retry-After'];
	const fromHeader = header === undefined ? NaN : Number.parseInt(header, 10);
	let seconds = DEFAULT_RETRY_AFTER_SECONDS;
	if (Number.isFinite(fromHeader) && fromHeader > 0) {
		seconds = fromHeader;
	} else {
		const body = response.body as { retry_after_seconds?: unknown } | undefined;
		const fromBody = typeof body?.retry_after_seconds === 'number' ? body.retry_after_seconds : NaN;
		if (Number.isFinite(fromBody) && fromBody > 0) seconds = fromBody;
	}
	return Math.min(seconds, capSeconds);
}

interface ErrorEnvelope {
	error?: string;
	code?: number;
	reason?: string;
}

/** What the API said went wrong, from a JSON envelope or a plain-text body. */
export function errorText(body: unknown): { text: string; reason?: string } {
	if (typeof body === 'string') return { text: body.trim() };
	if (body && typeof body === 'object') {
		const envelope = body as ErrorEnvelope;
		if (typeof envelope.error === 'string') return { text: envelope.error, reason: envelope.reason };
	}
	return { text: '' };
}

export interface MappedError {
	message: string;
	description: string;
}

/**
 * Maps an HTTP status (or a failed job's code, which mirrors HTTP statuses) to
 * a message that says what happened and a description that says how to fix it.
 */
export function mapErrorCode(code: number, detail: string, reason?: string): MappedError {
	const suffix = detail ? `: ${detail}` : '';
	switch (code) {
		case 400:
			if (reason === 'no_default_project') {
				return {
					message: 'No project is selected for this account API key',
					description:
						"Enter the 'Project ID' in the credential, or set a default PrimeCut project for the account in the console",
				};
			}
			return {
				message: `The request was rejected${suffix}`,
				description: 'Check the file name, URL and options',
			};
		case 401:
			return {
				message: 'The API key was rejected',
				description:
					'Check the key in the credential, and that its project (or the Project ID) has the PrimeCut product',
			};
		case 402:
			if (reason === 'legacy_pricing_retired') {
				return {
					message: 'The account is on a retired PrimeCut plan',
					description: 'Switch the account to the current plan at console.poma-ai.com',
				};
			}
			if (reason && !/quota|credit|insufficient/i.test(`${reason} ${detail}`)) {
				return {
					message: `Payment is required for this request${suffix}`,
					description: 'Resolve it at console.poma-ai.com, then run the document again',
				};
			}
			return {
				message: 'The account has no credits left for this request',
				description: 'Top up credits at console.poma-ai.com',
			};
		case 403:
			// Observed 2026-10-28: a key for the other POMA product answers
			// 403 "API key not valid for this product".
			if (/not valid for this product/i.test(`${detail} ${reason ?? ''}`)) {
				return {
					message: 'The API key is for a different product',
					description:
						'Use a PrimeCut key in this credential: a project key for a PrimeCut project, or an account key',
				};
			}
			// Observed 2026-10-28: an account key with a Project ID it cannot use
			// answers 403 "Project not found or access denied".
			if (/project not found/i.test(detail)) {
				return {
					message: "'Project ID' in the credential is not a project this key can use",
					description:
						'Check the ID in the console, or clear it to use the default PrimeCut project of the account',
				};
			}
			return {
				message: 'The request was refused for this project',
				description: "Check the project's protection settings and that the key belongs to it",
			};
		case 404:
			return {
				message: 'The job was not found',
				description: 'Check the job ID, and that it belongs to this account',
			};
		case 409:
			if (reason === 'project_id_conflict') {
				return {
					message: "The 'Project ID' in the credential does not match the project key's project",
					description: "Clear 'Project ID' when using a project key, or use an account key",
				};
			}
			if (reason === 'orga_has_no_owner') {
				return {
					message: 'The project belongs to an organisation without an owner',
					description: 'Assign an owner to the organisation at console.poma-ai.com',
				};
			}
			if (detail) {
				return {
					message: `The request conflicts with the current state${suffix}`,
					description: 'Check the project and the key in the credential',
				};
			}
			return {
				message: 'The request conflicts with the current state',
				description: 'Check the project and the key in the credential, or the job in the console',
			};
		case 413:
			return {
				message: 'The document is too large for one job',
				description: 'Split the document and chunk the parts separately',
			};
		case 415:
			return {
				message: 'The document type is not supported',
				description: 'Convert the document to a supported format and try again',
			};
		case 422:
			return {
				message: 'The document could not be read',
				description: 'Check that the file is not damaged, encrypted or empty',
			};
		case 429:
			return {
				message: 'The account is at its concurrent job limit',
				description: "Raise 'Timeout (Seconds)' or run fewer executions at once",
			};
		default:
			if (code >= 500) {
				return {
					message: `PrimeCut did not complete the request${suffix}`,
					description: 'Try again later',
				};
			}
			return {
				message: `PrimeCut answered with status ${code}${suffix}`,
				description: 'Check the request and try again',
			};
	}
}

/** Builds the NodeApiError for a non-2xx response. */
export function apiError(
	this: ApiContext,
	response: ApiResponse,
	itemIndex?: number,
): NodeApiError {
	const { text, reason } = errorText(response.body);
	const mapped = mapErrorCode(response.statusCode, text, reason);
	const errorResponse: JsonObject = {
		statusCode: response.statusCode,
		reason: reason ?? null,
		body: typeof response.body === 'string' ? response.body : (response.body as JsonObject),
	};
	return new NodeApiError(this.getNode(), errorResponse, {
		message: mapped.message,
		description: mapped.description,
		httpCode: String(response.statusCode),
		itemIndex,
	});
}

/** RFC 5987 percent-encoding: encodeURIComponent plus the characters it leaves alone. */
function rfc5987(value: string): string {
	return encodeURIComponent(value).replace(
		/['()*!]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * Builds the Content-Disposition header the ingest route needs. Node rejects
 * header values outside Latin-1, so the quoted form carries an ASCII fallback
 * and the RFC 5987 form carries the real name. A name that cannot be encoded
 * (an unpaired surrogate) falls back to the ASCII form in both places.
 */
export function contentDisposition(fileName: string): string {
	const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
	let encoded: string;
	try {
		encoded = rfc5987(fileName);
	} catch {
		encoded = rfc5987(ascii);
	}
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** JSON for a header: non-ASCII characters become \uXXXX escapes so the value survives Latin-1 transport. */
export function jsonHeaderValue(value: unknown): string {
	return JSON.stringify(value).replace(
		/[\u007f-\uffff]/g,
		(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
	);
}

/**
 * A URL for a header. ASCII URLs pass through untouched. A URL with non-ASCII
 * characters is normalised by the URL parser, which punycodes the host and
 * percent-encodes the path without touching escapes that are already there.
 */
export function urlHeaderValue(url: string): string {
	if (!/[^\x20-\x7e]/.test(url)) return url;
	try {
		return new URL(url).href;
	} catch {
		try {
			return encodeURI(url);
		} catch {
			return url.replace(/[^\x20-\x7e]/g, '_');
		}
	}
}
