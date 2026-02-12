import { useMutation } from "convex/react";
import { Compass } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Playlist } from "@/types/convex";
import { api } from "../../../convex/_generated/api";

interface DirectionSteeringProps {
	playlist: Pick<
		Playlist,
		"_id" | "prompt" | "llmProvider" | "llmModel" | "promptEpoch" | "steerHistory"
	>;
	disabled?: boolean;
}

function formatTimeAgo(ms: number): string {
	const seconds = Math.floor((Date.now() - ms) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}min ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

export function DirectionSteering({
	playlist,
	disabled,
}: DirectionSteeringProps) {
	const [value, setValue] = useState("");
	const [loading, setLoading] = useState(false);
	const updatePrompt = useMutation(api.playlists.updatePrompt);

	const handleSubmit = async () => {
		const trimmed = value.trim();
		if (!trimmed || loading) return;

		setLoading(true);
		try {
			const res = await fetch("/api/autoplayer/refine-prompt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					currentPrompt: playlist.prompt,
					direction: trimmed,
					provider: playlist.llmProvider,
					model: playlist.llmModel,
				}),
			});
			const data = await res.json();
			if (data.result) {
				await updatePrompt({
					id: playlist._id,
					prompt: data.result,
				});
				setValue("");
			}
		} catch {
			// Silently fail — prompt stays unchanged
		} finally {
			setLoading(false);
		}
	};

	const history = playlist.steerHistory ?? [];

	return (
		<div className="p-4">
			<div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
				<Compass className="h-3 w-3" />
				STEER DIRECTION
			</div>
			<div className="flex gap-0">
				<Input
					className="h-12 flex-1 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-white/40"
					placeholder="NO MORE LOVE SONGS... / MORE BASS... / MORE TECHNO..."
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
					disabled={disabled || loading}
				/>
				<Button
					className="h-12 rounded-none border-4 border-l-0 border-white/20 bg-white font-mono text-sm font-black uppercase text-black hover:bg-yellow-500 hover:text-black hover:border-yellow-500"
					onClick={handleSubmit}
					disabled={disabled || loading || !value.trim()}
				>
					{loading ? "REFINING..." : "STEER"}
				</Button>
			</div>

			{/* Direction history */}
			{history.length > 0 && (
				<div className="mt-3 space-y-1">
					<p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
						CURRENT DIRECTION: &quot;{playlist.prompt}&quot;
					</p>
					<div className="border-t border-white/10 pt-1">
						<p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-0.5">
							HISTORY:
						</p>
						{[...history]
							.reverse()
							.slice(0, 5)
							.map((entry) => (
								<p
									key={entry.epoch}
									className="text-[10px] uppercase text-white/30 pl-2"
								>
									[{entry.epoch}] &rarr;{" "}
									{entry.direction.length > 60
										? `${entry.direction.slice(0, 60)}...`
										: entry.direction}{" "}
									({formatTimeAgo(entry.at)})
								</p>
							))}
					</div>
				</div>
			)}
		</div>
	);
}
