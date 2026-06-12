import type { Song } from "@infinitune/shared/types";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeft,
	Clock3,
	Disc3,
	FileText,
	Info,
	Music2,
	Radio,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	type RadioAlbum,
	type RadioAlbumTrack,
	useRadioLibrary,
} from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/library")({
	component: LibraryPage,
});

type LibraryTab = "albums" | "legacy";
type SelectedSong =
	| { kind: "album"; song: RadioAlbumTrack; album: RadioAlbum }
	| { kind: "legacy"; song: Song; album?: undefined };

function formatDate(value: number | null | undefined): string {
	if (!value) return "n/a";
	return new Date(value).toLocaleString();
}

function formatMs(value: number | null | undefined): string {
	if (!value) return "n/a";
	const seconds = Math.round(value / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

function formatDuration(value: number | null | undefined): string {
	if (!value) return "n/a";
	const minutes = Math.floor(value / 60);
	const seconds = Math.round(value % 60);
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function joinList(value: string[] | null | undefined): string {
	return value?.length ? value.join(", ") : "n/a";
}

function asText(value: unknown): string {
	if (value === null || value === undefined || value === "") return "n/a";
	if (Array.isArray(value)) return value.length ? value.join(", ") : "n/a";
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}

function AlbumCover({
	title,
	src,
	size = "default",
}: {
	title: string;
	src: string | null | undefined;
	size?: "default" | "large";
}) {
	return (
		<div
			className={`aspect-square overflow-hidden border border-white/15 bg-zinc-950 ${
				size === "large" ? "min-h-[260px]" : ""
			}`}
		>
			{src ? (
				<img src={src} alt={title} className="h-full w-full object-cover" />
			) : (
				<div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#151515,#20342f_45%,#d7b46a_45%,#d7b46a_48%,#101213_48%)]">
					<Disc3
						className={
							size === "large"
								? "h-20 w-20 text-white/65"
								: "h-14 w-14 text-white/65"
						}
					/>
				</div>
			)}
		</div>
	);
}

function StatLine({ label, value }: { label: string; value: unknown }) {
	return (
		<div className="border-b border-white/10 py-2 last:border-b-0">
			<div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
				{label}
			</div>
			<div className="mt-1 break-words text-sm font-semibold text-white/85">
				{asText(value)}
			</div>
		</div>
	);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
	if (!value) return null;
	return (
		<section className="border border-white/10 bg-black/25 p-4">
			<h3 className="mb-3 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/70">
				<FileText className="h-4 w-4 text-amber-300" />
				{label}
			</h3>
			<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-white/65">
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		</section>
	);
}

function songCover(song: RadioAlbumTrack | Song, album?: RadioAlbum) {
	return (
		song.cover?.webpUrl ||
		song.cover?.pngUrl ||
		album?.cover?.webpUrl ||
		album?.cover?.pngUrl ||
		null
	);
}

function SongDetailDialog({
	selected,
	onOpenChange,
}: {
	selected: SelectedSong | null;
	onOpenChange: (open: boolean) => void;
}) {
	const song = selected?.song;
	const album = selected?.album;
	const title = song?.title ?? "Untitled";
	const artist = song?.artistName ?? album?.bandName ?? "Unknown";
	const audioUrl = song?.audioUrl ?? null;

	return (
		<Dialog open={Boolean(selected)} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[92vh] overflow-hidden rounded-none border-white/15 bg-[#101213] p-0 text-stone-100 sm:max-w-5xl">
				{song ? (
					<div className="grid max-h-[92vh] overflow-hidden md:grid-cols-[320px_1fr]">
						<aside className="border-b border-white/10 bg-black p-4 md:border-r md:border-b-0">
							<AlbumCover title={title} src={songCover(song, album)} />
							<div className="mt-4 space-y-2">
								<div className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
									{selected.kind === "album"
										? "Radio Album Track"
										: "Old Library Track"}
								</div>
								<h2 className="text-2xl font-black uppercase leading-tight text-white">
									{title}
								</h2>
								<p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-white/45">
									{artist}
								</p>
								{audioUrl ? (
									<a
										href={audioUrl}
										target="_blank"
										rel="noreferrer"
										className="mt-3 inline-flex h-9 items-center border border-white/15 px-3 font-mono text-xs font-black uppercase tracking-[0.14em] text-white/65 hover:bg-white hover:text-black"
									>
										Open audio
									</a>
								) : null}
							</div>
						</aside>
						<div className="overflow-auto p-5">
							<DialogHeader>
								<DialogTitle className="font-mono text-sm font-black uppercase tracking-[0.2em] text-white">
									Song Details
								</DialogTitle>
								<DialogDescription className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
									{song.id}
								</DialogDescription>
							</DialogHeader>

							<div className="mt-5 grid gap-4 lg:grid-cols-3">
								<section className="border border-white/10 bg-black/20 p-4">
									<h3 className="mb-2 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/65">
										<Info className="h-4 w-4 text-emerald-300" />
										Identity
									</h3>
									<StatLine label="Album" value={album?.title ?? "legacy"} />
									<StatLine label="Track" value={song.albumTrackNumber} />
									<StatLine label="Status" value={song.status} />
									<StatLine label="Genre" value={song.genre} />
									<StatLine label="Subgenre" value={song.subGenre} />
									<StatLine label="Vocal" value={song.vocalStyle} />
									<StatLine label="Mood" value={song.mood} />
									<StatLine label="Energy" value={song.energy} />
								</section>

								<section className="border border-white/10 bg-black/20 p-4">
									<h3 className="mb-2 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/65">
										<Clock3 className="h-4 w-4 text-sky-300" />
										Timing
									</h3>
									<StatLine
										label="Duration"
										value={formatDuration(song.audioDuration)}
									/>
									<StatLine label="BPM" value={song.bpm} />
									<StatLine label="Key" value={song.keyScale} />
									<StatLine label="Signature" value={song.timeSignature} />
									<StatLine
										label="Created"
										value={formatDate(song.createdAt)}
									/>
									<StatLine
										label="Started"
										value={formatDate(song.generationStartedAt)}
									/>
									<StatLine
										label="Completed"
										value={formatDate(song.generationCompletedAt)}
									/>
									<StatLine
										label="Audio Time"
										value={formatMs(song.audioProcessingMs)}
									/>
								</section>

								<section className="border border-white/10 bg-black/20 p-4">
									<h3 className="mb-2 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/65">
										<Radio className="h-4 w-4 text-red-300" />
										System
									</h3>
									<StatLine label="ACE Task" value={song.aceTaskId} />
									<StatLine
										label="ACE Submitted"
										value={formatDate(song.aceSubmittedAt)}
									/>
									<StatLine
										label="LLM"
										value={`${song.llmProvider ?? "n/a"} / ${song.llmModel ?? "n/a"}`}
									/>
									<StatLine label="Retries" value={song.retryCount} />
									<StatLine label="Error" value={song.errorMessage} />
									<StatLine label="Likes" value={song.likeCount} />
									<StatLine label="Dislikes" value={song.dislikeCount} />
									<StatLine label="Skips" value={song.skipCount} />
									<StatLine label="Radio Plays" value={song.radioPlayCount} />
								</section>
							</div>

							<div className="mt-4 grid gap-4 lg:grid-cols-2">
								<JsonBlock label="Caption" value={song.caption} />
								<JsonBlock label="Lyrics" value={song.lyrics} />
								<JsonBlock label="Description" value={song.description} />
								<JsonBlock label="Cover Prompt" value={song.coverPrompt} />
								<JsonBlock
									label="Instruments"
									value={joinList(song.instruments)}
								/>
								<JsonBlock label="Tags" value={joinList(song.tags)} />
								<JsonBlock label="Themes" value={joinList(song.themes)} />
								<JsonBlock
									label="Persona Extract"
									value={song.personaExtract}
								/>
								<JsonBlock label="Storage Path" value={song.storagePath} />
								<JsonBlock label="ACE Audio Path" value={song.aceAudioPath} />
							</div>
						</div>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function TrackRow({
	track,
	onClick,
}: {
	track: RadioAlbumTrack;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className="grid w-full grid-cols-[2rem_1fr_auto] items-center gap-2 border-b border-white/10 px-2 py-1.5 text-left last:border-b-0 hover:bg-white/5"
		>
			<span className="font-mono text-[10px] text-white/30">
				{track.albumTrackNumber}
			</span>
			<span className="truncate text-xs font-bold uppercase text-white/80">
				{track.title ?? "Untitled"}
			</span>
			<span className="font-mono text-[10px] uppercase text-white/35">
				{track.status}
			</span>
		</button>
	);
}

function AlbumPage({
	album,
	onBack,
	onSong,
}: {
	album: RadioAlbum;
	onBack: () => void;
	onSong: (song: RadioAlbumTrack) => void;
}) {
	return (
		<div className="space-y-5">
			<button
				type="button"
				onClick={onBack}
				className="inline-flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/50 hover:text-white"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to library
			</button>

			<section className="grid gap-5 lg:grid-cols-[360px_1fr]">
				<div className="mx-auto w-full max-w-[360px] lg:max-w-none">
					<AlbumCover
						title={album.title}
						src={album.cover?.webpUrl || album.cover?.pngUrl}
						size="large"
					/>
				</div>
				<div className="min-w-0">
					<div className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
						{album.generationKind} / {album.status}
					</div>
					<h2 className="mt-2 text-4xl font-black uppercase leading-none text-white">
						{album.title}
					</h2>
					<p className="mt-2 font-mono text-sm font-bold uppercase tracking-[0.2em] text-white/45">
						{album.bandName}
					</p>

					<div className="mt-5 grid gap-3 md:grid-cols-3">
						<StatLine label="Theme" value={album.theme} />
						<StatLine label="Tracks" value={album.tracks.length} />
						<StatLine label="Created" value={formatDate(album.createdAt)} />
						<StatLine
							label="First Played"
							value={formatDate(album.firstPlayedAt)}
						/>
						<StatLine label="Ready" value={formatDate(album.readyAt)} />
						<StatLine label="Completed" value={formatDate(album.completedAt)} />
						<StatLine label="Request" value={album.requestId} />
						<StatLine label="Cover" value={album.coverPrompt} />
					</div>
				</div>
			</section>

			<section className="border border-white/10 bg-[#171a1b]">
				<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.18em] text-white/55">
					Tracks
				</div>
				<div className="divide-y divide-white/10">
					{album.tracks.map((track) => (
						<button
							key={track.id}
							type="button"
							onClick={() => onSong(track)}
							className="grid w-full gap-3 px-4 py-3 text-left hover:bg-white/5 md:grid-cols-[2rem_1.4fr_1fr_1fr_auto]"
						>
							<span className="font-mono text-xs text-white/35">
								{track.albumTrackNumber}
							</span>
							<span className="min-w-0 truncate text-sm font-black uppercase text-white">
								{track.title ?? "Untitled"}
							</span>
							<span className="min-w-0 truncate font-mono text-xs uppercase tracking-wider text-white/45">
								{track.genre ?? "n/a"}
							</span>
							<span className="min-w-0 truncate font-mono text-xs uppercase tracking-wider text-white/45">
								{track.vocalStyle ?? "n/a"}
							</span>
							<span className="font-mono text-xs uppercase text-white/35">
								{track.status}
							</span>
						</button>
					))}
				</div>
			</section>

			<div className="grid gap-4 lg:grid-cols-2">
				<JsonBlock label="Band Persona" value={album.bandPersona} />
				<JsonBlock label="Trend Research" value={album.trendResearch} />
				<JsonBlock label="Vocal Plan" value={album.vocalPlan} />
			</div>
		</div>
	);
}

function LibraryPage() {
	const library = useRadioLibrary();
	const search = useRouterState({
		select: (state) => state.location.search as Record<string, unknown>,
	});
	const navigate = Route.useNavigate();
	const tab: LibraryTab = search.tab === "legacy" ? "legacy" : "albums";
	const [selectedSong, setSelectedSong] = useState<SelectedSong | null>(null);
	const selectedAlbum = useMemo(
		() =>
			library?.albums.find(
				(album) =>
					album.id === (typeof search.album === "string" ? search.album : ""),
			),
		[library?.albums, search.album],
	);

	function setTab(tabId: LibraryTab) {
		void navigate({ search: { tab: tabId, album: undefined } });
	}

	function openAlbum(albumId: string) {
		void navigate({ search: { tab: "albums", album: albumId } });
	}

	function closeAlbum() {
		void navigate({ search: { tab: "albums", album: undefined } });
	}

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			<header className="border-b border-white/10 bg-black/70 px-4 py-4">
				<div className="mx-auto flex max-w-7xl items-center gap-4">
					<Link to="/autoplayer" className="text-white/55 hover:text-white">
						<ArrowLeft className="h-5 w-5" />
					</Link>
					<div>
						<h1 className="font-mono text-2xl font-black uppercase tracking-[0.18em]">
							Radio Library
						</h1>
						<p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-white/35">
							{library?.albums.length ?? 0} albums /{" "}
							{library?.legacySongs.length ?? 0} legacy tracks
						</p>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-7xl px-4 py-6">
				{selectedAlbum ? (
					<AlbumPage
						album={selectedAlbum}
						onBack={closeAlbum}
						onSong={(song) =>
							setSelectedSong({ kind: "album", song, album: selectedAlbum })
						}
					/>
				) : (
					<>
						<div className="mb-5 flex gap-2 font-mono text-xs font-black uppercase tracking-widest">
							<button
								type="button"
								onClick={() => setTab("albums")}
								className={`border px-4 py-2 ${tab === "albums" ? "border-emerald-300 bg-emerald-300 text-black" : "border-white/15 text-white/55"}`}
							>
								Albums
							</button>
							<button
								type="button"
								onClick={() => setTab("legacy")}
								className={`border px-4 py-2 ${tab === "legacy" ? "border-amber-300 bg-amber-300 text-black" : "border-white/15 text-white/55"}`}
							>
								Old Library
							</button>
						</div>

						{tab === "albums" ? (
							<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
								{library?.albums.map((album) => (
									<article
										key={album.id}
										className="grid grid-cols-[132px_1fr] gap-4 border border-white/10 bg-[#171a1b] p-3"
									>
										<button type="button" onClick={() => openAlbum(album.id)}>
											<AlbumCover
												title={album.title}
												src={album.cover?.webpUrl || album.cover?.pngUrl}
											/>
										</button>
										<div className="min-w-0">
											<button
												type="button"
												onClick={() => openAlbum(album.id)}
												className="mb-2 block w-full text-left"
											>
												<h2 className="truncate text-lg font-black uppercase text-white">
													{album.title}
												</h2>
												<p className="truncate font-mono text-[10px] uppercase tracking-widest text-white/35">
													{album.bandName} / {album.generationKind} /{" "}
													{album.status}
												</p>
											</button>
											<div className="max-h-56 overflow-auto border border-white/10">
												{album.tracks.map((track) => (
													<TrackRow
														key={track.id}
														track={track}
														onClick={() =>
															setSelectedSong({
																kind: "album",
																song: track,
																album,
															})
														}
													/>
												))}
											</div>
										</div>
									</article>
								))}
								{!library?.albums.length && (
									<div className="border border-white/10 bg-black/30 p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
										No radio albums yet
									</div>
								)}
							</div>
						) : (
							<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
								{library?.legacySongs.map((song) => (
									<button
										key={song.id}
										type="button"
										onClick={() => setSelectedSong({ kind: "legacy", song })}
										className="flex items-center gap-3 border border-white/10 bg-[#171a1b] p-3 text-left hover:bg-white/5"
									>
										<div className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/10 bg-black">
											<Music2 className="h-4 w-4 text-white/45" />
										</div>
										<div className="min-w-0">
											<div className="truncate text-sm font-bold uppercase text-white/85">
												{song.title ?? "Untitled"}
											</div>
											<div className="truncate font-mono text-[10px] uppercase tracking-widest text-white/35">
												{song.artistName ?? "Unknown"} / {song.status}
											</div>
										</div>
									</button>
								))}
								{!library?.legacySongs.length && (
									<div className="border border-white/10 bg-black/30 p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
										No legacy tracks
									</div>
								)}
							</div>
						)}
					</>
				)}
			</main>
			<SongDetailDialog
				selected={selectedSong}
				onOpenChange={(open) => {
					if (!open) setSelectedSong(null);
				}}
			/>
		</div>
	);
}
