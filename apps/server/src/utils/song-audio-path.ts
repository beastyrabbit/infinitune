import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a song's audio file on the local filesystem.
 * DB may hold old dev paths (ACE_NAS_PREFIX) that map to the pod NFS mount.
 * Returns the existing file path, or null when the audio isn't reachable.
 */
export function resolveSongAudioFile(
	storagePath: string | null | undefined,
): string | null {
	if (!storagePath) return null;

	let audioFile = path.join(storagePath, "audio.mp3");
	if (fs.existsSync(audioFile)) return audioFile;

	const nasPrefix = process.env.ACE_NAS_PREFIX;
	const nfsMount = process.env.NFS_MOUNT_PATH || "/music";
	if (nasPrefix && storagePath.startsWith(nasPrefix)) {
		audioFile = path.join(
			nfsMount + storagePath.slice(nasPrefix.length),
			"audio.mp3",
		);
		if (fs.existsSync(audioFile)) return audioFile;
	}

	return null;
}
