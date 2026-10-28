import type {
	IAuthenticate,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class PrimeCutApi implements ICredentialType {
	name = 'primeCutApi';

	displayName = 'PrimeCut API';

	documentationUrl = 'https://github.com/poma-ai/n8n-nodes-primecut#credentials';

	icon: Icon = { light: 'file:primecut.svg', dark: 'file:primecut.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'A project API key (starts with poma_proj_) or an account API key from console.poma-ai.com. A project key is bound to one project; an account key can address any of your projects.',
		},
		{
			displayName: 'Project ID',
			name: 'projectId',
			type: 'string',
			default: '',
			placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
			description:
				"The project to use with an account API key. Leave empty to use the account's default PrimeCut project. Leave empty with a project key, which already identifies its project.",
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'hidden',
			default: 'https://api.poma-ai.com/v3',
		},
	];

	// A function rather than a generic headers block, so X-Project-ID is only
	// sent when a project ID is set: an empty header would be rejected.
	authenticate: IAuthenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${String(credentials.apiKey ?? '').trim()}`,
		};
		const projectId = String(credentials.projectId ?? '').trim();
		if (projectId) headers['X-Project-ID'] = projectId;
		return {
			...requestOptions,
			headers: {
				...(requestOptions.headers as Record<string, string> | undefined),
				...headers,
			},
		};
	};

	// GET /activeJobs answers for account keys and project keys (checked live
	// 2026-10-27 and 2026-10-28); it lists the caller's running jobs and is
	// cheap. An unknown key answers 401; a key for the other product 403. The
	// route ignores X-Project-ID, so a mismatched Project ID only shows on the
	// first Chunk (409).
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/activeJobs',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'This key is for a different product. Use a PrimeCut key: a project key for a PrimeCut project, or an account key.',
				},
			},
			{
				type: 'responseCode',
				properties: { value: 401, message: 'The API key was rejected. Check it in the console.' },
			},
		],
	};
}
