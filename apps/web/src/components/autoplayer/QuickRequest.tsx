import type { LlmProvider } from "@infinitune/shared/types";
import { Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface QuickRequestProps {
	onRequest: (prompt: string) => void;
	disabled?: boolean;
	provider?: LlmProvider;
	model?: string;
}

export function QuickRequest({
	onRequest,
	disabled,
	provider,
	model,
}: QuickRequestProps) {
	const [value, setValue] = useState("");
	const [enhancing, setEnhancing] = useState(false);

	const handleSubmit = async () => {
		const trimmed = value.trim();
		if (!trimmed || enhancing) return;
		setValue("");

		if (provider && model) {
			setEnhancing(true);
			try {
				const res = await fetch("/api/autoplayer/enhance-request", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						request: trimmed,
						provider,
						model,
					}),
				});
				const data = await res.json();
				if (data.result) {
					onRequest(data.result);
				} else {
					onRequest(trimmed);
				}
			} catch {
				onRequest(trimmed);
			} finally {
				setEnhancing(false);
			}
		} else {
			onRequest(trimmed);
		}
	};

	return (
		<div className="p-4">
			<div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
				<Zap className="h-3 w-3" />
				QUICK REQUEST — ONE-OFF SONG
			</div>
			<div className="flex gap-0">
				<Input
					className="h-12 flex-1 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-white/40"
					placeholder="ACOUSTIC COVER OF BOHEMIAN RHAPSODY..."
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
					disabled={disabled || enhancing}
				/>
				<Button
					className="h-12 rounded-none border-4 border-l-0 border-white/20 bg-white font-mono text-sm font-black uppercase text-black hover:bg-red-500 hover:text-white hover:border-red-500"
					onClick={handleSubmit}
					disabled={disabled || enhancing || !value.trim()}
				>
					{enhancing ? "ENHANCING..." : "SEND"}
				</Button>
			</div>
		</div>
	);
}
