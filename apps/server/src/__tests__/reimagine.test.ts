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

vi.mock("../utils/song-audio-path", () => ({
	resolveSongAudioFile: vi.fn((storagePath: string | null | undefined) =>
		storagePath ? `${storagePath}/audio.mp3` : null,
	),
}));

import { playlists, songs } from "../db/schema";
import createRoutes from "../routes/songs/create";

const SOURCE_LYRICS = "[verse]\nOriginal words stay exactly the same\n";

async function insertSourceSong(opts?: { storagePath?: string | null }) {
	const db = getTestDb();
	const [playlist] = await db
		.insert(playlists)
		.values({
			name: "Source",
			prompt: "source",
			llmProvider: "openai-codex",
			llmModel: "",
			mode: "endless",
			status: "active",
			songsGenerated: 1,
			promptEpoch: 0,
		})
		.returning();
	const [song] = await db
		.insert(songs)
		.values({
			playlistId: playlist.id,
			orderIndex: 1,
			status: "ready",
			title: "Original Song",
			artistName: "Original Band",
			genre: "pop funk",
			lyrics: SOURCE_LYRICS,
			caption: "tense 1980s pop-funk",
			bpm: 117,
			keyScale: "F# minor",
			timeSignature: "4/4",
			audioDuration: 294,
			storagePath:
				opts && "storagePath" in opts
					? opts.storagePath
					: "/music/original-song",
			audioUrl: "/api/songs/x/audio",
		} as typeof songs.$inferInsert)
		.returning();
	return song;
}

describe("POST /reimagine", () => {
	beforeEach(() => {
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it("creates a cover-task song with the source lyrics and target style", async () => {
		const source = await insertSourceSong();
		const res = await createRoutes.request("/reimagine", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sourceSongId: source.id,
				style: "neue deutsche welle, analog synths, deadpan vocals",
				coverNoiseStrength: 0.7,
				playlistKey: "reimg1",
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
		// Cover output must match the source length — no ACE auto-detection
		expect(playlistRow.aceAutoDuration).toBe(false);
		expect(playlistRow.audioDuration).toBe(294);

		const [song] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, data.song.id));
		expect(song.status).toBe("metadata_ready");
		expect(song.aceTaskType).toBe("cover");
		expect(song.sourceSongId).toBe(source.id);
		expect(song.coverNoiseStrength).toBe(0.7);
		expect(song.lyrics).toBe(SOURCE_LYRICS);
		expect(song.caption).toBe(
			"neue deutsche welle, analog synths, deadpan vocals",
		);
		expect(song.title).toBe("Original Song (Reimagined)");
		expect(song.bpm).toBe(117);
		expect(song.audioDuration).toBe(294);
	});

	it("rejects unknown source songs", async () => {
		const res = await createRoutes.request("/reimagine", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sourceSongId: "nope", style: "jazz" }),
		});
		expect(res.status).toBe(404);
	});

	it("rejects sources whose audio is unavailable", async () => {
		const source = await insertSourceSong({ storagePath: null });
		const res = await createRoutes.request("/reimagine", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sourceSongId: source.id, style: "jazz" }),
		});
		expect(res.status).toBe(400);
	});
});
