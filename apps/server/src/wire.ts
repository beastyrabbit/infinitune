import type { PlaylistManagerPlan } from "@infinitune/shared/types";
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

export type SongWire = Omit<Song, "instruments" | "tags" | "themes"> & {
	instruments?: string[];
	tags?: string[];
	themes?: string[];
};

export function songToWire(s: Song): SongWire {
	const { instruments, tags, themes, ...rest } = s;
	return {
		...rest,
		instruments: parseJsonField(instruments),
		tags: parseJsonField(tags),
		themes: parseJsonField(themes),
	};
}

export type SettingWire = Setting;

export function settingToWire(s: Setting): SettingWire {
	return s;
}
