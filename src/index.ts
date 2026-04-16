const BOT_AGENTS = [
	'slackbot',
	'discordbot',
	'telegrambot',
	'facebookexternalhit',
	'twitterbot',
	'googlebot',
	'linkedinbot',
	'whatsapp',
	'notion',
];

const FETCH_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	'Upgrade-Insecure-Requests': '1',
};

type WorkerEnv = Env & {
	ALLOWED_DOMAINS?: string;
};

const isBotRequest = (request: Request): boolean => {
	const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();

	return BOT_AGENTS.some(bot => userAgent.includes(bot));
};

const getAllowedDomains = (env: WorkerEnv): string[] =>
	(env.ALLOWED_DOMAINS || '')
		.split(',')
		.map(domain => domain.trim().toLowerCase())
		.filter(Boolean);

const ensureAllowedDomain = (targetURL: URL, allowedDomains: string[]): Response | null => {
	if (allowedDomains.length === 0) {
		return null;
	}

	const hostname = targetURL.hostname.toLowerCase();
	const isAllowed = allowedDomains.some(domain =>
		hostname === domain || hostname.endsWith(`.${domain}`),
	);

	return isAllowed ? null : new Response('Domain not in whitelist', { status: 403 });
};

const isPrivateHostname = (hostname: string): boolean => {
	const normalized = hostname.toLowerCase();
	if (normalized === 'localhost') {
		return true;
	}

	if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
		const octets = normalized.split('.').map(Number);
		const [a, b] = octets;
		return (
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}

	if (normalized === '::1') {
		return true;
	}

	return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
};

const getText = async (resp: Response): Promise<string> => {
	const contentType = resp.headers.get('content-type') || '';
	const charsetMatch = contentType.match(/charset=([^;]+)/i);
	const charset = charsetMatch?.[1]?.trim().toLowerCase() || 'utf-8';
	const buffer = await resp.arrayBuffer();

	try {
		return new TextDecoder(charset).decode(buffer);
	} catch {
		console.warn(`Invalid charset '${charset}', using utf-8 fallback.`);
		return new TextDecoder().decode(buffer);
	}
};

const getHead = (html: string): string => {
	const match = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
	return match ? match[1] : '';
};

const createPreviewResponse = async (targetURL: URL): Promise<Response> => {
	const originResp = await fetch(targetURL, {
		redirect: 'follow',
		headers: FETCH_HEADERS,
	});

	if (!originResp.ok) {
		console.warn(`Origin response status: ${originResp.status}`);
		return new Response(`Origin response status: ${originResp.status}`, { status: originResp.status });
	}

	const contentType = originResp.headers.get('content-type') || '';
	if (!(contentType.includes('text/html') || contentType.includes('application/xhtml+xml'))) {
		return new Response('Preview requires an HTML document.', { status: 415 });
	}

	const htmlText = await getText(originResp);
	const head = getHead(htmlText);
	const metaHtml = `<!DOCTYPE html><html><head>${head}</head><body></body></html>`;

	return new Response(metaHtml, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
};

const createHomeResponse = (): Response =>
	new Response('Usage: /?url=https://example.com', {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});

const validateTargetUrl = (targetUrl: string): { targetURL: URL | null; error: Response | null } => {
	try {
		const parsed = new URL(targetUrl);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return { targetURL: null, error: new Response('Invalid Request', { status: 400 }) };
		}

		if (isPrivateHostname(parsed.hostname)) {
			return {
				targetURL: null,
				error: new Response('Private network targets are not allowed', { status: 403 }),
			};
		}

		return { targetURL: parsed, error: null };
	} catch {
		return { targetURL: null, error: new Response('Invalid Request', { status: 400 }) };
	}
};

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const targetUrl = url.searchParams.get('url');

		if (!targetUrl) {
			return url.pathname === '/' ? createHomeResponse() : new Response('Invalid Request', { status: 400 });
		}

		const { targetURL, error } = validateTargetUrl(targetUrl);
		if (!targetURL) {
			return error || new Response('Invalid Request', { status: 400 });
		}

		const allowedDomains = getAllowedDomains(env as WorkerEnv);
		const domainError = ensureAllowedDomain(targetURL, allowedDomains);
		if (domainError) {
			return domainError;
		}

		if (isBotRequest(request)) {
			try {
				return await createPreviewResponse(targetURL);
			} catch (error) {
				console.warn('Preview fetch failed', error);
				return new Response('Failed to fetch URL.', { status: 500 });
			}
		}

		return Response.redirect(targetURL.href, 302);
	},
} satisfies ExportedHandler<Env>;
