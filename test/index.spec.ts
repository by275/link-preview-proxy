import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('link preview worker', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('returns head-only HTML for preview bots', async () => {
		fetchSpy.mockResolvedValue(
			new Response('<!DOCTYPE html><html><head><meta property="og:title" content="Hello"></head><body>Body</body></html>', {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			}),
		);

		const request = new IncomingRequest('https://worker.example/?url=https://example.com/article', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(
			'<!DOCTYPE html><html><head><meta property="og:title" content="Hello"></head><body></body></html>',
		);
	});

	it('matches bot user agents case-insensitively', async () => {
		fetchSpy.mockResolvedValue(
			new Response('<!DOCTYPE html><html><head><meta property="og:title" content="Hello"></head><body>Body</body></html>', {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			}),
		);

		const request = new IncomingRequest('https://worker.example/?url=https://example.com/article', {
			headers: {
				'User-Agent': 'teLEgramBOT 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<meta property="og:title" content="Hello">');
	});

	it('redirects non-bot requests to the target URL', async () => {
		const request = new IncomingRequest('https://worker.example/?url=https://example.com/article', {
			headers: {
				'User-Agent': 'Mozilla/5.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://example.com/article');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('shows usage when url is missing', async () => {
		const request = new IncomingRequest('https://worker.example/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('Usage: /?url=https://example.com');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('blocks domains outside env allowlist', async () => {
		const request = new IncomingRequest('https://worker.example/?url=https://blocked.example/article', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, ALLOWED_DOMAINS: 'example.com, allowed.test' }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Domain not in whitelist');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects non-http protocols', async () => {
		const request = new IncomingRequest('https://worker.example/?url=javascript:alert(1)', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Invalid Request');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('blocks localhost targets', async () => {
		const request = new IncomingRequest('https://worker.example/?url=http://localhost/admin', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Private network targets are not allowed');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('blocks private ipv4 targets', async () => {
		const request = new IncomingRequest('https://worker.example/?url=http://192.168.0.10/admin', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Private network targets are not allowed');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns 400 for non-root requests without url', async () => {
		const request = new IncomingRequest('https://worker.example/invalid');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Invalid Request');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns 500 when preview fetch throws', async () => {
		fetchSpy.mockRejectedValue(new Error('network down'));

		const request = new IncomingRequest('https://worker.example/?url=https://example.com/article', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Failed to fetch URL.');
	});

	it('rejects non-html preview responses', async () => {
		fetchSpy.mockResolvedValue(
			new Response('not html', {
				headers: { 'content-type': 'application/json' },
			}),
		);

		const request = new IncomingRequest('https://worker.example/?url=https://example.com/data.json', {
			headers: {
				'User-Agent': 'TelegramBot 1.0',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(415);
		expect(await response.text()).toBe('Preview requires an HTML document.');
	});
});
