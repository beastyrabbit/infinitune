import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared "broadcast console" page header for the radio operations and
 * settings routes: amber accent rail, scanline texture, status readout.
 */
export function OpsPageHeader({
	icon: Icon,
	title,
	subtitle,
	maxWidthClass = "max-w-7xl",
	right,
}: {
	icon: LucideIcon;
	title: string;
	subtitle: string;
	maxWidthClass?: string;
	right?: ReactNode;
}) {
	return (
		<header className="relative border-b border-white/10 bg-black/70">
			<div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-300/80 via-amber-300/20 to-transparent" />
			<div
				className="pointer-events-none absolute inset-0 opacity-[0.04]"
				style={{
					backgroundImage:
						"repeating-linear-gradient(0deg, transparent 0 2px, #fff 2px 3px)",
				}}
			/>
			<div
				className={`relative mx-auto flex ${maxWidthClass} items-center gap-4 px-4 py-4`}
			>
				<Link to="/autoplayer" className="text-white/55 hover:text-white">
					<ArrowLeft className="h-5 w-5" />
				</Link>
				<div className="min-w-0 flex-1">
					<h1 className="flex items-center gap-3 font-mono text-2xl font-black uppercase tracking-[0.18em] sm:text-3xl">
						<Icon className="h-6 w-6 shrink-0 text-amber-300" />
						<span className="truncate">{title}</span>
					</h1>
					<p className="mt-1 font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/35">
						{subtitle}
					</p>
				</div>
				{right ? <div className="shrink-0">{right}</div> : null}
			</div>
		</header>
	);
}
