import {
	type EventProps,
	sanitizeProps,
	type TelemetryConfig,
	telemetryConfig,
} from "@infinitune/shared/telemetry";

type Transport = typeof fetch;

/** At most four requests, no retries or unbounded backlog. Caller never awaits I/O. */
export function createUmamiSender(
	config: TelemetryConfig,
	transport: Transport = fetch,
	timeoutMs = 1500,
) {
	let inFlight = 0;
	return (name: string, props: EventProps = {}): void => {
		if (
			!config.enabled ||
			!config.umamiUrl ||
			!config.umamiWebsiteId ||
			!config.umamiDomains[0] ||
			inFlight >= 4 ||
			!/^[a-z][a-z0-9_]{0,63}$/.test(name)
		)
			return;
		inFlight++;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new Error("Telemetry timeout"));
			}, timeoutMs);
			timer.unref?.();
		});
		void Promise.race([
			Promise.resolve()
				.then(() =>
					transport(`${config.umamiUrl}/api/send`, {
						method: "POST",
						signal: controller.signal,
						redirect: "error",
						headers: {
							"Content-Type": "application/json",
							"User-Agent": "Infinitune/1.0 (generation pipeline)",
							"x-umami-website-id": config.umamiWebsiteId,
							"x-umami-hostname": config.umamiDomains[0],
						},
						body: JSON.stringify({
							type: "event",
							payload: {
								website: config.umamiWebsiteId,
								hostname: config.umamiDomains[0],
								url: "/generation",
								name,
								data: sanitizeProps({ source: "server", ...props }),
							},
						}),
					}),
				)
				.then(async (response) => {
					await response.body?.cancel();
				}),
			deadline,
		])
			.catch(() => {})
			.finally(() => {
				clearTimeout(timer);
				inFlight--;
			});
	};
}

export const trackServerEvent = createUmamiSender(telemetryConfig(process.env));
