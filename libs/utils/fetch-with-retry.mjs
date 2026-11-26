import { setTimeout as delay } from 'node:timers/promises';

/**
 * Retry transient failures, returning the final response for the caller to handle.
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ delay?: number, maxAttempts?: number }} retryOptions
 * @returns {Promise<Response>}
 */
export default async function fetchWithRetry(url, options = {}, retryOptions = {}) {
	const retryDelay = retryOptions.delay ?? 200;
	const maxAttempts = retryOptions.maxAttempts;
	for (let attempt = 0; ; attempt++) {
		let response;
		try {
			response = await fetch(url, options);
		} catch (error) {
			if ((maxAttempts && attempt >= maxAttempts) || options.signal?.aborted || error?.name === 'AbortError' || !(error instanceof TypeError))
				throw error;
		}

		if (response) {
			if ((maxAttempts && attempt >= maxAttempts) || (response.status !== 429 && (response.status < 500 || response.status > 599)))
				return response;
			await response.body?.cancel();
		}

		await delay(retryDelay * 2 ** attempt, undefined, { signal: options.signal ?? undefined });
	}
}