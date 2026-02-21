import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { getRuntimePaths } from "./paths";

export type DaemonAction =
	| "status"
	| "shutdown"
	| "configure"
	| "joinRoom"
	| "startLocal"
	| "play"
	| "pause"
	| "toggle"
	| "skip"
	| "setVolume"
	| "volumeDelta"
	| "toggleMute"
	| "selectSong"
	| "seek"
	| "queue";

export type IpcRequest = {
	id: string;
	action: DaemonAction;
	payload?: Record<string, unknown>;
};

export type IpcResponse = {
	id: string;
	ok: boolean;
	data?: unknown;
	error?: string;
};

export type IpcHandler = (
	action: DaemonAction,
	payload: Record<string, unknown> | undefined,
) => Promise<unknown> | unknown;

export function createIpcServer(handler: IpcHandler): net.Server {
	const server = net.createServer((socket) => {
		let buffer = "";
		socket.setEncoding("utf8");

		socket.on("data", async (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) {
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				let request: IpcRequest;
				try {
					request = JSON.parse(line) as IpcRequest;
				} catch {
					socket.end(
						`${JSON.stringify({
							id: "unknown",
							ok: false,
							error: "Invalid JSON request",
						})}\n`,
					);
					break;
				}

				try {
					const data = await handler(request.action, request.payload);
					const response: IpcResponse = { id: request.id, ok: true, data };
					socket.end(`${JSON.stringify(response)}\n`);
				} catch (error) {
					const response: IpcResponse = {
						id: request.id,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
					socket.end(`${JSON.stringify(response)}\n`);
				}
				break;
			}
		});
	});

	return server;
}

export async function sendDaemonRequest(
	action: DaemonAction,
	payload?: Record<string, unknown>,
	timeoutMs = 4000,
): Promise<IpcResponse> {
	const { socketPath } = getRuntimePaths();

	return new Promise<IpcResponse>((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		let resolved = false;
		let buffer = "";

		const timer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			socket.destroy();
			reject(
				new Error(`Timed out waiting for daemon response (${timeoutMs}ms)`),
			);
		}, timeoutMs);

		socket.setEncoding("utf8");

		socket.on("connect", () => {
			const request: IpcRequest = {
				id: randomUUID(),
				action,
				payload,
			};
			socket.write(`${JSON.stringify(request)}\n`);
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) {
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				if (resolved) break;
				resolved = true;
				clearTimeout(timer);

				try {
					const response = JSON.parse(line) as IpcResponse;
					resolve(response);
				} catch (error) {
					reject(error);
				} finally {
					socket.end();
				}
				break;
			}
		});

		socket.on("error", (error) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			reject(error);
		});

		socket.on("close", () => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			reject(new Error("Daemon connection closed before responding"));
		});
	});
}

export async function isDaemonResponsive(): Promise<boolean> {
	try {
		const response = await sendDaemonRequest("status");
		return response.ok;
	} catch {
		return false;
	}
}

export function cleanupStaleRuntimeFiles(): void {
	const { socketPath, pidPath } = getRuntimePaths();
	if (fs.existsSync(socketPath)) {
		try {
			fs.unlinkSync(socketPath);
		} catch {
			// Best effort.
		}
	}
	if (fs.existsSync(pidPath)) {
		try {
			fs.unlinkSync(pidPath);
		} catch {
			// Best effort.
		}
	}
}
