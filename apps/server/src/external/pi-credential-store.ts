import fs from "node:fs";
import path from "node:path";
import type {
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";

type CredentialMap = Record<string, Credential>;

/** Per-file write queues so concurrent modifications never interleave. */
const writeQueues = new Map<string, Promise<unknown>>();

function isCredential(value: unknown): value is Credential {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const credential = value as Record<string, unknown>;
	if (credential.type === "api_key") {
		return credential.key === undefined || typeof credential.key === "string";
	}
	return (
		credential.type === "oauth" &&
		typeof credential.access === "string" &&
		typeof credential.refresh === "string" &&
		typeof credential.expires === "number"
	);
}

/**
 * Pi credentials in Infinitune's own auth.json, in the same
 * `{ [providerId]: credential }` format older Pi releases wrote.
 *
 * Values are returned literally. Pi's built-in file store would expand API
 * keys starting with `!` (shell command) or containing `$VAR` (environment
 * lookup), which must never apply to keys users paste into the settings UI.
 */
export class FileCredentialStore implements CredentialStore {
	constructor(readonly authPath: string) {}

	/** Raw file contents; entries this store cannot parse are preserved on write. */
	private readRaw(): Record<string, unknown> {
		if (!fs.existsSync(this.authPath)) return {};
		const raw = fs.readFileSync(this.authPath, "utf8").replace(/^\uFEFF/, "");
		if (!raw.trim()) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`Pi auth file is not a JSON object: ${this.authPath}`);
		}
		return parsed as Record<string, unknown>;
	}

	private readAll(): CredentialMap {
		return Object.fromEntries(
			Object.entries(this.readRaw()).filter(
				(entry): entry is [string, Credential] => isCredential(entry[1]),
			),
		);
	}

	private writeAll(credentials: Record<string, unknown>): void {
		fs.mkdirSync(path.dirname(this.authPath), { recursive: true });
		const tempPath = `${this.authPath}.${process.pid}.tmp`;
		fs.writeFileSync(tempPath, JSON.stringify(credentials, null, 2), {
			encoding: "utf8",
			mode: 0o600,
		});
		fs.renameSync(tempPath, this.authPath);
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const previous = writeQueues.get(this.authPath) ?? Promise.resolve();
		const next = previous.then(operation, operation);
		writeQueues.set(
			this.authPath,
			next.catch(() => undefined),
		);
		return next;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		return this.readAll()[providerId];
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(this.readAll()).map(([providerId, credential]) => ({
			providerId,
			type: credential.type,
		}));
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.enqueue(async () => {
			const raw = this.readRaw();
			const current = isCredential(raw[providerId])
				? raw[providerId]
				: undefined;
			const next = await fn(current);
			if (next === current) return next;
			if (next === undefined) {
				delete raw[providerId];
			} else {
				raw[providerId] = next;
			}
			this.writeAll(raw);
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.enqueue(async () => {
			const raw = this.readRaw();
			if (!(providerId in raw)) return;
			delete raw[providerId];
			this.writeAll(raw);
		});
	}
}
