import { BaseEndpointQueue, type EndpointType } from "./endpoint-queue";

/**
 * Concrete queue for standard request→response endpoints (LLM, Image).
 * All mechanics are in BaseEndpointQueue — this just provides a constructor.
 */
export class RequestResponseQueue<T> extends BaseEndpointQueue<T> {
	constructor(type: EndpointType, maxConcurrency: number) {
		super(type, maxConcurrency);
	}
}
