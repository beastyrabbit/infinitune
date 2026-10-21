import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const mocks = vi.hoisted(() => {
	const requestError = vi.fn();
	const requestInfo = vi.fn();
	const requestWarn = vi.fn();
	const requestDebug = vi.fn();
	return {
		upgrade: null as
			| ((
					request: { url?: string },
					socket: { destroy: () => void },
					head: Buffer,
			  ) => void)
			| null,
		wsUpgrade: vi.fn(),
		originalUpgrade: vi.fn(),
		fetch: null as
			| ((
					request: Request,
					env?: { incoming: { url: string } },
			  ) => Promise<Response>)
			| null,
		telemetryRequests: vi.fn(async (_c: unknown, next: () => Promise<void>) =>
			next(),
		),
		rootError: vi.fn(),
		child: vi.fn(() => ({
			error: requestError,
			info: requestInfo,
			warn: requestWarn,
			debug: requestDebug,
		})),
		requestError,
		requestInfo,
		requestWarn,
		requestDebug,
		shutdown: new Map<string, () => Promise<void>>(),
	};
});

vi.mock("@infinitune/shared/telemetry-node", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@infinitune/shared/telemetry-node")
	>()),
	flushTelemetry: vi.fn(),
}));

vi.mock("../telemetry/requests", () => ({
	telemetryRequests: mocks.telemetryRequests,
}));

vi.mock("../logger", () => ({
	logger: {
		child: mocks.child,
		debug: vi.fn(),
		error: mocks.rootError,
		fatal: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
	loggingConfig: {
		level: "silent",
		fileLoggingEnabled: false,
		logFilePath: undefined,
		logSessionId: "test",
	},
}));

vi.mock("@hono/node-server", () => ({
	serve: vi.fn(
		(options: { fetch: (request: Request) => Promise<Response> }) => {
			mocks.fetch = options.fetch;
			return {
				listeners: vi.fn(() => [mocks.originalUpgrade]),
				on: vi.fn((event: string, handler: typeof mocks.upgrade) => {
					if (event === "upgrade") mocks.upgrade = handler;
				}),
				removeAllListeners: vi.fn(),
			};
		},
	),
}));

vi.mock("@hono/node-ws", () => ({
	createNodeWebSocket: vi.fn(() => ({
		injectWebSocket: vi.fn(),
		upgradeWebSocket: vi.fn(() =>
			vi.fn(() => new Response(null, { status: 426 })),
		),
	})),
}));

vi.mock("ws", () => ({
	WebSocketServer: class {
		close = vi.fn();
		emit = vi.fn();
		handleUpgrade = mocks.wsUpgrade;
		on = vi.fn();
	},
}));

vi.mock("../db/index", () => ({ sqlite: { close: vi.fn() } }));
vi.mock("../db/migrate", () => ({ ensureSchema: vi.fn() }));
vi.mock("../events/ws-bridge", () => ({
	addClient: vi.fn(),
	getClientCount: vi.fn(() => 0),
	removeClient: vi.fn(),
	startWsBridge: vi.fn(),
}));
vi.mock("../radio/radio-ws-handler", () => ({
	handleRadioConnection: vi.fn(),
}));
vi.mock("../room/room-event-handler", () => ({
	startRoomEventSync: vi.fn(),
}));
vi.mock("../room/room-manager", () => ({
	RoomManager: class {
		listRooms = vi.fn(() => []);
	},
}));
vi.mock("../room/room-ws-handler", () => ({
	handleRoomConnection: vi.fn(),
}));
vi.mock("../services/playlist-service", () => ({
	deleteExpiredTemporaryPlaylists: vi.fn(async () => 0),
	listActive: vi.fn(async () => []),
}));
vi.mock("../services/radio-station-service", () => ({
	startRadioServiceEventSync: vi.fn(),
}));
vi.mock("../worker/index", () => ({
	getQueues: vi.fn(() => ({ getFullStatus: vi.fn(() => ({})) })),
	getWorkerActorGraph: vi.fn(() => ({})),
	getWorkerInspect: vi.fn(() => ({})),
	getWorkerStats: vi.fn(() => ({ songWorkerCount: 0, trackedPlaylists: [] })),
	startWorker: vi.fn(async () => undefined),
	stopWorkerDiagnostics: vi.fn(),
	triggerPersonaScan: vi.fn(),
}));

vi.mock("../routes/agent-memory", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/autoplayer", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/playlists", async () => {
	const { Hono } = await import("hono");
	return {
		default: new Hono().get("/:id", (c) =>
			c.json({ id: c.req.param("id"), query: c.req.query("q") }),
		),
	};
});
vi.mock("../routes/radio", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/settings", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/songs/index", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/control", async () => {
	const { Hono } = await import("hono");
	return { createControlRoutes: vi.fn(() => new Hono()) };
});
vi.mock("../routes/rooms", async () => {
	const { Hono } = await import("hono");
	return { createRoomRoutes: vi.fn(() => new Hono()) };
});
vi.mock("../routes/share", async () => {
	const { Hono } = await import("hono");
	const app = new Hono();
	app.get("/:token", (c) => {
		if (c.req.param("token") === "throwing-secret") {
			throw new Error("Expected request failure");
		}
		return c.json({ ok: true });
	});
	app.delete("/:id", (c) => c.json({ ok: true }));
	return { default: app };
});

async function request(
	path: string,
	init?: RequestInit,
	incomingUrl?: string,
): Promise<Response> {
	if (!mocks.fetch) throw new Error("Server fetch handler was not captured");
	return mocks.fetch(
		new Request(`http://localhost${path}`, init),
		incomingUrl === undefined ? undefined : { incoming: { url: incomingUrl } },
	);
}

describe("request logging", () => {
	beforeAll(async () => {
		vi.stubEnv("REQUEST_LOG_SUMMARY_INTERVAL_MS", "0");
		vi.stubEnv("TEMP_PLAYLIST_CLEANUP_INTERVAL_MS", "0");
		const processOn = vi.spyOn(process, "on").mockReturnValue(process);
		try {
			await import("../index");
			for (const signal of ["SIGINT", "SIGTERM"]) {
				const listener = processOn.mock.calls.find(
					([event]) => event === signal,
				)?.[1];
				if (listener)
					mocks.shutdown.set(signal, listener as () => Promise<void>);
			}
		} finally {
			processOn.mockRestore();
		}
	});

	beforeEach(() => {
		mocks.wsUpgrade.mockClear();
		mocks.originalUpgrade.mockClear();
		mocks.telemetryRequests.mockClear();
		mocks.rootError.mockClear();
		mocks.child.mockClear();
		mocks.requestError.mockClear();
		mocks.requestInfo.mockClear();
		mocks.requestWarn.mockClear();
		mocks.requestDebug.mockClear();
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		"/x/../ws/playlist",
		"/./ws/radio",
		"/ws/%2e%2e/ws/playlist",
		"/ws%2fplaylist",
		"/ws%5Cradio",
		"/ws%252Fplaylist",
		"/ws\\radio",
	])("destroys unsafe upgrade target %s before dispatch", (url) => {
		if (!mocks.upgrade) throw new Error("Upgrade handler was not captured");
		const socket = { destroy: vi.fn() };
		mocks.upgrade({ url }, socket, Buffer.alloc(0));
		expect(socket.destroy).toHaveBeenCalledOnce();
		expect(mocks.wsUpgrade).not.toHaveBeenCalled();
		expect(mocks.originalUpgrade).not.toHaveBeenCalled();
	});

	it.each(["/ws/playlist", "/ws/radio"])(
		"allows canonical upgrade %s and structural characters in queries",
		(path) => {
			if (!mocks.upgrade) throw new Error("Upgrade handler was not captured");
			const socket = { destroy: vi.fn() };
			const head = Buffer.alloc(0);
			for (const url of [path, `${path}?next=%2F%5C%25%2E/../`]) {
				const request = { url };
				mocks.upgrade(request, socket, head);
				expect(mocks.wsUpgrade).toHaveBeenLastCalledWith(
					request,
					socket,
					head,
					expect.any(Function),
				);
			}
			expect(mocks.wsUpgrade).toHaveBeenCalledTimes(2);
			expect(socket.destroy).not.toHaveBeenCalled();
			expect(mocks.originalUpgrade).not.toHaveBeenCalled();
		},
	);

	it("preserves upgrade fallback to Hono", () => {
		if (!mocks.upgrade) throw new Error("Upgrade handler was not captured");
		const request = { url: "/ws?next=%2F%25/../" };
		const socket = { destroy: vi.fn() };
		const head = Buffer.alloc(0);
		mocks.upgrade(request, socket, head);
		expect(mocks.originalUpgrade).toHaveBeenCalledExactlyOnceWith(
			request,
			socket,
			head,
		);
		expect(socket.destroy).not.toHaveBeenCalled();
		expect(mocks.wsUpgrade).not.toHaveBeenCalled();
	});

	it.each([
		"/api/playlists/X%252F..%252F..%252F..%252Fprivacy",
		"/api/playlists/X%2f..%2f..%2fprivacy",
		"/api/playlists/X%5C..%5Cprivacy",
		"/api/playlists/X%25252Fprivacy",
		"/covers/a%2Eb.png",
		"/ws%2fprivacy",
		"/health%25",
	])(
		"rejects %s with or without Node bindings before telemetry and logging",
		async (path) => {
			for (const incomingUrl of [undefined, path]) {
				const response = await request(path, undefined, incomingUrl);
				expect(response.status).toBe(400);
				expect(response.headers.get("content-type")).toBe(
					"text/plain; charset=UTF-8",
				);
				expect(await response.text()).toBe("Bad Request");
			}
			expect(mocks.telemetryRequests).not.toHaveBeenCalled();
			expect(mocks.child).not.toHaveBeenCalled();
		},
	);

	it.each([
		"/x/../health",
		"/a/%2e%2e/privacy",
		"/./health",
		"/health/.",
		"/x\\../health",
		"http://localhost/x/../health?next=%2F",
	])(
		"inspects the original Node target %s even after Request URL normalization",
		async (rawTarget) => {
			const response = await request("/health", undefined, rawTarget);
			expect(response.status).toBe(400);
			expect(mocks.telemetryRequests).not.toHaveBeenCalled();
			expect(mocks.child).not.toHaveBeenCalled();
		},
	);

	it("allows health, cuid API paths and structural characters in queries", async () => {
		const id = "tz4a98xxat96iws9zmbrgj3a";
		for (const path of ["/health", `/api/playlists/${id}`]) {
			const target = `${path}?q=%2F%5C%25%2E/../`;
			for (const incomingUrl of [undefined, target]) {
				const response = await request(target, undefined, incomingUrl);
				expect(response.status).toBe(200);
				if (path.startsWith("/api/")) {
					expect(await response.json()).toEqual({ id, query: "/\\%./../" });
				}
			}
		}
		expect(mocks.telemetryRequests).toHaveBeenCalledTimes(4);
		expect(mocks.child).toHaveBeenCalledTimes(4);
	});

	it("normalizes share tokens in completed and failed request logs", async () => {
		const completedToken = "completed-bearer-secret";
		expect((await request(`/api/share/${completedToken}`)).status).toBe(200);
		expect(mocks.requestInfo).toHaveBeenCalled();
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(
			completedToken,
		);

		mocks.child.mockClear();
		expect((await request("/api/share/throwing-secret")).status).toBe(500);
		expect(mocks.requestError).toHaveBeenCalled();
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
		);
		expect(mocks.rootError).toHaveBeenCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
			"Unhandled request error",
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(
			"throwing-secret",
		);
		expect(JSON.stringify(mocks.rootError.mock.calls)).not.toContain(
			"throwing-secret",
		);
	});

	it("normalizes share-link IDs in deletion logs", async () => {
		const linkId = "private-link-id";
		expect(
			(
				await request(`/api/share/${linkId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(200);
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "DELETE", path: "/api/share/:id" }),
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(linkId);
	});

	it.each(["SIGINT", "SIGTERM"])(
		"awaits telemetry after cleanup errors and before exiting on %s",
		async (signal) => {
			const { flushTelemetry } = await import(
				"@infinitune/shared/telemetry-node"
			);
			const { sqlite } = await import("../db/index");
			const cleanupError = new Error("SQLite cleanup failure");
			vi.mocked(sqlite.close).mockImplementationOnce(() => {
				throw cleanupError;
			});
			let finishFlush = () => {};
			vi.mocked(flushTelemetry).mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishFlush = resolve;
					}),
			);
			const exit = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			try {
				const shutdown = mocks.shutdown.get(signal);
				expect(shutdown).toBeDefined();
				const stopped = shutdown?.();
				expect(mocks.rootError).toHaveBeenCalledWith(
					{ err: cleanupError },
					"Error closing SQLite",
				);
				expect(flushTelemetry).toHaveBeenCalledOnce();
				expect(
					vi.mocked(sqlite.close).mock.invocationCallOrder.at(-1),
				).toBeLessThan(vi.mocked(flushTelemetry).mock.invocationCallOrder[0]);
				expect(exit).not.toHaveBeenCalled();
				finishFlush();
				await stopped;
				expect(exit).toHaveBeenCalledExactlyOnceWith(0);
			} finally {
				finishFlush();
				exit.mockRestore();
				vi.mocked(flushTelemetry).mockClear();
			}
		},
	);
});
