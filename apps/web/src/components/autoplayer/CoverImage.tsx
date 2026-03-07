import type { SongCover } from "@/types";

interface CoverImageProps {
	cover?: SongCover | null;
	alt: string;
	className?: string;
}

export function CoverImage({ cover, alt, className }: CoverImageProps) {
	if (!cover?.pngUrl && !cover?.webpUrl && !cover?.jxlUrl) return null;

	const fallbackSrc =
		cover.pngUrl ?? cover.webpUrl ?? cover.jxlUrl ?? undefined;
	if (!fallbackSrc) return null;

	return (
		<picture>
			{cover.jxlUrl ? <source srcSet={cover.jxlUrl} type="image/jxl" /> : null}
			{cover.webpUrl ? (
				<source srcSet={cover.webpUrl} type="image/webp" />
			) : null}
			<img src={fallbackSrc} alt={alt} className={className} />
		</picture>
	);
}
