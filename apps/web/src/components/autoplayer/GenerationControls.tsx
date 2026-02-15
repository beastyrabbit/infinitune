import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import VinylIcon from "@/components/ui/vinyl-icon";
import { useUpdatePlaylistPrompt } from "@/integrations/api/hooks";
import type { Playlist } from "@/types";

interface GenerationControlsProps {
	playlist: Playlist;
}

export function GenerationControls({ playlist }: GenerationControlsProps) {
	const updatePrompt = useUpdatePlaylistPrompt();

	const [prompt, setPromptValue] = useState(playlist.prompt);

	useEffect(() => {
		setPromptValue(playlist.prompt);
	}, [playlist.prompt]);

	const handleUpdatePrompt = () => {
		const trimmed = prompt.trim();
		if (!trimmed || trimmed === playlist.prompt) return;
		updatePrompt({ id: playlist.id, prompt: trimmed });
	};

	return (
		<div className="flex flex-col bg-gray-950 p-6">
			<div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">
				GENERATION CONTROLS
			</div>

			{/* Prompt editor */}
			<div>
				{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
				<label className="flex items-center gap-2 text-sm font-bold uppercase text-white/60 mb-2">
					<VinylIcon size={16} />
					PLAYLIST PROMPT
				</label>
				<textarea
					value={prompt}
					onChange={(e) => setPromptValue(e.target.value)}
					className="w-full min-h-[80px] rounded-none border-4 border-white/20 bg-gray-900 px-3 py-2 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none resize-none"
				/>
				<div className="flex items-center justify-between mt-2">
					<div className="text-[10px] font-bold uppercase text-white/20">
						{playlist.llmModel.toUpperCase()} /{" "}
						{playlist.llmProvider.toUpperCase()}
					</div>
					<Button
						className="h-8 rounded-none border-2 border-white/20 bg-red-500 font-mono text-xs font-black uppercase text-white hover:bg-white hover:text-black hover:border-white"
						onClick={handleUpdatePrompt}
						disabled={!prompt.trim() || prompt.trim() === playlist.prompt}
					>
						UPDATE
					</Button>
				</div>
			</div>
		</div>
	);
}
