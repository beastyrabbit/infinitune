import {
	type ChildProcessWithoutNullStreams,
	execFile,
	spawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export type CodexLoginMode = "chatgpt" | "api" | "none" | "unknown";

export interface CodexLoginStatus {
	mode: CodexLoginMode;
	rawOutput: string;
}

export type CodexDeviceAuthState =
	| "idle"
	| "pending"
	| "awaiting_confirmation"
	| "authenticated"
	| "cancelled"
	| "error";

export interface CodexDeviceAuthSession {
	id: string;
	state: CodexDeviceAuthState;
	startedAt: number;
	updatedAt: number;
	verificationUrl?: string;
	userCode?: string;
	message?: string;
	error?: string;
}

let currentSession: CodexDeviceAuthSession | null = null;
let activeProcess: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = "";
let stderrBuffer = "";

const AUTH_URL_REGEX = /(https?:\/\/\S+)/i;
const DEVICE_CODE_REGEX = /\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/;

function stripAnsi(text: string): string {
	return text.replaceAll("\u001b", "").replace(/\[[0-9;]*m/g, "");
}

function setSessionPatch(
	patch: Partial<Omit<CodexDeviceAuthSession, "id" | "startedAt">>,
): void {
	if (!currentSession) return;
	currentSession = {
		...currentSession,
		...patch,
		updatedAt: Date.now(),
	};
}

function handleDeviceAuthLine(rawLine: string): void {
	if (!currentSession) return;

	const line = stripAnsi(rawLine).trim();
	if (!line) return;

	const urlMatch = line.match(AUTH_URL_REGEX);
	if (urlMatch?.[1]) {
		setSessionPatch({ verificationUrl: urlMatch[1] });
	}

	const codeMatch = line.match(DEVICE_CODE_REGEX);
	if (codeMatch?.[1]) {
		setSessionPatch({ userCode: codeMatch[1] });
	}

	if (line.toLowerCase().includes("follow these steps")) {
		setSessionPatch({ message: "Open the link and enter the one-time code." });
	}

	if (line.toLowerCase().includes("logged in using chatgpt")) {
		setSessionPatch({
			state: "authenticated",
			message: "Authenticated with ChatGPT subscription.",
			error: undefined,
		});
		return;
	}

	if (
		currentSession.state === "pending" &&
		currentSession.verificationUrl &&
		currentSession.userCode
	) {
		setSessionPatch({
			state: "awaiting_confirmation",
			message: "Waiting for browser confirmation.",
		});
	}
}

function consumeOutputChunk(chunk: string, isStdErr = false): void {
	const next = (isStdErr ? stderrBuffer : stdoutBuffer) + chunk;
	const lines = next.split("\n");
	const trailing = lines.pop() ?? "";

	if (isStdErr) {
		stderrBuffer = trailing;
	} else {
		stdoutBuffer = trailing;
	}

	for (const line of lines) {
		handleDeviceAuthLine(line);
	}
}

function stopActiveProcess(): void {
	if (activeProcess && !activeProcess.killed) {
		activeProcess.kill("SIGTERM");
	}
	activeProcess = null;
	stdoutBuffer = "";
	stderrBuffer = "";
}

export async function getCodexLoginStatus(): Promise<CodexLoginStatus> {
	try {
		const { stdout, stderr } = await execFileAsync(
			"codex",
			["login", "status"],
			{
				timeout: 5_000,
				maxBuffer: 64 * 1024,
			},
		);
		const rawOutput = `${stdout ?? ""}${stderr ?? ""}`.trim();
		const lower = rawOutput.toLowerCase();
		if (lower.includes("logged in using chatgpt")) {
			return { mode: "chatgpt", rawOutput };
		}
		if (lower.includes("api key")) {
			return { mode: "api", rawOutput };
		}
		if (lower.includes("not logged in")) {
			return { mode: "none", rawOutput };
		}
		return { mode: "unknown", rawOutput };
	} catch (error: unknown) {
		const message =
			error instanceof Error
				? error.message
				: "Unable to read codex login status";
		return { mode: "none", rawOutput: message };
	}
}

export async function startCodexDeviceAuth(): Promise<CodexDeviceAuthSession> {
	const existing = currentSession;
	if (
		existing &&
		(existing.state === "pending" || existing.state === "awaiting_confirmation")
	) {
		return existing;
	}

	const loginStatus = await getCodexLoginStatus();
	if (loginStatus.mode === "chatgpt") {
		currentSession = {
			id: randomUUID(),
			state: "authenticated",
			startedAt: Date.now(),
			updatedAt: Date.now(),
			message: "Already authenticated with ChatGPT subscription.",
		};
		return currentSession;
	}

	stopActiveProcess();

	currentSession = {
		id: randomUUID(),
		state: "pending",
		startedAt: Date.now(),
		updatedAt: Date.now(),
		message: "Starting device authentication flow...",
	};

	const proc = spawn("codex", ["login", "--device-auth"], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	activeProcess = proc;

	proc.stdout.on("data", (chunk: Buffer | string) => {
		consumeOutputChunk(chunk.toString("utf8"), false);
	});

	proc.stderr.on("data", (chunk: Buffer | string) => {
		consumeOutputChunk(chunk.toString("utf8"), true);
	});

	proc.on("error", (error) => {
		logger.warn({ err: error }, "Failed to start codex device auth");
		setSessionPatch({
			state: "error",
			error: `Failed to start codex login: ${error.message}`,
		});
		stopActiveProcess();
	});

	proc.on("close", (code) => {
		const session = currentSession;
		const currentState = session?.state ?? "idle";
		const stderrText = stripAnsi(stderrBuffer).trim();
		const stdoutText = stripAnsi(stdoutBuffer).trim();
		const fallbackError = stderrText || stdoutText || "Codex login failed";

		if (currentState === "cancelled") {
			stopActiveProcess();
			return;
		}

		if (code === 0 && currentState !== "error") {
			setSessionPatch({
				state: "authenticated",
				error: undefined,
				message: "Authenticated with ChatGPT subscription.",
			});
		} else if (currentState !== "authenticated") {
			setSessionPatch({
				state: "error",
				error: fallbackError,
				message: "Authentication failed.",
			});
		}

		stopActiveProcess();
	});

	return currentSession;
}

export function getCodexDeviceAuthStatus(): CodexDeviceAuthSession | null {
	return currentSession;
}

export function cancelCodexDeviceAuth(
	sessionId?: string,
): CodexDeviceAuthSession | null {
	if (!currentSession) return null;
	if (sessionId && currentSession.id !== sessionId) {
		return currentSession;
	}

	setSessionPatch({
		state: "cancelled",
		message: "Device authentication cancelled.",
		error: undefined,
	});
	stopActiveProcess();
	return currentSession;
}
