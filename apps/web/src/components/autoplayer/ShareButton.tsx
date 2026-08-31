import { Link2 } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
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
const DEFAULT_SHARE_EXPIRY_DAYS = 30;

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

	const handleShare = async (expiresInDays?: number) => {
		if (busy) return;
		setBusy(true);
		try {
			const link = await api.post<ShareLinkResponse>("/api/share", {
				resourceType,
				resourceId,
				...(expiresInDays ? { expiresInDays } : {}),
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
		<DropdownMenuPrimitive.Root>
			<DropdownMenuPrimitive.Trigger asChild>
				<button
					type="button"
					disabled={busy}
					title="Choose public share link lifetime"
					aria-label={label ?? "Choose public share link lifetime"}
					className={cn(
						"flex h-8 w-8 items-center justify-center border-2 border-white/20 bg-white/5 text-white/50 transition-colors hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-50",
						className,
					)}
				>
					<Link2 className="h-3.5 w-3.5" />
				</button>
			</DropdownMenuPrimitive.Trigger>
			<DropdownMenuPrimitive.Portal>
				<DropdownMenuPrimitive.Content
					align="end"
					side="top"
					sideOffset={8}
					className="z-50 w-64 border-2 border-white/20 bg-[#111415] p-1 font-mono text-left text-white shadow-xl"
				>
					<DropdownMenuPrimitive.Item
						onSelect={() => void handleShare(DEFAULT_SHARE_EXPIRY_DAYS)}
						className="cursor-pointer px-3 py-2 text-xs font-bold uppercase outline-none hover:bg-emerald-500 hover:text-black focus:bg-emerald-500 focus:text-black"
					>
						Share for 30 days
					</DropdownMenuPrimitive.Item>
					<DropdownMenuPrimitive.Item
						onSelect={() => void handleShare()}
						className="cursor-pointer px-3 py-2 text-xs font-bold uppercase outline-none hover:bg-yellow-500 hover:text-black focus:bg-yellow-500 focus:text-black"
					>
						<span className="block">
							<span className="block">Keep permanently</span>
							<span className="mt-1 block text-[10px] font-normal normal-case opacity-70">
								Temporary music will no longer be cleaned up.
							</span>
						</span>
					</DropdownMenuPrimitive.Item>
				</DropdownMenuPrimitive.Content>
			</DropdownMenuPrimitive.Portal>
		</DropdownMenuPrimitive.Root>
	);
}
