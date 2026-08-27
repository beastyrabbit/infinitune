import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { Disc3, Radio } from "lucide-react";
import { useState } from "react";
import { API_FETCH_URL, resolveApiMediaUrl } from "@/lib/endpoints";
import { formatTime } from "@/lib/format-time";
import {
	buildApiForwardedFor,
	type ShareLoadError,
	shareLoadErrorForStatus,
} from "@/lib/share-loader";

interface PublicSong {
	id: string;
	title: string | null;
	artistName: string | null;
	genre: string | null;
	audioDuration: number | null;
	audioUrl: string | null;
	coverUrl: string | null;
}

interface SharePayload {
	resourceType: "playlist" | "song";
	payload: {
		name?: string;
		description?: string | null;
		songs?: PublicSong[];
		song?: PublicSong;
	};
}

const loadShare = createServerFn({ method: "GET" })
	.inputValidator((token: string) => token)
	.handler(
		async ({
			data: token,
		}): Promise<{
			data: SharePayload | null;
			error: ShareLoadError | null;
		}> => {
			try {
				const forwardedFor = buildApiForwardedFor(
					getRequestHeader("x-forwarded-for"),
					getRequestIP(),
				);
				const response = await fetch(
					`${API_FETCH_URL}/api/share/${encodeURIComponent(token)}`,
					{ headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} },
				);
				if (!response.ok) {
					return {
						data: null,
						error: shareLoadErrorForStatus(response.status),
					};
				}
				return { data: (await response.json()) as SharePayload, error: null };
			} catch {
				return { data: null, error: shareLoadErrorForStatus(503) };
			}
		},
	);

export const Route = createFileRoute("/share_/$token")({
	loader: ({ params }) => loadShare({ data: params.token }),
	head: ({ loaderData }) => {
		const title =
			loaderData?.data?.payload.name ??
			loaderData?.data?.payload.song?.title ??
			"Shared music";
		const pageTitle = `${title} | Infinitune`;
		const description = "Listen to music shared from Infinitune.";
		return {
			meta: [
				{ title: pageTitle },
				{ name: "description", content: description },
				{ property: "og:title", content: pageTitle },
				{ property: "og:description", content: description },
				{ property: "og:type", content: "music.playlist" },
			],
		};
	},
	pendingComponent: ShareLoading,
	component: SharePage,
});

function ShareLoading() {
	return (
		<div className="font-mono flex min-h-screen items-center justify-center bg-gray-950 text-xs uppercase tracking-widest text-white/40">
			Loading shared music...
		</div>
	);
}

function SharePage() {
	const { data, error } = Route.useLoaderData();
	const [current, setCurrent] = useState<PublicSong | null>(null);

	const songs =
		data?.payload.songs ?? (data?.payload.song ? [data.payload.song] : []);
	const selectedSong =
		songs.find((song) => song.id === current?.id) ?? songs[0] ?? null;

	if (error) {
		return (
			<div className="font-mono flex min-h-screen items-center justify-center bg-gray-950 text-white">
				<div className="text-center">
					<p className="text-4xl font-black">{error.status}</p>
					<p className="mt-2 text-sm uppercase tracking-widest text-white/40">
						{error.message}
					</p>
					<a
						href="/autoplayer"
						className="mt-6 inline-block border-2 border-white/20 px-4 py-2 text-xs font-black uppercase transition-colors hover:bg-white hover:text-black"
					>
						GO TO PLAYER
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			<header className="border-b border-white/10 bg-black/70">
				<div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
					<div className="flex h-10 w-10 items-center justify-center border border-emerald-400/40 bg-emerald-400/10">
						{data?.resourceType === "playlist" ? (
							<Disc3 className="h-5 w-5 text-emerald-300" />
						) : (
							<Radio className="h-5 w-5 text-emerald-300" />
						)}
					</div>
					<div className="min-w-0">
						<h1 className="truncate font-mono text-xl font-black uppercase tracking-[0.18em]">
							{data?.payload.name ?? data?.payload.song?.title ?? "Shared"}
						</h1>
						<p className="font-mono text-xs uppercase tracking-[0.22em] text-white/40">
							Shared from Infinitune
						</p>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-3xl px-4 py-6">
				{data?.payload.description && (
					<p className="mb-4 text-sm text-white/60">
						{data.payload.description}
					</p>
				)}

				{/* biome-ignore lint/a11y/useMediaCaption: generated music has no caption track */}
				<audio
					className="mb-6 w-full"
					controls
					preload="none"
					src={resolveApiMediaUrl(selectedSong?.audioUrl) ?? undefined}
				/>

				<ul className="space-y-2">
					{songs.map((song) => (
						<li key={song.id}>
							<button
								type="button"
								onClick={() => setCurrent(song)}
								disabled={!song.audioUrl}
								className={`flex w-full items-center gap-3 border px-3 py-2 text-left transition-colors ${
									selectedSong?.id === song.id
										? "border-emerald-400/60 bg-emerald-400/10"
										: "border-white/10 bg-white/[0.03] hover:border-white/30"
								} ${!song.audioUrl ? "opacity-50" : ""}`}
							>
								{song.coverUrl ? (
									<img
										src={resolveApiMediaUrl(song.coverUrl) ?? undefined}
										alt=""
										className="h-12 w-12 object-cover"
									/>
								) : (
									<div className="flex h-12 w-12 items-center justify-center bg-black/40">
										<Disc3 className="h-5 w-5 text-white/30" />
									</div>
								)}
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-sm font-bold uppercase">
										{song.title ?? "Untitled"}
									</p>
									<p className="truncate font-mono text-xs text-white/45">
										{[song.artistName, song.genre].filter(Boolean).join(" · ")}
									</p>
								</div>
								<span className="font-mono text-xs text-white/35">
									{formatTime(song.audioDuration ?? 0)}
								</span>
							</button>
						</li>
					))}
				</ul>

				{data && songs.length === 0 && (
					<p className="py-8 text-center font-mono text-sm uppercase tracking-widest text-white/35">
						Nothing shared yet
					</p>
				)}

				<footer className="mt-10 border-t border-white/10 pt-4 pb-8 text-center">
					<a
						href="/autoplayer"
						className="font-mono text-xs uppercase tracking-widest text-emerald-300/70 hover:text-emerald-300"
					>
						Powered by Infinitune — listen live
					</a>
				</footer>
			</main>
		</div>
	);
}
