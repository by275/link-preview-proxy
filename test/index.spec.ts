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
});
