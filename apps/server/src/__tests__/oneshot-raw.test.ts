import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: vi.fn(),
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

import { playlists, songs } from "../db/schema";
import { emit } from "../events/event-bus";
import createRoutes from "../routes/songs/create";

const RAW_LYRICS = `[verse]
Neon rivers running through the midnight town
Every heartbeat echoes when the sun goes down

[chorus]
Turn it up, let the satellites align`;

describe("POST /oneshot-raw", () => {
	beforeEach(() => {
		setupTestDb();
		vi.mocked(emit).mockClear();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it("creates an oneshot playlist plus a metadata_ready song with verbatim text", async () => {
		const res = await createRoutes.request("/oneshot-raw", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				lyrics: RAW_LYRICS,
				style: "synthwave, driving bass, female vocal",
				audioDuration: 180,
				playlistKey: "testkey1",
			}),
		});
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			playlist: { id: string };
			song: { id: string };
		};

		const [playlistRow] = await getTestDb()
			.select()
			.from(playlists)
			.where(eq(playlists.id, data.playlist.id));
		expect(playlistRow.mode).toBe("oneshot");
		expect(playlistRow.status).toBe("active");
		expect(playlistRow.audioDuration).toBe(180);
		// Critical: explicit user duration must never be auto-detected (-1) by ACE
		expect(playlistRow.aceAutoDuration).toBe(false);

		const songRows = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.playlistId, data.playlist.id));
		expect(songRows).toHaveLength(1);
		const song = songRows[0];
		// metadata_ready skips the entire LLM metadata stage
		expect(song.status).toBe("metadata_ready");
		expect(song.lyrics).toBe(RAW_LYRICS);
		expect(song.caption).toBe("synthwave, driving bass, female vocal");
		expect(song.genre).toBe("synthwave");
		expect(song.title).toBe("Neon rivers running through the midnight town");
		expect(song.audioDuration).toBe(180);
		// No coverPrompt → startCover() skips cover generation
		expect(song.coverPrompt ?? null).toBeNull();
	});

	it("emits song.created before playlist.created so the buffer check sees the song", async () => {
		const res = await createRoutes.request("/oneshot-raw", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lyrics: "just one line of lyrics" }),
		});
		expect(res.status).toBe(200);

		const events = vi.mocked(emit).mock.calls.map(([name]) => name);
		const songIdx = events.indexOf("song.created");
		const playlistIdx = events.indexOf("playlist.created");
		expect(songIdx).toBeGreaterThanOrEqual(0);
		expect(playlistIdx).toBeGreaterThan(songIdx);
	});

	it("rejects empty lyrics", async () => {
		const res = await createRoutes.request("/oneshot-raw", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lyrics: "" }),
		});
		expect(res.status).toBe(400);
	});

	it("falls back to defaults when style is omitted", async () => {
		const res = await createRoutes.request("/oneshot-raw", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lyrics: "[intro]\n\nhello world" }),
		});
		expect(res.status).toBe(200);
		const data = (await res.json()) as { song: { id: string } };

		const [song] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, data.song.id));
		expect(song.genre).toBe("electronic");
		expect(song.title).toBe("hello world");
		expect(song.audioDuration).toBe(180);
	});
});
