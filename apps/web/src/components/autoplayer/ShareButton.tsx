import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/integrations/api/client";
import {
	findReusablePermanentShareLink,
	type ShareLinkResponse,
} from "@/lib/share-links";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
	resourceType: "playlist" | "song";
	resourceId: string;
	className?: string;
	label?: string;
}

export function buildShareUrl(token: string): string {
	return `${window.location.origin}/share/${token}`;
}

const PERMANENT_SHARE_NOTICE =
	"Permanent links keep temporary music permanently, even after revocation.";

/**
 * Creates a share link for a resource and copies the public URL.
 */
export function ShareButton({
	resourceType,
	resourceId,
	className = "",
	label,
}: ShareButtonProps) {
	const [busy, setBusy] = useState(false);

	const handleShare = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const query = new URLSearchParams({ resourceType, resourceId });
			const existing = await api.get<{ links: ShareLinkResponse[] }>(
				`/api/share?${query}`,
			);
			const link =
				findReusablePermanentShareLink(existing.links) ??
				(await api.post<ShareLinkResponse>("/api/share", {
					resourceType,
					resourceId,
				}));
			const url = buildShareUrl(link.token);
			try {
				await navigator.clipboard.writeText(url);
				toast.success("Permanent share link copied", {
					description: `${url}\n${PERMANENT_SHARE_NOTICE}`,
				});
			} catch {
				toast.warning("Permanent share link ready — copy it manually", {
					description: `${url}\n${PERMANENT_SHARE_NOTICE}`,
					duration: 10_000,
				});
			}
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to create share link",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			type="button"
			onClick={handleShare}
			disabled={busy}
			title="Copy permanent share link. Temporary music will be kept permanently."
			aria-label={label ?? "Copy public share link"}
			className={cn(
				"flex h-8 w-8 items-center justify-center border-2 border-white/20 bg-white/5 text-white/50 transition-colors hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-50",
				className,
			)}
		>
			<Link2 className="h-3.5 w-3.5" />
		</button>
	);
}
