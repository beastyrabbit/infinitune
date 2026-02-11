import {
	getCoverColors,
	getCoverPattern,
	getInitials,
	getPatternStyle,
} from "@/lib/cover-utils";

interface CoverArtProps {
	title: string;
	artistName: string;
	coverUrl?: string | null;
	size?: "sm" | "md" | "lg";
	fill?: boolean;
	/** Spin the disc (used in NowPlaying when playing) */
	spinning?: boolean;
}

export function CoverArt({
	title,
	artistName,
	coverUrl,
	size = "md",
	fill,
	spinning = false,
}: CoverArtProps) {
	const textSize =
		size === "lg" ? "text-8xl" : size === "md" ? "text-5xl" : "text-3xl";
	const sizeClass = fill ? "w-full h-full" : "w-full aspect-square";
	const spinClass = spinning ? "animate-[spin_8s_linear_infinite]" : "";

	if (coverUrl) {
		return (
			<div
				className={`${sizeClass} relative overflow-hidden flex items-center justify-center bg-black`}
			>
				<div
					className={`w-[85%] aspect-square rounded-full overflow-hidden relative shadow-[0_0_60px_rgba(0,0,0,0.8)] ${spinClass}`}
				>
					<img
						src={coverUrl}
						alt={`${title} cover`}
						className="w-full h-full object-cover"
					/>
					{/* Disc grooves */}
					<div
						className="absolute inset-0 rounded-full opacity-10"
						style={{
							background:
								"repeating-radial-gradient(circle at center, transparent 0px, transparent 3px, rgba(255,255,255,0.1) 4px, transparent 5px)",
						}}
					/>
					{/* Disc sheen */}
					<div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/15 via-transparent to-white/5 pointer-events-none" />
				</div>
			</div>
		);
	}

	// Procedural fallback — disc with generated pattern
	const [bg, accent1] = getCoverColors(title, artistName);
	const pattern = getCoverPattern(title);
	const patternStyle = getPatternStyle(pattern);
	const initials = getInitials(title);

	return (
		<div
			className={`${sizeClass} relative overflow-hidden flex items-center justify-center bg-black`}
		>
			<div
				className={`w-[85%] aspect-square rounded-full overflow-hidden relative flex items-center justify-center shadow-[0_0_60px_rgba(0,0,0,0.8)] ${spinClass}`}
				style={{ backgroundColor: bg }}
			>
				<div className="absolute inset-0 rounded-full" style={patternStyle} />
				<div
					className="absolute inset-0 rounded-full opacity-20"
					style={{
						background: `linear-gradient(135deg, ${accent1} 0%, transparent 60%)`,
					}}
				/>
				<span
					className={`${textSize} font-black text-white relative z-10 select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]`}
				>
					{initials}
				</span>
				{/* Disc grooves */}
				<div
					className="absolute inset-0 rounded-full opacity-10"
					style={{
						background:
							"repeating-radial-gradient(circle at center, transparent 0px, transparent 3px, rgba(255,255,255,0.1) 4px, transparent 5px)",
					}}
				/>
				{/* Disc sheen */}
				<div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/15 via-transparent to-white/5 pointer-events-none" />
			</div>
		</div>
	);
}
