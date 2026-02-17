import { createFileRoute } from "@tanstack/react-router";
import type { SongMetadata } from "@/services/llm";
import { generateSongMetadata } from "@/services/llm";

interface SourceSong {
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	mood?: string;
	energy?: string;
	era?: string;
	bpm?: number;
	keyScale?: string;
	vocalStyle?: string;
	instruments?: string[];
	themes?: string[];
	description?: string;
	lyrics?: string;
}

interface LikedSong {
	title: string;
	artistName: string;
	genre: string;
	mood?: string;
	vocalStyle?: string;
}

interface AlbumTrackRequest {
	playlistPrompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	sourceSong: SourceSong;
	likedSongs?: LikedSong[];
	personaExtracts?: string[];
	avoidPersonaExtracts?: string[];
	previousAlbumTracks?: SongMetadata[];
	trackNumber: number;
	totalTracks: number;
	lyricsLanguage?: string;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
}

function buildAlbumPrompt(req: AlbumTrackRequest): string {
	const lines: string[] = [];

	// 1. Playlist context
	lines.push(`PLAYLIST CONTEXT: ${req.playlistPrompt}`);
	lines.push("");

	// 2. Source song block
	const s = req.sourceSong;
	lines.push("SOURCE SONG (the album is derived from this track):");
	lines.push(`  Title: "${s.title}" by ${s.artistName}`);
	lines.push(`  Genre: ${s.genre} / ${s.subGenre}`);
	if (s.mood) lines.push(`  Mood: ${s.mood}`);
	if (s.energy) lines.push(`  Energy: ${s.energy}`);
	if (s.era) lines.push(`  Era: ${s.era}`);
	if (s.bpm) lines.push(`  BPM: ${s.bpm}`);
	if (s.keyScale) lines.push(`  Key: ${s.keyScale}`);
	if (s.vocalStyle) lines.push(`  Vocal: ${s.vocalStyle}`);
	if (s.instruments?.length)
		lines.push(`  Instruments: ${s.instruments.join(", ")}`);
	if (s.themes?.length) lines.push(`  Themes: ${s.themes.join(", ")}`);
	if (s.description) lines.push(`  Description: ${s.description}`);
	if (s.lyrics) {
		const excerpt = s.lyrics.slice(0, 500);
		lines.push(`  Lyrics excerpt: ${excerpt}`);
	}
	lines.push("");

	// 3. Listener taste profile from persona extracts
	if (req.personaExtracts && req.personaExtracts.length > 0) {
		lines.push("LISTENER TASTE PROFILE (from liked songs this session):");
		for (const persona of req.personaExtracts) {
			lines.push(`  - ${persona}`);
		}
		lines.push(
			"These personas represent what the listener enjoys. Align album tracks with this taste profile.",
		);
		lines.push("");
	}

	// 3b. Listener dislikes from down-voted persona extracts
	if (req.avoidPersonaExtracts && req.avoidPersonaExtracts.length > 0) {
		lines.push("LISTENER DISLIKES (avoid these patterns):");
		for (const persona of req.avoidPersonaExtracts) {
			lines.push(`  - ${persona}`);
		}
		lines.push(
			"These represent what the listener does NOT enjoy. Steer away from these sonic and thematic patterns.",
		);
		lines.push("");
	}

	// 4. Liked songs block (up to 10)
	if (req.likedSongs && req.likedSongs.length > 0) {
		const liked = req.likedSongs.slice(0, 10);
		lines.push(
			"LIKED SONGS (listener preferences — use as additional flavor guidance):",
		);
		for (const l of liked) {
			const parts = [`"${l.title}" by ${l.artistName}`, l.genre];
			if (l.mood) parts.push(l.mood);
			if (l.vocalStyle) parts.push(l.vocalStyle);
			lines.push(`  - ${parts.join(" / ")}`);
		}
		lines.push("");
	}

	// 5. Previously generated album tracks (for diversity enforcement)
	if (req.previousAlbumTracks && req.previousAlbumTracks.length > 0) {
		lines.push(
			"ALREADY GENERATED ALBUM TRACKS (create something DIFFERENT from these):",
		);
		for (const t of req.previousAlbumTracks) {
			lines.push(
				`  - "${t.title}" by ${t.artistName} — ${t.genre}/${t.subGenre}, ${t.mood}, ${t.energy} energy, ${t.vocalStyle}, BPM ${t.bpm}`,
			);
		}
		lines.push("");
	}

	// 6. Track position guidance
	const pos = req.trackNumber;
	const total = req.totalTracks;
	let positionHint: string;
	if (pos === 1) {
		positionHint =
			"This is the ALBUM OPENER — high energy, attention-grabbing, sets the tone for the whole album.";
	} else if (pos === total) {
		positionHint =
			"This is the ALBUM CLOSER — reflective, emotionally resonant, leaves a lasting impression.";
	} else if (pos <= 3) {
		positionHint =
			"Early album track — build momentum, establish the album's identity.";
	} else if (pos >= total - 2) {
		positionHint =
			"Late album track — wind down the energy, prepare for the closing.";
	} else {
		positionHint =
			"Mid-album track — take creative risks, explore different facets of the genre.";
	}
	lines.push(`TRACK POSITION: ${pos} of ${total}. ${positionHint}`);
	lines.push("");
	lines.push("Generate a new album track now.");

	return lines.join("\n");
}

export const Route = createFileRoute("/api/autoplayer/generate-album-track")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = (await request.json()) as AlbumTrackRequest;
					const prompt = buildAlbumPrompt(body);
					const songData = await generateSongMetadata({
						prompt,
						promptDistance: "album",
						provider: body.provider,
						model: body.model,
						lyricsLanguage: body.lyricsLanguage,
						targetKey: body.targetKey,
						timeSignature: body.timeSignature,
						audioDuration: body.audioDuration,
					});
					return new Response(JSON.stringify(songData), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to generate album track",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			},
		},
	},
});
