import type { PlaylistManagerPlan, SongCover } from "@infinitune/shared/types";
import type { Playlist, Setting, Song } from "./db/schema";
import { logger } from "./logger";

export function parseJsonField<T>(value: string | null): T | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch (err) {
		logger.warn(
			{ err, snippet: value.slice(0, 100) },
			"Failed to parse JSON field",
		);
		return undefined;
	}
}

export type PlaylistWire = Omit<Playlist, "steerHistory" | "managerPlan"> & {
	steerHistory?: Array<{ epoch: number; direction: string; at: number }>;
	managerPlan: PlaylistManagerPlan | null;
};

export function playlistToWire(p: Playlist): PlaylistWire {
	const { steerHistory, managerPlan, ...rest } = p;
	return {
		...rest,
		steerHistory: parseJsonField(steerHistory),
		managerPlan: parseJsonField<PlaylistManagerPlan>(managerPlan) ?? null,
	};
}

export type SongWire = Omit<
	Song,
	| "instruments"
	| "tags"
	| "themes"
	| "coverUrl"
	| "coverWebpUrl"
	| "coverJxlUrl"
> & {
	instruments?: string[];
	tags?: string[];
	themes?: string[];
	cover: SongCover | null;
};

function songCoverToWire(song: Song): SongCover | null {
	if (!song.coverUrl && !song.coverWebpUrl && !song.coverJxlUrl) return null;
	return {
		jxlUrl: song.coverJxlUrl ?? null,
		webpUrl: song.coverWebpUrl ?? null,
		pngUrl: song.coverUrl ?? null,
	};
}

export function songToWire(s: Song): SongWire {
	const { instruments, tags, themes } = s;
	const wireRest = { ...s } as Partial<Song>;
	delete wireRest.instruments;
	delete wireRest.tags;
	delete wireRest.themes;
	delete wireRest.coverUrl;
	delete wireRest.coverWebpUrl;
	delete wireRest.coverJxlUrl;
	return {
		...(wireRest as Omit<
			Song,
			| "instruments"
			| "tags"
			| "themes"
			| "coverUrl"
			| "coverWebpUrl"
			| "coverJxlUrl"
		>),
		cover: songCoverToWire(s),
		instruments: parseJsonField(instruments),
		tags: parseJsonField(tags),
		themes: parseJsonField(themes),
	};
}

export type SettingWire = Setting;

export function settingToWire(s: Setting): SettingWire {
	return s;
}
