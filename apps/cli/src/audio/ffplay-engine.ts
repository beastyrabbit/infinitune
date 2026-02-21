import { type ChildProcess, spawn } from "node:child_process";

export type PlaybackSnapshot = {
	songId: string | null;
	url: string | null;
	isPlaying: boolean;
	currentTime: number;
	volume: number;
	isMuted: boolean;
	preloadedSongId: string | null;
};

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

export class FfplayEngine {
	private process: ChildProcess | null = null;
	private scheduledStart: ReturnType<typeof setTimeout> | null = null;
	private songId: string | null = null;
	private url: string | null = null;
	private startOffsetSec = 0;
	private startedAtMs = 0;
	private pausedAtSec: number | null = null;
	private volume = 0.8;
	private muted = false;
	private restartOnResume = false;
	private expectedExits = new WeakSet<ChildProcess>();
	private preloadSongId: string | null = null;
	private onEnded: () => void;

	constructor(onEnded: () => void) {
		this.onEnded = onEnded;
	}

	loadSong(
		songId: string,
		url: string,
		startAt: number | undefined,
		serverTimeOffsetMs: number,
	): void {
		this.songId = songId;
		this.url = url;
		this.startOffsetSec = 0;
		this.pausedAtSec = null;
		this.restartOnResume = false;

		const localStartAt =
			typeof startAt === "number" ? startAt - serverTimeOffsetMs : undefined;
		this.startAtOffset(0, localStartAt);
	}

	preload(songId: string, url: string): void {
		this.preloadSongId = songId;
		void url;
	}

	play(): void {
		if (!this.songId || !this.url) return;
		if (this.process && this.pausedAtSec !== null) {
			if (this.restartOnResume) {
				const offset = this.pausedAtSec;
				this.pausedAtSec = null;
				this.restartOnResume = false;
				this.startAtOffset(offset);
				return;
			}
			this.process.kill("SIGCONT");
			this.startOffsetSec = this.pausedAtSec;
			this.startedAtMs = Date.now();
			this.pausedAtSec = null;
			return;
		}
		if (!this.process) {
			const offset = this.pausedAtSec ?? this.startOffsetSec;
			this.pausedAtSec = null;
			this.restartOnResume = false;
			this.startAtOffset(offset);
		}
	}

	pause(): void {
		if (!this.process || this.pausedAtSec !== null) return;
		this.pausedAtSec = this.currentTime();
		this.process.kill("SIGSTOP");
	}

	toggle(): void {
		if (this.pausedAtSec !== null) {
			this.play();
			return;
		}
		this.pause();
	}

	seek(seconds: number): void {
		const target = Math.max(0, seconds);
		if (!this.songId || !this.url) return;

		if (this.pausedAtSec !== null) {
			this.stopProcess(false);
			this.startOffsetSec = target;
			this.pausedAtSec = target;
			this.restartOnResume = false;
			return;
		}

		this.startAtOffset(target);
	}

	setVolume(volume: number): void {
		this.volume = clamp01(volume);
		if (!this.songId || !this.url) return;
		if (this.pausedAtSec !== null) {
			this.restartOnResume = true;
			return;
		}
		this.startAtOffset(this.currentTime());
	}

	adjustVolume(delta: number): number {
		this.setVolume(this.volume + delta);
		return this.volume;
	}

	toggleMute(): boolean {
		this.muted = !this.muted;
		if (!this.songId || !this.url) {
			return this.muted;
		}
		if (this.pausedAtSec !== null) {
			this.restartOnResume = true;
			return this.muted;
		}
		this.startAtOffset(this.currentTime());
		return this.muted;
	}

	stop(resetSong = false): void {
		this.stopProcess(resetSong);
		this.restartOnResume = false;
		if (resetSong) {
			this.songId = null;
			this.url = null;
			this.startOffsetSec = 0;
			this.pausedAtSec = null;
		}
	}

	destroy(): void {
		this.stop(true);
	}

	isPlaying(): boolean {
		return this.process !== null && this.pausedAtSec === null;
	}

	currentTime(): number {
		if (this.pausedAtSec !== null) return this.pausedAtSec;
		if (!this.process) return this.startOffsetSec;
		return this.startOffsetSec + (Date.now() - this.startedAtMs) / 1000;
	}

	getVolume(): number {
		return this.volume;
	}

	isMuted(): boolean {
		return this.muted;
	}

	getSnapshot(): PlaybackSnapshot {
		return {
			songId: this.songId,
			url: this.url,
			isPlaying: this.isPlaying(),
			currentTime: this.currentTime(),
			volume: this.volume,
			isMuted: this.muted,
			preloadedSongId: this.preloadSongId,
		};
	}

	private effectiveVolumePercent(): number {
		if (this.muted) return 0;
		return Math.round(clamp01(this.volume) * 100);
	}

	private startAtOffset(offsetSec: number, localStartAt?: number): void {
		if (!this.url) return;

		if (this.scheduledStart) {
			clearTimeout(this.scheduledStart);
			this.scheduledStart = null;
		}

		let effectiveOffset = Math.max(0, offsetSec);
		if (typeof localStartAt === "number") {
			const delayMs = localStartAt - Date.now();
			if (delayMs > 30) {
				this.stopProcess(false);
				this.scheduledStart = setTimeout(() => {
					this.scheduledStart = null;
					this.spawnAtOffset(effectiveOffset);
				}, delayMs);
				return;
			}
			if (delayMs < -50) {
				effectiveOffset += Math.abs(delayMs) / 1000;
			}
		}

		this.spawnAtOffset(effectiveOffset);
	}

	private spawnAtOffset(offsetSec: number): void {
		if (!this.url) return;

		this.stopProcess(false);
		this.startOffsetSec = Math.max(0, offsetSec);
		this.startedAtMs = Date.now();
		this.pausedAtSec = null;
		this.restartOnResume = false;

		const args = [
			"-nodisp",
			"-autoexit",
			"-loglevel",
			"error",
			"-ss",
			this.startOffsetSec.toFixed(3),
			"-volume",
			String(this.effectiveVolumePercent()),
			"-i",
			this.url,
		];

		const processHandle = spawn("ffplay", args, {
			stdio: ["ignore", "ignore", "ignore"],
		});
		this.process = processHandle;

		processHandle.on("exit", () => {
			const wasExpected = this.expectedExits.has(processHandle);
			if (wasExpected) {
				this.expectedExits.delete(processHandle);
				if (this.process === processHandle) {
					this.process = null;
				}
				return;
			}

			if (this.process !== processHandle) return;
			this.process = null;

			if (this.pausedAtSec !== null) return;
			this.onEnded();
		});

		processHandle.on("error", () => {
			if (this.process !== processHandle) return;
			this.process = null;
		});
	}

	private stopProcess(resetSong: boolean): void {
		if (this.scheduledStart) {
			clearTimeout(this.scheduledStart);
			this.scheduledStart = null;
		}

		if (this.process) {
			const processToStop = this.process;
			this.expectedExits.add(processToStop);
			try {
				processToStop.kill("SIGTERM");
			} catch {
				// Ignore kill failures.
				this.expectedExits.delete(processToStop);
			}
			this.process = null;
		}

		if (!resetSong) {
			this.startOffsetSec = this.pausedAtSec ?? this.startOffsetSec;
		}
	}
}
