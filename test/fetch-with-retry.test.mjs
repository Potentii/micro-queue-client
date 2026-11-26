import { test } from 'node:test';
import assert from 'node:assert/strict';
import fetchWithRetry from '../libs/utils/fetch-with-retry.mjs';
import MicroQueueClient from '../libs/micro-queue-client.mjs';

test('retries network failures and transient HTTP responses', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch');
	fetch.mock.mockImplementationOnce(async () => { throw new TypeError('network failure'); }, 0);
	fetch.mock.mockImplementationOnce(async () => new Response('unavailable', { status: 503 }), 1);
	fetch.mock.mockImplementationOnce(async () => new Response('ok'), 2);
	const options = { method: 'POST', body: 'message' };
	const response = await fetchWithRetry('https://example.com', options, { delay: 0, maxAttempts: 2 });
	assert.equal(await response.text(), 'ok');
	assert.equal(fetch.mock.callCount(), 3);
	assert.deepEqual(fetch.mock.calls.map((call) => call.arguments), Array(3).fill(['https://example.com', options]));
});

test('returns non-retryable and exhausted HTTP responses unchanged', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('bad request', { status: 400 }));
	let response = await fetchWithRetry('https://example.com', {}, { delay: 0, maxAttempts: 2 });
	assert.equal(response.status, 400);
	assert.equal(fetch.mock.callCount(), 1);
	fetch.mock.mockImplementation(async () => new Response('busy', { status: 429 }));
	response = await fetchWithRetry('https://example.com', {}, { delay: 0, maxAttempts: 2 });
	assert.equal(response.status, 429);
	assert.equal(await response.text(), 'busy');
	assert.equal(fetch.mock.callCount(), 4);
});

test('throws the final network error after retries', async (t) => {
	const error = new TypeError('network failure');
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw error; });
	await assert.rejects(fetchWithRetry('https://example.com', {}, { delay: 0, maxAttempts: 2 }), (err) => err === error);
	assert.equal(fetch.mock.callCount(), 3);
});

test('does not retry aborted requests', async (t) => {
	const controller = new AbortController();
	controller.abort();
	const error = controller.signal.reason;
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw error; });
	await assert.rejects(fetchWithRetry('https://example.com', { signal: controller.signal }, { delay: 0, maxAttempts: 2 }), (err) => err === error);
	assert.equal(fetch.mock.callCount(), 1);
});

test('client preserves operation-specific errors after retries', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
	const client = new MicroQueueClient({ url: 'https://example.com' });
	await assert.rejects(client.postMessage('queue', 'payload'), /Post message failed: 503, unavailable/);
	assert.equal(fetch.mock.callCount(), 3);
});