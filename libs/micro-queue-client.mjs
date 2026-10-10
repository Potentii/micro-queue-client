import Joi from "joi";
import {RequestEnvelope} from "@potentii/rest-envelopes";
import * as uuid from "uuid";

/**
 * @typedef {Object} MicroQueueClientOptions
 * @property {string} url Base URL of the micro-queue service (no trailing slash).
 * @property {?number} [pollingTimeout=20000] Long-poll timeout in milliseconds per request.
 * @property {?number} [maxItemsPerPolling=10] Max number of messages to request per poll.
 * @property {?boolean} [autoAck=true] If a listener resolves without calling `ack`, auto-ack the message.
 */


/**
 * MicroQueueClient
 */
export default class MicroQueueClient {

	/**
	 * @type {string}
	 */
	#baseUrl;
	/**
	 * @type {number}
	 */
	#pollingTimeout;
	/**
	 * @type {number}
	 */
	#maxItemsPerPolling;
	/**
	 * @type {boolean}
	 */
	#autoAck;
	/**
	 * @type {boolean}
	 */
	#stopped;


	/**
	 * @typedef {(payload: string, headers: Record<string,string>, ack: () => Promise<void>) => (Promise<void>|void)} MessageConsumer
	 */
	/**
	 *
	 * @type {Map<string, MessageConsumer>}
	 */
	#listenersByQueueId = new Map();

	/**
	 *
	 * @type {Map<string, number>}
	 */
	#concurrencyByQueueId = new Map();

	/**
	 *
	 * @type {Map<string, Set<string>>}
	 */
	#processingMessageIdByQueueId = new Map();


	/**
	 * @typedef {(queueId: string, payload: string, headers: Record<string,string>, error: Error) => (Promise<void>|void)} MessageErrorHandler
	 */
	/**
	 * @type {?MessageErrorHandler}
	 */
	#errorHandler;



	/**
	 * @param {MicroQueueClientOptions} opts Options for configuring this client.
	 */
	constructor(opts) {
		Joi.assert(opts, Joi.object({
			url: Joi.string().uri().required(),
			pollingTimeout: Joi.number().integer().min(100).optional().allow(null),
			maxItemsPerPolling: Joi.number().integer().min(1).optional().allow(null),
			autoAck: Joi.boolean().optional().allow(null),
		}).required());

		this.#baseUrl = opts.url;
		this.#pollingTimeout = opts.pollingTimeout ?? 5000;
		this.#maxItemsPerPolling = opts.maxItemsPerPolling ?? 10;
		this.#autoAck = opts.autoAck !== false;

		this.#stopped = false;
	}



	// --------------------- PUBLIC API ---------------------



	/**
	 * @typedef {'PAYLOAD_HASH'|'MANUAL'|'AUTO'|'NONE'} EQueueDeduplicationMode
	 */
	/**
	 * @typedef {{
	 * 	id: string,
	 * 	visibilityTimeout: number,
	 * 	retentionTime: ?number,
	 * 	maxReceiveCount: ?number,
	 * 	redriveQueueId: ?string,
	 * 	deduplicationMode: EQueueDeduplicationMode
	 * }} QueueUpsertConfig
	 */
	/**
	 * @typedef {QueueUpsertConfig} QueueUpsertResult
	 */



	/**
	 * Upsert (create or update) a queue by id.
	 * @param {QueueUpsertConfig} queueConfig Queue configuration.
	 * @returns {Promise<QueueUpsertResult>}.
	 */
	async upsertQueue(queueConfig) {
		const res = await fetch(`${this.#baseUrl}/api/v1/queues`, {
			method: 'PUT',
			headers: {
				...this.#headers,
			},
			body: JSON.stringify(RequestEnvelope.builder().data(queueConfig).build()),
		});

		if (!res.ok)
			throw new Error(`Upsert queue failed: ${res.status}, ${await res.text()}`);

		return (await res.json())?.data;
	}



	/**
	 * Post a message to a queue.
	 * @param {string} queueId Queue identifier.
	 * @param {string} payload Message payload.
	 * @param {Record<string,string>} [headers] Optional headers.
	 * @returns {Promise<{ id: string }>}
	 */
	async postMessage(queueId, payload, headers) {
		const res = await fetch(`${this.#baseUrl}/api/v1/queues/${queueId}/messages`, {
			method: 'POST',
			headers: {
				...this.#headers,
			},
			body: JSON.stringify(RequestEnvelope.builder().data({ payload: payload, headers: headers }).build()),
		});

		if (!res.ok)
			throw new Error(`Post message failed: ${res.status}, ${await res.text()}`);

		return (await res.json()).data;
	}



	/**
	 * Registers a listener for messages on a queue and start polling.
	 *
	 * Listener contract:
	 * - If the listener calls `ack()`, the message will be acked immediately.
	 * - If the listener returns/resolves without calling `ack`, the client will auto-ack if `autoAck` is true.
	 * - If the listener throws/rejects, the client does NOT ack; it only logs the error.
	 *
	 * @param {string} queueId Queue identifier.
	 * @param {MessageConsumer} listener Listener function.
	 * @returns {() => void} An unsubscribe function to remove this listener. Polling stops when no listeners remain for the queue.
	 */
	onMessage(queueId, listener) {
		Joi.assert(queueId, Joi.string().required().label('onMessage.queueId'));
		Joi.assert(listener, Joi.func().required().label('onMessage.listener'));


		if(this.#listenersByQueueId.has(queueId))
			throw new Error(`Listener for queue '${queueId}' already registered`);

		this.#listenersByQueueId.set(queueId, listener);

		this.#runPollingLoop(queueId); // Ignoring promise

		return () => this.offMessage(queueId);
	}



	/**
	 * Registers a message error handler.
	 *
	 * @param {MessageConsumer} handler The handler function.
	 * @returns {void}
	 */
	onError(handler) {
		Joi.assert(handler, Joi.func().required().label('onError.handler'));
		this.#errorHandler = handler;
	}



	/**
	 * Remove a previously registered listener for a queue.
	 * @param {string} queueId
	 */
	offMessage(queueId) {
		this.#listenersByQueueId.delete(queueId);
	}



	/**
	 * Stop all polling loops.
	 */
	stop() {
		if(this.#stopped)
			return;
		this.#stopped = true;
		this.#listenersByQueueId.clear();
	}



	/**
	 * Allow polling loops to run again. Existing queues with listeners will resume automatically.
	 */
	start() {
		if(!this.#stopped)
			return;
		this.#stopped = false;
		for (const [queueId] of this.#listenersByQueueId) {
			this.#runPollingLoop(queueId); // Ignoring promise
		}
	}



	// --------------------- INTERNALS ---------------------



	/**
	 *
	 * @return {Record<string,string>}
	 */
	get #headers(){
		return {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'X-Corr-Id': uuid.v4(),
		};
	}



	/**
	 * @param {string} queueId
	 * @returns {Promise<void>}
	 */
	async #runPollingLoop(queueId) {
		while (!this.#stopped && this.#listenersByQueueId.has(queueId)) {

			try {
				const quantity = Math.max(this.#maxItemsPerPolling - (this.#processingMessageIdByQueueId.get(queueId)?.size || 0), 0);

				if(quantity > 0){
					const messages = await this.#poll(queueId, quantity);
					if (messages?.length) {
						for (const message of messages) {
							if(!this.#processingMessageIdByQueueId.has(queueId))
								this.#processingMessageIdByQueueId.set(queueId, new Set());
							this.#processingMessageIdByQueueId.get(queueId).add(message.id);

							try{
								await this.#dispatchMessage(queueId, message);
							} catch (err){
								this.#dispatchError(queueId, message, err);
							}
						}
					}
				}
			} catch (err) {
				console.error(`Error polling queue "${queueId}"`, err);
			}

			await delay(this.#pollingTimeout);
		}
	}



	/**
	 * @typedef {{ id: string, payload: string, headers: ?Record<string, string> }} Message
	 */

	/**
	 * @param {string} queueId
	 * @param {number} quantity
	 * @returns {Promise<Message[]>}
	 */
	async #poll(queueId, quantity) {
		const res = await fetch(`${this.#baseUrl}/api/v1/queues/${queueId}/messages?${new URLSearchParams({ quantity: quantity })}`, {
			method: 'GET',
			headers: {
				...this.#headers,
			},
		});

		if (!res.ok)
			throw new Error(`Poll messages failed: ${res.status}, ${await res.text()}`);

		return (await res.json())?.data || [];
	}



	/**
	 * Acknowledge a message.
	 * @param {string} queueId Queue identifier.
	 * @param {string} messageId Message identifier.
	 * @returns {Promise<void>} Resolves when ack succeeds.
	 */
	async #ackMessage(queueId, messageId) {
		const res = await fetch(`${this.#baseUrl}/api/v1/queues/${queueId}/messages/${messageId}`, {
			method: 'DELETE',
			headers: {
				...this.#headers,
			},
		});

		if (!res.ok)
			throw new Error(`Ack message failed: ${res.status}, ${await res.text()}`);
	}



	/**
	 * Deliver a message to each listener sequentially (per message). If a listener
	 * resolves and does not call ack, auto-ack (configurable). If a listener fails,
	 * do not ack and log the error, then continue with next listener.
	 *
	 * @param {string} queueId
	 * @param {Message} message
	 */
	async #dispatchMessage(queueId, message) {
		const listener = this.#listenersByQueueId.get(queueId);

		let acked = false;
		const ack = async () => {
			if (acked) return;
			acked = true;
			this.#processingMessageIdByQueueId.get(queueId)?.delete(message.id);
			await this.#ackMessage(queueId, message.id);
		};

		const callListener = async () => {
			try{

				await listener(message.payload, message.headers, ack);

				if (!acked && this.#autoAck) {
					try {
						await ack();
					} catch (err) {
						console.error(`Auto-ack failed for message ${message.id}:`, err);
					}
				}

			} catch (err){
				this.#dispatchError(queueId, message, err);
			}

		};


		callListener();

	}



	/**
	 * Dispatch error to handler, if any.
	 *
	 * @param {string} queueId
	 * @param {Message} message
	 * @param {Error} error
	 */
	async #dispatchError(queueId, message, error) {
		try{
			if(typeof this.#errorHandler !== 'function')
				return;

			await this.#errorHandler(queueId, message.payload, message.headers, error);

		} catch (err){
			console.error(`Error handling message error ${message.id}:`, err);
		} finally {
			this.#processingMessageIdByQueueId.get(queueId)?.delete(message.id);
		}
	}





}


/**
 * @param {number} ms
 */
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
