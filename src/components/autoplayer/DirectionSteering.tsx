import { useMutation } from "convex/react";
import { Compass } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Session } from "@/types/convex";
import { api } from "../../../convex/_generated/api";

interface DirectionSteeringProps {
	session: Pick<Session, "_id" | "prompt" | "llmProvider" | "llmModel">;
	disabled?: boolean;
}

export function DirectionSteering({
	session,
	disabled,
}: DirectionSteeringProps) {
	const [value, setValue] = useState("");
	const [loading, setLoading] = useState(false);
	const updatePrompt = useMutation(api.sessions.updatePrompt);

	const handleSubmit = async () => {
		const trimmed = value.trim();
		if (!trimmed || loading) return;

		setLoading(true);
		try {
			const res = await fetch("/api/autoplayer/refine-prompt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					currentPrompt: session.prompt,
					direction: trimmed,
					provider: session.llmProvider,
					model: session.llmModel,
				}),
			});
			const data = await res.json();
			if (data.updatedPrompt) {
				await updatePrompt({
					id: session._id,
					prompt: data.updatedPrompt,
				});
				setValue("");
			}
		} catch {
			// Silently fail — prompt stays unchanged
		} finally {
			setLoading(false);
		}
	};

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
		</div>
	);
}
