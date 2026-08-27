export interface ShareLoadError {
	status: number;
	message: string;
}

export const SHARE_LOAD_TIMEOUT_MS = 5_000;

export function shareFetchInit(forwardedFor: string | undefined): RequestInit {
	return {
		headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
		signal: AbortSignal.timeout(SHARE_LOAD_TIMEOUT_MS),
	};
}

/**
 * Preserve the edge proxy chain and append the frontend's direct peer. The API
 * can then apply its own trusted-proxy policy from the right of the chain.
 */
export function buildApiForwardedFor(
	incoming: string | undefined,
	directPeer: string | undefined,
): string | undefined {
	const peer = directPeer?.trim();
	if (!peer) return undefined;
	const chain = incoming?.trim();
	return chain ? `${chain}, ${peer}` : peer;
}

export function shareLoadErrorForStatus(status: number): ShareLoadError {
	if (status === 404 || status === 410) {
		return { status: 404, message: "This share link is invalid or expired" };
	}
	if (status === 429) {
		return { status, message: "Too many requests. Try again shortly" };
	}
	return {
		status: status >= 500 ? 503 : status,
		message: "Infinitune could not load this share link right now",
	};
}
