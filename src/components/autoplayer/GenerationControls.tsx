import { useMutation, useQuery } from "convex/react";
import { Gauge, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";

const LANGUAGES = [
	{ value: "auto", label: "Auto" },
	{ value: "english", label: "English" },
	{ value: "german", label: "German" },
	{ value: "spanish", label: "Spanish" },
	{ value: "french", label: "French" },
	{ value: "korean", label: "Korean" },
	{ value: "japanese", label: "Japanese" },
	{ value: "russian", label: "Russian" },
] as const;

export function GenerationControls() {
	const settings = useQuery(api.settings.getAll);
	const setSetting = useMutation(api.settings.set);

	const [language, setLanguage] = useState("auto");
	const [bpmOverride, setBpmOverride] = useState("");
	const initializedRef = useRef(false);
	const bpmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync from Convex on mount
	useEffect(() => {
		if (settings === undefined || initializedRef.current) return;
		initializedRef.current = true;
		if (settings.lyricsLanguage) setLanguage(settings.lyricsLanguage);
		if (settings.bpmOverride) setBpmOverride(settings.bpmOverride);
	}, [settings]);

	const handleLanguageChange = (value: string) => {
		setLanguage(value);
		setSetting({ key: "lyricsLanguage", value });
	};

	const handleBpmChange = (value: string) => {
		// Allow empty or digits only
		if (value !== "" && !/^\d+$/.test(value)) return;
		setBpmOverride(value);
		if (bpmDebounceRef.current) clearTimeout(bpmDebounceRef.current);
		bpmDebounceRef.current = setTimeout(() => {
			setSetting({ key: "bpmOverride", value });
		}, 500);
	};

	return (
		<div className="flex flex-col bg-gray-950 p-6">
			<div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">
				GENERATION CONTROLS
			</div>

			{/* Language */}
			<div className="mb-6">
				<label className="flex items-center gap-2 text-sm font-bold uppercase text-white/60 mb-2">
					<Globe className="h-4 w-4" />
					LYRICS LANGUAGE
				</label>
				<select
					value={language}
					onChange={(e) => handleLanguageChange(e.target.value)}
					className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 px-3 font-mono text-sm font-bold uppercase text-white focus:border-red-500 focus:outline-none"
				>
					{LANGUAGES.map((lang) => (
						<option key={lang.value} value={lang.value}>
							{lang.label}
						</option>
					))}
				</select>
				<p className="mt-1 text-xs text-white/30 uppercase">
					{language === "auto"
						? "LLM chooses freely"
						: `All lyrics in ${language}`}
				</p>
			</div>

			{/* BPM Override */}
			<div className="mb-6">
				<label className="flex items-center gap-2 text-sm font-bold uppercase text-white/60 mb-2">
					<Gauge className="h-4 w-4" />
					BPM OVERRIDE
				</label>
				<input
					type="text"
					inputMode="numeric"
					value={bpmOverride}
					onChange={(e) => handleBpmChange(e.target.value)}
					placeholder="AUTO"
					className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 px-3 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
				/>
				<p className="mt-1 text-xs text-white/30 uppercase">
					{bpmOverride
						? `Fixed at ${bpmOverride} BPM`
						: "LLM chooses BPM freely"}
				</p>
				{bpmOverride &&
					(Number(bpmOverride) < 60 || Number(bpmOverride) > 220) && (
						<p className="mt-1 text-xs text-red-500 uppercase">
							Valid range: 60–220
						</p>
					)}
			</div>

			{/* Visual separator */}
			<div className="mt-auto border-t-4 border-white/10 pt-4">
				<div className="text-xs text-white/20 uppercase">
					Changes apply to next generated song
				</div>
			</div>
		</div>
	);
}
