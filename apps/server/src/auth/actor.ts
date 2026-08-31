import type { Context } from "hono";
import * as userService from "../services/user-service";
import { parseBearerToken, verifyShooIdToken } from "./shoo";

const PANGOLIN_USER_ID_HEADER = "Remote-User-Id";
const PANGOLIN_EMAIL_HEADER = "Remote-Email";
const PANGOLIN_NAME_HEADER = "Remote-Name";
const MAX_PANGOLIN_USER_ID_LENGTH = 255;
const MAX_PANGOLIN_EMAIL_LENGTH = 320;
const MAX_PANGOLIN_NAME_LENGTH = 255;
const PANGOLIN_USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

export type AnonymousActor = {
	kind: "anonymous";
};

export type UserActor = {
	kind: "user";
	userId: string;
	email?: string;
	name?: string;
	picture?: string;
};

export type RequestActor = AnonymousActor | UserActor;

async function resolveShooActor(token: string): Promise<UserActor> {
	const identity = await verifyShooIdToken(token);
	const user = await userService.upsertFromShoo(identity);

	return {
		kind: "user",
		userId: user.id,
		email: user.email ?? undefined,
		name: user.displayName ?? undefined,
		picture: user.picture ?? undefined,
	};
}

function readPangolinUserId(c: Context): string | null {
	const value = c.req.header(PANGOLIN_USER_ID_HEADER);
	if (
		!value ||
		value.length > MAX_PANGOLIN_USER_ID_LENGTH ||
		!PANGOLIN_USER_ID_PATTERN.test(value)
	) {
		return null;
	}
	return value;
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
			return true;
		}
	}
	return false;
}

function readOptionalPangolinMetadata(
	c: Context,
	headerName: string,
	maxLength: number,
): string | undefined {
	const rawValue = c.req.header(headerName);
	if (
		!rawValue ||
		rawValue.length > maxLength ||
		containsControlCharacter(rawValue)
	) {
		return undefined;
	}
	const value = rawValue.trim();
	if (!value) return undefined;
	return value;
}

async function resolvePangolinActor(c: Context): Promise<UserActor | null> {
	if (process.env.INFINITUNE_TRUST_PANGOLIN_HEADERS !== "true") {
		return null;
	}

	const userId = readPangolinUserId(c);
	if (!userId) return null;

	const user = await userService.upsertFromIdentity({
		subject: `pangolin:${userId}`,
		email: readOptionalPangolinMetadata(
			c,
			PANGOLIN_EMAIL_HEADER,
			MAX_PANGOLIN_EMAIL_LENGTH,
		),
		name: readOptionalPangolinMetadata(
			c,
			PANGOLIN_NAME_HEADER,
			MAX_PANGOLIN_NAME_LENGTH,
		),
	});

	return {
		kind: "user",
		userId: user.id,
		email: user.email ?? undefined,
		name: user.displayName ?? undefined,
		picture: user.picture ?? undefined,
	};
}

async function resolveUserActor(c: Context): Promise<UserActor | null> {
	const token = parseBearerToken(c.req.header("authorization"));
	if (token) return resolveShooActor(token);

	return resolvePangolinActor(c);
}

export async function getRequestActor(c: Context): Promise<RequestActor> {
	try {
		const userActor = await resolveUserActor(c);
		return userActor ?? { kind: "anonymous" };
	} catch {
		return { kind: "anonymous" };
	}
}

export async function requireUserActor(c: Context): Promise<UserActor | null> {
	try {
		return await resolveUserActor(c);
	} catch {
		return null;
	}
}
