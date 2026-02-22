import type { Context } from "hono";
import * as userService from "../services/user-service";
import { parseBearerToken, verifyShooIdToken } from "./shoo";

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

async function resolveUserActor(c: Context): Promise<UserActor | null> {
	const token = parseBearerToken(c.req.header("authorization"));
	if (!token) return null;

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
