import { Loader2, Plus, Radio, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	useActivateStationPreset,
	useControlAuthSession,
	useCreateStationPreset,
	useDeleteStationPreset,
	useStationPresets,
} from "@/integrations/api/hooks";

/**
 * Text-only station presets. Exactly one preset is active at a time; the
 * active preset seeds future album generation intent — playback and
 * in-flight generations are never interrupted.
 */
export function StationPresets() {
	const presets = useStationPresets();
	const authSession = useControlAuthSession();
	const canManage = authSession?.authenticated === true;
	const activate = useActivateStationPreset();
	const remove = useDeleteStationPreset();
	const [activatingId, setActivatingId] = useState<string | null>(null);
	const [removingId, setRemovingId] = useState<string | null>(null);

	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [genrePrompt, setGenrePrompt] = useState("");
	const [vocalStyle, setVocalStyle] = useState("");

	return (
		<div className="border border-white/10 bg-[#171a1b] p-5">
			<div className="mb-4 flex items-center justify-between">
				<h3 className="flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
					<Radio className="h-4 w-4" />
					Stations
				</h3>
				{canManage ? (
					<button
						type="button"
						onClick={() => setCreating(!creating)}
						className="border border-white/15 px-3 py-1 font-mono text-xs uppercase tracking-widest text-white/60 transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
					>
						{creating ? "Cancel" : "New"}
					</button>
				) : (
					<span className="font-mono text-[10px] uppercase tracking-widest text-white/35">
						Sign in to manage
					</span>
				)}
			</div>

			{canManage && creating && (
				<StationPresetForm
					name={name}
					genrePrompt={genrePrompt}
					vocalStyle={vocalStyle}
					onName={setName}
					onGenrePrompt={setGenrePrompt}
					onVocalStyle={setVocalStyle}
				/>
			)}

			<ul className="space-y-2">
				{(presets ?? []).map((preset) => (
					<li
						key={preset.id}
						className={`flex items-center gap-3 border px-3 py-2 ${
							preset.isActive
								? "border-emerald-400/60 bg-emerald-400/10"
								: "border-white/10 bg-white/[0.03]"
						}`}
					>
						<div className="min-w-0 flex-1">
							<p className="truncate font-mono text-sm font-bold uppercase">
								{preset.name}
								{preset.isActive && (
									<span className="ml-2 text-[10px] tracking-widest text-emerald-300">
										ON AIR
									</span>
								)}
							</p>
							<p className="truncate font-mono text-xs text-white/45">
								{preset.genrePrompt}
							</p>
						</div>
						{canManage && !preset.isActive && (
							<button
								type="button"
								disabled={activatingId !== null}
								onClick={async () => {
									setActivatingId(preset.id);
									try {
										await activate(preset.id);
									} catch {
										// The mutation hook already reports the API error.
									} finally {
										setActivatingId(null);
									}
								}}
								className="border border-white/15 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-white/60 transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:opacity-50"
							>
								{activatingId === preset.id ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									"Play this"
								)}
							</button>
						)}
						{canManage && (
							<button
								type="button"
								disabled={removingId !== null}
								title="Delete station"
								onClick={async () => {
									setRemovingId(preset.id);
									try {
										await remove(preset.id);
									} catch {
										// The mutation hook already reports the API error.
									} finally {
										setRemovingId(null);
									}
								}}
								className="text-white/30 transition-colors hover:text-red-400 disabled:opacity-30"
							>
								{removingId === preset.id ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Trash2 className="h-3.5 w-3.5" />
								)}
							</button>
						)}
					</li>
				))}
				{presets && presets.length === 0 && !creating && (
					<li className="border border-dashed border-white/10 px-3 py-4 text-center font-mono text-xs uppercase tracking-widest text-white/35">
						No stations yet — albums pick random themes
					</li>
				)}
			</ul>
		</div>
	);
}

function StationPresetForm(props: {
	name: string;
	genrePrompt: string;
	vocalStyle: string;
	onName: (value: string) => void;
	onGenrePrompt: (value: string) => void;
	onVocalStyle: (value: string) => void;
}) {
	const create = useCreateStationPreset();
	const [busy, setBusy] = useState(false);

	const handleCreate = async () => {
		if (!props.name.trim() || !props.genrePrompt.trim() || busy) return;
		setBusy(true);
		try {
			await create({
				name: props.name.trim(),
				genrePrompt: props.genrePrompt.trim(),
				vocalStyle: props.vocalStyle.trim() || undefined,
			});
			props.onName("");
			props.onGenrePrompt("");
			props.onVocalStyle("");
		} catch {
			// The mutation hook already reports the API error.
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				handleCreate();
			}}
			className="mb-4 space-y-2 border border-white/10 bg-black/40 p-3"
		>
			<input
				value={props.name}
				onChange={(event) => props.onName(event.target.value)}
				placeholder="Station name (e.g. Midnight Synthwave)"
				maxLength={80}
				className="w-full border border-white/10 bg-black px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400/60"
			/>
			<input
				value={props.genrePrompt}
				onChange={(event) => props.onGenrePrompt(event.target.value)}
				placeholder="Genre / mood prompt for new albums"
				maxLength={500}
				className="w-full border border-white/10 bg-black px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400/60"
			/>
			<input
				value={props.vocalStyle}
				onChange={(event) => props.onVocalStyle(event.target.value)}
				placeholder="Vocal style (optional)"
				maxLength={300}
				className="w-full border border-white/10 bg-black px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400/60"
			/>
			<button
				type="submit"
				disabled={!props.name.trim() || !props.genrePrompt.trim() || busy}
				className="flex items-center gap-1 border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 font-mono text-xs font-black uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-40"
			>
				{busy ? (
					<Loader2 className="h-3 w-3 animate-spin" />
				) : (
					<Plus className="h-3 w-3" />
				)}
				Create station
			</button>
		</form>
	);
}
