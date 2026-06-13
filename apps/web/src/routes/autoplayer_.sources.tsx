import { createFileRoute } from "@tanstack/react-router";
import {
	FolderOpen,
	HardDriveDownload,
	Link2,
	Loader2,
	Plus,
	Save,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OpsPageHeader } from "@/components/autoplayer/OpsPageHeader";
import { Stat } from "@/components/autoplayer/Stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	type RadioCoverSource,
	useAddRadioSource,
	useDeleteRadioSource,
	useRadioSources,
	useSetSetting,
	useSettings,
} from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/sources")({
	component: SourcesPage,
});

/** Mirrors DEFAULT_RADIO_SOURCE_SETTINGS on the server. */
const SOURCE_SETTING_DEFAULTS: Record<string, string> = {
	radioCoversPerAlbum: "8",
	radioNewPerAlbum: "1",
	radioCoverOfCoverPerAlbum: "1",
	radioRandomFill: "2",
	radioSearchRatio: "0.75",
	radioSourceLibraryDir: "",
	radioCoverNoiseStrength: "0.5",
};

const MIX_FIELDS: { key: string; label: string; hint: string }[] = [
	{
		key: "radioCoversPerAlbum",
		label: "Covers / album",
		hint: "Reimagined real songs",
	},
	{ key: "radioNewPerAlbum", label: "New / album", hint: "Brand-new tracks" },
	{
		key: "radioCoverOfCoverPerAlbum",
		label: "Cover-of-cover",
		hint: "Reinterpret our own covers",
	},
	{
		key: "radioRandomFill",
		label: "Random fill",
		hint: "Each gets a random type",
	},
];

const STATUS_CLASS: Record<RadioCoverSource["status"], string> = {
	pending: "border-amber-300/40 text-amber-200",
	used: "border-emerald-300/40 text-emerald-200",
	failed: "border-red-400/40 text-red-300",
};

function SourcesPage() {
	const data = useRadioSources();
	const addSource = useAddRadioSource();
	const deleteSource = useDeleteRadioSource();
	const settings = useSettings();
	const setSetting = useSetSetting();

	const [url, setUrl] = useState("");
	const [genreTag, setGenreTag] = useState("");
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	function readSetting(key: string): string {
		if (Object.hasOwn(draft, key)) return draft[key];
		return settings?.[key] ?? SOURCE_SETTING_DEFAULTS[key] ?? "";
	}

	function writeSetting(key: string, value: string) {
		setDraft((current) => ({ ...current, [key]: value }));
	}

	async function handleAdd() {
		if (!url.trim()) return;
		setAdding(true);
		try {
			await addSource({
				url: url.trim(),
				genreTag: genreTag.trim() || undefined,
			});
			setUrl("");
			setGenreTag("");
			toast.success("Source queued");
		} catch {
			// createMutation already surfaced the error toast
		} finally {
			setAdding(false);
		}
	}

	async function handleSaveSettings() {
		setSaving(true);
		try {
			for (const [key, value] of Object.entries(draft)) {
				await setSetting({ key, value });
				// Drop saved keys as we go so a mid-loop failure leaves only
				// the unsaved remainder in the draft.
				setDraft((current) => {
					const next = { ...current };
					delete next[key];
					return next;
				});
			}
			toast.success("Source settings saved");
		} catch {
			// createMutation already surfaced the error toast
		} finally {
			setSaving(false);
		}
	}

	const sources = data?.sources ?? [];
	const pendingCount = sources.filter((s) => s.status === "pending").length;
	const usedCount = sources.filter((s) => s.status === "used").length;
	const failedCount = sources.filter((s) => s.status === "failed").length;
	const nas = data?.nas;

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			<OpsPageHeader
				icon={HardDriveDownload}
				title="Cover Sources"
				subtitle="Seed reference audio for the cover-first radio"
			/>

			<main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Stat label="Queued URLs" value={pendingCount} tone="active" />
					<Stat label="Used" value={usedCount} tone="ready" />
					<Stat
						label="Failed"
						value={failedCount}
						tone={failedCount > 0 ? "warn" : "default"}
					/>
					<Stat
						label="NAS files"
						value={
							nas?.configured
								? nas.error
									? "scan error"
									: nas.exists
										? nas.fileCount
										: "missing dir"
								: "off"
						}
						tone={
							nas?.configured && (!nas.exists || nas.error) ? "warn" : "default"
						}
					/>
				</div>

				<section className="border border-white/10 bg-[#171a1b]">
					<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
						<Link2 className="mr-2 inline h-4 w-4 text-amber-300" />
						Seed a source URL
					</div>
					<div className="flex flex-wrap items-end gap-3 p-4">
						<div className="min-w-0 flex-1">
							<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
								YouTube / SoundCloud / Bandcamp URL
							</div>
							<Input
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="https://www.youtube.com/watch?v=..."
								className="rounded-none border-white/15 bg-black font-mono"
							/>
						</div>
						<div className="w-44">
							<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
								Genre tag (optional)
							</div>
							<Input
								value={genreTag}
								onChange={(e) => setGenreTag(e.target.value)}
								placeholder="synthwave"
								className="rounded-none border-white/15 bg-black font-mono"
							/>
						</div>
						<Button
							onClick={handleAdd}
							disabled={adding || !url.trim()}
							className="h-10 rounded-none bg-amber-300 px-5 font-mono font-black uppercase text-black hover:bg-amber-200"
						>
							{adding ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Plus className="mr-2 h-4 w-4" />
							)}
							Add
						</Button>
					</div>
					<p className="px-4 pb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-white/30">
						Queued URLs are claimed first when an album needs cover sources. A
						genre tag restricts the URL to albums in that genre.
					</p>
				</section>

				<section className="border border-white/10 bg-[#171a1b]">
					<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
						Source queue
					</div>
					{sources.length === 0 ? (
						<p className="p-4 font-mono text-sm text-white/35">
							No seeded sources yet. Covers will be acquired by online search
							and the NAS library.
						</p>
					) : (
						<div className="divide-y divide-white/10">
							{sources.map((source) => (
								<div
									key={source.id}
									className="flex flex-wrap items-center gap-3 px-4 py-3"
								>
									<span
										className={`border px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.2em] ${STATUS_CLASS[source.status]}`}
									>
										{source.status}
									</span>
									<span className="min-w-0 flex-1 truncate font-mono text-sm text-white/75">
										{source.url}
									</span>
									{source.genreTag ? (
										<span className="border border-white/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
											{source.genreTag}
										</span>
									) : null}
									<button
										type="button"
										onClick={() => void deleteSource({ id: source.id })}
										className="text-white/35 hover:text-red-300"
										aria-label="Delete source"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="border border-white/10 bg-[#171a1b]">
					<div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
						<div className="font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
							<FolderOpen className="mr-2 inline h-4 w-4 text-amber-300" />
							Album mix & acquisition
						</div>
						<Button
							onClick={handleSaveSettings}
							disabled={saving || Object.keys(draft).length === 0}
							className="h-9 rounded-none bg-emerald-300 px-4 font-mono text-xs font-black uppercase text-black hover:bg-emerald-200"
						>
							{saving ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Save className="mr-2 h-4 w-4" />
							)}
							Save
						</Button>
					</div>
					<div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
						{MIX_FIELDS.map((field) => (
							<div key={field.key} className="block">
								<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
									{field.label}
								</div>
								<Input
									type="number"
									min={0}
									max={12}
									value={readSetting(field.key)}
									onChange={(e) => writeSetting(field.key, e.target.value)}
									className="rounded-none border-white/15 bg-black font-mono"
								/>
								<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/25">
									{field.hint}
								</div>
							</div>
						))}
					</div>
					<div className="grid gap-4 border-t border-white/10 p-4 sm:grid-cols-3">
						<div className="block">
							<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
								Search ratio (0..1)
							</div>
							<Input
								type="number"
								min={0}
								max={1}
								step={0.05}
								value={readSetting("radioSearchRatio")}
								onChange={(e) =>
									writeSetting("radioSearchRatio", e.target.value)
								}
								className="rounded-none border-white/15 bg-black font-mono"
							/>
							<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/25">
								Share of covers from online search vs NAS
							</div>
						</div>
						<div className="block">
							<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
								Cover fidelity (0..1)
							</div>
							<Input
								type="number"
								min={0}
								max={1}
								step={0.05}
								value={readSetting("radioCoverNoiseStrength")}
								onChange={(e) =>
									writeSetting("radioCoverNoiseStrength", e.target.value)
								}
								className="rounded-none border-white/15 bg-black font-mono"
							/>
							<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/25">
								0 loose interpretation · 1 close to source
							</div>
						</div>
						<div className="block">
							<div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
								NAS library dir
							</div>
							<Input
								value={readSetting("radioSourceLibraryDir")}
								onChange={(e) =>
									writeSetting("radioSourceLibraryDir", e.target.value)
								}
								placeholder="/mnt/nas/music"
								className="rounded-none border-white/15 bg-black font-mono"
							/>
							<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/25">
								Server-side path · non-mp3 transcoded via ffmpeg
							</div>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
