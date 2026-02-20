import { Music } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PlaylistConfigProps {
	prompt: string;
	provider: string;
	model: string;
	onUpdatePrompt: (prompt: string) => void | Promise<void>;
}

export function PlaylistConfig({
	prompt,
	provider,
	model,
	onUpdatePrompt,
}: PlaylistConfigProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
	const value = draft ?? prompt;

	useEffect(() => {
		if (!submittedPrompt) return;
		if (prompt !== submittedPrompt) return;
		setDraft(null);
		setSubmittedPrompt(null);
	}, [prompt, submittedPrompt]);

	const handleUpdate = async () => {
		if (submittedPrompt !== null) return;
		const trimmed = value.trim();
		if (!trimmed || trimmed === prompt) return;
		setSubmittedPrompt(trimmed);
		try {
			await Promise.resolve(onUpdatePrompt(trimmed));
		} finally {
			setSubmittedPrompt((current) => (current === trimmed ? null : current));
		}
	};

	return (
		<div className="p-4">
			<div className="mb-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-white/60">
				<Music className="h-3 w-3" />
				PLAYLIST CONFIG — CONTINUOUS GENERATION
			</div>
			<div className="flex gap-0">
				<Input
					className="h-12 flex-1 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-white/40"
					aria-label="Playlist prompt"
					value={value}
					onChange={(e) => {
						setDraft(e.target.value);
						setSubmittedPrompt(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleUpdate();
					}}
				/>
				<Button
					className="h-12 rounded-none border-4 border-l-0 border-white/20 bg-red-500 font-mono text-sm font-black uppercase text-white hover:bg-white hover:text-black hover:border-white"
					onClick={handleUpdate}
					disabled={
						!value.trim() || value.trim() === prompt || submittedPrompt !== null
					}
				>
					UPDATE
				</Button>
			</div>
			<div className="mt-2 flex items-center gap-4 text-[10px] font-bold uppercase text-white/20">
				<span>MODEL: {model.toUpperCase()}</span>
				<span>|</span>
				<span>PROVIDER: {provider.toUpperCase()}</span>
				<span>|</span>
				<span>BUFFER: 2 AHEAD</span>
			</div>
		</div>
	);
}
