import { spawnSync } from "node:child_process";

export type FzfOptions = {
	prompt: string;
	header?: string;
};

export function pickFromFzf(
	lines: string[],
	options: FzfOptions,
): string | null {
	if (lines.length === 0) return null;

	const args = [
		"--ansi",
		"--height",
		"40%",
		"--reverse",
		"--prompt",
		`${options.prompt}> `,
	];
	if (options.header) {
		args.push("--header", options.header);
	}

	const result = spawnSync("fzf", args, {
		input: `${lines.join("\n")}\n`,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "inherit"],
	});

	if (result.error) {
		if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				"fzf is not installed. Install fzf to use picker commands.",
			);
		}
		throw result.error;
	}

	if (result.status !== 0) return null;
	const selected = result.stdout.trim();
	return selected.length > 0 ? selected : null;
}
