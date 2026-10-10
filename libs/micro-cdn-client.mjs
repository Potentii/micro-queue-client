import Joi from "joi";
import * as uuid from "uuid";

/**
 * MicroCdnClient
 */
export default class MicroCdnClient {

	/**
	 * @type {string}
	 */
	#baseUrl;





	/**
	 * @param {MicroCdnClientOptions} opts Options for configuring this client.
	 */
	constructor(opts) {
		Joi.assert(opts, Joi.object({
			url: Joi.string().uri().required(),
		}).required());

		this.#baseUrl = opts.url;
	}




	// --------------------- PUBLIC API ---------------------



	/**
	 *
	 * @param {string} accessToken User access token
	 * @param {string} fileId The file ID
	 * @return {Promise<MicroCdnUploadFileRes>}
	 */
	async getFileMetadata(accessToken, fileId) {

		const response = await fetch(`${this.#baseUrl}/cdn/files/metadata/${fileId}`, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'X-Corr-Id': uuid.v4(),
			},
		});

		if (!response.ok) {
			throw new Error(`MicroCdnClient: Unexpected error getting file metadata, status: "${response.status}"`);
		}

		return await response.json();
	}


	/**
	 *
	 * @param {string} accessToken User access token
	 * @param {ReadableStream | import('node:fs').ReadStream | import('node:stream').Readable | File | Blob} contentStream The readable stream of the file
	 * @param {string} contentType The file mimetype
	 * @return {Promise<MicroCdnUploadFileRes>}
	 */
	async uploadFile(accessToken, contentStream, contentType) {
		let readableStream;

		// *Normalizing the input into a Web ReadableStream:
		if (typeof window !== 'undefined' && contentStream instanceof File) {
			// *Browser: Converting File object to ReadableStream:
			readableStream = contentStream.stream();
		} else if (contentStream?.prototype?.pipeThrough || contentStream instanceof ReadableStream) {
			// *Already a Web ReadableStream:
			readableStream = contentStream;
		} else if (contentStream && typeof contentStream.pipe === 'function') {
			// *Node.js legacy stream: Converting it to a Web ReadableStream:
			readableStream = ReadableStream.from(contentStream);
		} else {
			throw new Error('Unsupported file/stream format');
		}

		// *Uploading:
		const response = await fetch(`${this.#baseUrl}/cdn/files`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'X-Corr-Id': uuid.v4(),
				'Content-Type': contentType || 'application/octet-stream',
			},
			body: readableStream,
			// duplex: 'half' is required by the spec when sending a stream body via fetch
			duplex: 'half',
		});

		if (!response.ok) {
			throw new Error(`MicroCdnClient: Unexpected error uploading file, status: "${response.status}"`);
		}

		return await response.json();
	}



}
