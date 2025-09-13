/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const FETCH_HEADERS = new Headers({
	'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
});

const BOT_AGENTS = [
	'Slackbot',
	'Discordbot',
	'TelegramBot',
	'facebookexternalhit',
	'Twitterbot',
	'Googlebot',
];

const isBotRequest = (userAgent: string): boolean =>
	BOT_AGENTS.some(bot => userAgent.includes(bot));

const getText = async (resp: Response): Promise<string> => {
	const contentType = resp.headers.get('content-type') || '';
	const charsetMatch = contentType.match(/charset=([^;]+)/i);
	const charset = charsetMatch?.[1]?.toLowerCase() || 'utf-8';

	const buffer = await resp.arrayBuffer();

	try {
		return new TextDecoder(charset).decode(buffer);
	} catch {
		console.warn(`Invalid charset '${charset}', using utf-8 fallback.`);
		return new TextDecoder('utf-8').decode(buffer);
	}
};

const getHead = (html: string): string => {
	const match = html.match(/<head>(.*?)<\/head>/is);
	return match ? match[1] : '';
};

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const targetUrl = url.searchParams.get('url');

		if (!targetUrl) {
			return new Response('Invalid Request', { status: 400 });
		}

		const userAgent = request.headers.get('User-Agent') || '';

		if (isBotRequest(userAgent)) {
			try {
				const originResp = await fetch(targetUrl, {
					redirect: 'follow',
					headers: FETCH_HEADERS
				});
				if (!originResp.ok) {
					console.warn(`Origin response status: ${originResp.status}`);
					return originResp;
				}

				const htmlText = await getText(originResp.clone());
				let head = getHead(htmlText);

				const metaHtml = `<!DOCTYPE html><html><head>${head}</head><body></body></html>`;

				return new Response(metaHtml, {
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});

			} catch (e) {
				return new Response('Failed to fetch URL.', { status: 500 });
			}
		}

		return Response.redirect(targetUrl, 302);
	},
} satisfies ExportedHandler<Env>;
