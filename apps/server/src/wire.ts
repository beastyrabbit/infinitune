import type { Playlist, Setting, Song } from "./db/schema";
import { logger } from "./logger";

type WithWireFields<T> = T & { _id: string; _creationTime: number };

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

export type PlaylistWire = WithWireFields<
	Omit<Playlist, "id" | "createdAt" | "steerHistory"> & {
		steerHistory?: Array<{ epoch: number; direction: string; at: number }>;
	}
>;

export function playlistToWire(p: Playlist): PlaylistWire {
	const { id, createdAt, steerHistory, ...rest } = p;
	return {
		_id: id,
		_creationTime: createdAt,
		...rest,
		steerHistory: parseJsonField(steerHistory),
	};
}

export type SongWire = WithWireFields<
	Omit<Song, "id" | "createdAt" | "instruments" | "tags" | "themes"> & {
		instruments?: string[];
		tags?: string[];
		themes?: string[];
	}
>;

export function songToWire(s: Song): SongWire {
	const { id, createdAt, instruments, tags, themes, ...rest } = s;
	return {
		_id: id,
		_creationTime: createdAt,
		...rest,
		instruments: parseJsonField(instruments),
		tags: parseJsonField(tags),
		themes: parseJsonField(themes),
	};
}

export type SettingWire = WithWireFields<Omit<Setting, "id" | "createdAt">>;

export function settingToWire(s: Setting): SettingWire {
	const { id, createdAt, ...rest } = s;
	return {
		_id: id,
		_creationTime: createdAt,
		...rest,
	};
}
