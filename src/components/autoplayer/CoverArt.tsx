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
}

export function CoverArt({
	title,
	artistName,
	coverUrl,
	size = "md",
	fill,
}: CoverArtProps) {
	const textSize =
		size === "lg" ? "text-8xl" : size === "md" ? "text-5xl" : "text-3xl";
	const sizeClass = fill ? "w-full h-full" : "w-full aspect-square";

	// If we have a real cover image, show it
	if (coverUrl) {
		return (
			<div
				className={`${sizeClass} border-4 border-white/20 relative overflow-hidden`}
			>
				<img
					src={coverUrl}
					alt={`${title} cover`}
					className="w-full h-full object-cover"
				/>
			</div>
		);
	}

	// Procedural fallback cover
	const [bg, accent1] = getCoverColors(title, artistName);
	const pattern = getCoverPattern(title);
	const patternStyle = getPatternStyle(pattern);
	const initials = getInitials(title);

	return (
		<div
			className={`${sizeClass} border-4 border-white/20 relative overflow-hidden flex items-center justify-center`}
			style={{ backgroundColor: bg }}
		>
			<div className="absolute inset-0" style={patternStyle} />
			<div
				className="absolute inset-0 opacity-20"
				style={{
					background: `linear-gradient(135deg, ${accent1} 0%, transparent 60%)`,
				}}
			/>
			<span
				className={`${textSize} font-black text-white relative z-10 select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]`}
			>
				{initials}
			</span>
		</div>
	);
}
