export interface ShareLinkResponse {
	id: string;
	token: string;
	expiresAt: number | null;
	revokedAt: number | null;
}

export function findReusablePermanentShareLink(
	links: ShareLinkResponse[],
): ShareLinkResponse | undefined {
	return links.find((item) => !item.revokedAt && item.expiresAt === null);
}
