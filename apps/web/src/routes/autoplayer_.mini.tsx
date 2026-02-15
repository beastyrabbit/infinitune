import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { MiniPlayer } from "@/components/mini-player/MiniPlayer";

const miniSearchSchema = z.object({
	room: z.string().optional(),
	role: z.enum(["player", "controller"]).optional(),
	pl: z.string().optional(),
	name: z.string().optional(),
	dn: z.string().optional(),
});

export const Route = createFileRoute("/autoplayer_/mini")({
	component: MiniPlayerPage,
	validateSearch: (search) => miniSearchSchema.parse(search),
});

function MiniPlayerPage() {
	const { room, role, pl, name, dn } = Route.useSearch();
	// Client-only: WebSocket + Audio APIs are browser-only, skip SSR entirely
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	if (!mounted) {
		return <div className="h-screen bg-black" />;
	}

	if (!room) {
		return (
			<div className="h-screen bg-black text-white flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-black uppercase mb-2">No Room</h1>
					<p className="text-white/50 text-sm">
						Add <code className="text-red-400">?room=your-room-id</code> to the
						URL
					</p>
					<a
						href="/rooms"
						className="mt-4 inline-block text-sm font-bold uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors"
					>
						Browse Rooms
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen">
			<MiniPlayer
				roomId={room}
				role={role ?? "player"}
				playlistKey={pl}
				roomName={name}
				deviceName={dn}
			/>
		</div>
	);
}
