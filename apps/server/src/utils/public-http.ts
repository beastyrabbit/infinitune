import { lookup } from "node:dns/promises";
import type {
	IncomingHttpHeaders,
	IncomingMessage,
	RequestOptions,
} from "node:http";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface PublicResolvedAddress {
	address: string;
	family: 4 | 6;
}

export interface PublicHttpResponse {
	status: number;
	ok: boolean;
	headers: {
		get(name: string): string | null;
	};
}

export interface PublicHttpBufferResult {
	response: PublicHttpResponse;
	buffer: Buffer;
	resolvedAddress: PublicResolvedAddress;
}

interface PublicHttpRequestOptions {
	signal?: AbortSignal;
	headers?: Record<string, string>;
	maxBytes: number;
	blockedAddressMessage: string;
	sizeErrorMessage: string;
	abortMessage: string;
	timeoutMs?: number;
	timeoutMessage?: string;
}

type PublicHttpRequestOverride = (
	url: URL,
	options: PublicHttpRequestOptions & {
		resolvedAddress: PublicResolvedAddress;
	},
) => Promise<Omit<PublicHttpBufferResult, "resolvedAddress">>;

let requestOverrideForTests: PublicHttpRequestOverride | null = null;

export function setPublicHttpRequestOverrideForTests(
	override: PublicHttpRequestOverride | null,
): void {
	requestOverrideForTests = override;
}

export function isPrivateIp(address: string): boolean {
	const normalizedAddress = address.toLowerCase();
	const mappedIpv4 =
		normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] ??
		normalizedAddress.match(/^0:0:0:0:0:ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (mappedIpv4) return isPrivateIp(mappedIpv4);

	if (net.isIPv4(address)) {
		const parts = address.split(".").map((part) => Number.parseInt(part, 10));
		const [a, b] = parts;
		return (
			a === 10 ||
			a === 127 ||
			a === 0 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}

	return (
		normalizedAddress === "::1" ||
		normalizedAddress === "::" ||
		normalizedAddress.startsWith("fc") ||
		normalizedAddress.startsWith("fd") ||
		normalizedAddress.startsWith("fe80:")
	);
}

async function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	abortMessage: string,
): Promise<T> {
	if (signal?.aborted) throw signal.reason ?? new Error(abortMessage);
	if (!signal) return await promise;

	let abort: (() => void) | undefined;
	const abortPromise = new Promise<never>((_, reject) => {
		abort = () => reject(signal.reason ?? new Error(abortMessage));
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([promise, abortPromise]);
	} finally {
		if (abort) signal.removeEventListener("abort", abort);
	}
}

async function resolvePublicHost(
	hostname: string,
	signal: AbortSignal | undefined,
	blockedAddressMessage: string,
	abortMessage: string,
): Promise<PublicResolvedAddress> {
	const addresses = await abortable(
		lookup(hostname, { all: true }),
		signal,
		abortMessage,
	);
	if (addresses.length === 0) {
		throw new Error("Host did not resolve to an address.");
	}
	if (addresses.some((address) => isPrivateIp(address.address))) {
		throw new Error(blockedAddressMessage);
	}
	const first = addresses[0];
	return {
		address: first.address,
		family: first.family === 6 ? 6 : 4,
	};
}

function headerGetter(
	headers: IncomingHttpHeaders,
): PublicHttpResponse["headers"] {
	return {
		get(name: string): string | null {
			const value = headers[name.toLowerCase()];
			if (Array.isArray(value)) return value.join(", ");
			return value ?? null;
		},
	};
}

function readIncomingMessageWithLimit(
	message: IncomingMessage,
	maxBytes: number,
	sizeErrorMessage: string,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		let settled = false;
		const rejectOnce = (error: Error) => {
			if (settled) return;
			settled = true;
			reject(error);
		};
		message.on("data", (chunk: Buffer | Uint8Array | string) => {
			if (settled) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			totalBytes += buffer.byteLength;
			if (totalBytes > maxBytes) {
				const error = new Error(sizeErrorMessage);
				message.destroy(error);
				rejectOnce(error);
				return;
			}
			chunks.push(buffer);
		});
		message.on("end", () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks));
		});
		message.on("error", (error) => {
			rejectOnce(error instanceof Error ? error : new Error(String(error)));
		});
	});
}

function requestBufferPinned(
	url: URL,
	options: PublicHttpRequestOptions & {
		resolvedAddress: PublicResolvedAddress;
	},
): Promise<Omit<PublicHttpBufferResult, "resolvedAddress">> {
	return new Promise((resolve, reject) => {
		const client = url.protocol === "https:" ? https : http;
		let settled = false;
		const rejectOnce = (error: Error) => {
			if (settled) return;
			settled = true;
			reject(error);
		};
		const pinnedLookup = ((
			_hostname: string,
			_options: unknown,
			callback: (
				err: NodeJS.ErrnoException | null,
				address: string,
				family: number,
			) => void,
		) => {
			callback(
				null,
				options.resolvedAddress.address,
				options.resolvedAddress.family,
			);
		}) as RequestOptions["lookup"];
		const req = client.request(
			url,
			{
				method: "GET",
				headers: options.headers,
				lookup: pinnedLookup,
				signal: options.signal,
			},
			async (res) => {
				try {
					const buffer = await readIncomingMessageWithLimit(
						res,
						options.maxBytes,
						options.sizeErrorMessage,
					);
					if (settled) return;
					settled = true;
					const status = res.statusCode ?? 0;
					resolve({
						response: {
							status,
							ok: status >= 200 && status < 300,
							headers: headerGetter(res.headers),
						},
						buffer,
					});
				} catch (error) {
					rejectOnce(error instanceof Error ? error : new Error(String(error)));
				}
			},
		);
		req.on("error", (error) => {
			rejectOnce(error instanceof Error ? error : new Error(String(error)));
		});
		req.end();
	});
}

export async function publicHttpRequestBuffer(
	url: URL,
	options: PublicHttpRequestOptions,
): Promise<PublicHttpBufferResult> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only public http/https URLs are allowed.");
	}

	const controller =
		options.timeoutMs && options.timeoutMs > 0 ? new AbortController() : null;
	const timeout = controller
		? setTimeout(
				() =>
					controller.abort(
						new Error(options.timeoutMessage ?? options.abortMessage),
					),
				options.timeoutMs,
			)
		: null;
	const externalAbort = () =>
		controller?.abort(
			options.signal?.reason ?? new Error(options.abortMessage),
		);
	if (controller && options.signal) {
		if (options.signal.aborted) externalAbort();
		else
			options.signal.addEventListener("abort", externalAbort, { once: true });
	}
	const signal = controller?.signal ?? options.signal;

	try {
		const resolvedAddress = await resolvePublicHost(
			url.hostname,
			signal,
			options.blockedAddressMessage,
			options.abortMessage,
		);
		const requestOptions = { ...options, signal, resolvedAddress };
		const result = requestOverrideForTests
			? await requestOverrideForTests(url, requestOptions)
			: await requestBufferPinned(url, requestOptions);
		return { ...result, resolvedAddress };
	} finally {
		if (timeout) clearTimeout(timeout);
		if (controller && options.signal) {
			options.signal.removeEventListener("abort", externalAbort);
		}
	}
}
