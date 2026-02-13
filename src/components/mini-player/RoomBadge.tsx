import { Monitor, Wifi } from "lucide-react";
import type { Device } from "../../../room-server/protocol";

interface RoomBadgeProps {
	roomName: string;
	devices: Device[];
	connected: boolean;
}

export function RoomBadge({ roomName, devices, connected }: RoomBadgeProps) {
	const playerCount = devices.filter((d) => d.role === "player").length;
	const controllerCount = devices.filter((d) => d.role === "controller").length;

	return (
		<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
			<span
				className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
			/>
			<span className="text-white/60">{roomName}</span>
			<span className="text-white/30">|</span>
			<span className="flex items-center gap-1 text-white/50">
				<Monitor size={10} />
				{playerCount}
			</span>
			<span className="flex items-center gap-1 text-white/50">
				<Wifi size={10} />
				{controllerCount}
			</span>
		</div>
	);
}
