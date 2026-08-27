import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/integrations/api/client";
import { cn } from "@/lib/utils";

interface ShareLinkResponse {
	token: string;
	expiresAt: number | null;
}

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

function shareLinkNotice(expiresAt: number | null): string {
	return expiresAt === null
		? PERMANENT_SHARE_NOTICE
		: `This link expires ${new Date(expiresAt).toLocaleString()}.`;
}

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
			const link = await api.post<ShareLinkResponse>("/api/share", {
				resourceType,
				resourceId,
			});
			const url = buildShareUrl(link.token);
			const linkKind = link.expiresAt === null ? "Permanent" : "Timed";
			const description = `${url}\n${shareLinkNotice(link.expiresAt)}`;
			try {
				await navigator.clipboard.writeText(url);
				toast.success(`${linkKind} share link copied`, {
					description,
				});
			} catch {
				toast.warning(`${linkKind} share link ready. Copy it manually.`, {
					description,
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
			title="Copy public share link"
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
