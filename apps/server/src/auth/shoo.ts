import { createRemoteJWKSet, jwtVerify } from "jose";

const SHOO_ISSUER = process.env.SHOO_ISSUER ?? "https://shoo.dev";
const SHOO_JWKS_URL =
	process.env.SHOO_JWKS_URL ?? `${SHOO_ISSUER}/.well-known/jwks.json`;

const fallbackOrigin =
	process.env.ALLOWED_ORIGINS?.split(",").map((v) => v.trim())[0] ||
	"http://localhost:5173";
const APP_ORIGIN = process.env.APP_ORIGIN ?? fallbackOrigin;

const JWKS = createRemoteJWKSet(new URL(SHOO_JWKS_URL));

export interface ShooIdentity {
	userId: string;
	email?: string;
	name?: string;
	picture?: string;
}

export function getShooAudienceOrigin(): string {
	return new URL(APP_ORIGIN).origin;
}

export function getShooAudience(): string {
	return `origin:${getShooAudienceOrigin()}`;
}

export async function verifyShooIdToken(
	idToken: string,
): Promise<ShooIdentity> {
	const { payload } = await jwtVerify(idToken, JWKS, {
		issuer: SHOO_ISSUER,
		audience: getShooAudience(),
	});

	const pairwiseSub = payload.pairwise_sub;
	if (typeof pairwiseSub !== "string" || pairwiseSub.length === 0) {
		throw new Error("Missing pairwise_sub claim");
	}

	return {
		userId: pairwiseSub,
		email: typeof payload.email === "string" ? payload.email : undefined,
		name: typeof payload.name === "string" ? payload.name : undefined,
		picture: typeof payload.picture === "string" ? payload.picture : undefined,
	};
}

export function parseBearerToken(
	authorizationHeader: string | null | undefined,
): string | null {
	if (!authorizationHeader) return null;
	const trimmed = authorizationHeader.trim();
	if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
	const token = trimmed.slice(7).trim();
	return token.length > 0 ? token : null;
}
