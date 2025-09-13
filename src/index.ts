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

function isBotRequest(userAgent: string) {
	return BOT_AGENTS.some(bot => userAgent.includes(bot));
}

async function getText(resp: Response) {
	let charset = 'utf-8'; // default
	const contentType = resp.headers.get('content-type') || '';
	const charsetMatch = contentType.match(/charset=([^;]+)/i);
	if (charsetMatch && charsetMatch[1]) {
		charset = charsetMatch[1].toLowerCase();
	}

	const buffer = await resp.arrayBuffer();

	try {
		const decoder = new TextDecoder(charset);
		return decoder.decode(buffer);
	} catch (e) {
		console.error(`Invalid charset '${charset}', falling back to utf-8.`);
		const decoder = new TextDecoder('utf-8');
		return decoder.decode(buffer);
	}
}

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
					console.log(`Response from Origin: ${originResp.status}`);
					return originResp;
				}

				const htmlText = await getText(originResp.clone());

				const metaHtml = `${htmlText.split("<body>")[0]}<body></body></html>`;

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
