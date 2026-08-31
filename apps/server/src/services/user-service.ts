import { eq } from "drizzle-orm";
import type { ShooIdentity } from "../auth/shoo";
import { db } from "../db/index";
import type { User } from "../db/schema";
import { users } from "../db/schema";

export interface UserIdentity {
	subject: string;
	email?: string;
	name?: string;
	picture?: string;
}

export async function getById(id: string): Promise<User | null> {
	const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return row ?? null;
}

export async function getByShooSubject(
	shooSubject: string,
): Promise<User | null> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.shooSubject, shooSubject))
		.limit(1);
	return row ?? null;
}

export async function upsertFromIdentity(
	identity: UserIdentity,
): Promise<User> {
	const now = Date.now();
	const [row] = await db
		.insert(users)
		.values({
			shooSubject: identity.subject,
			displayName: identity.name ?? null,
			email: identity.email ?? null,
			picture: identity.picture ?? null,
			lastSeenAt: now,
		})
		.onConflictDoUpdate({
			target: users.shooSubject,
			set: {
				displayName: identity.name ?? null,
				email: identity.email ?? null,
				picture: identity.picture ?? null,
				lastSeenAt: now,
			},
		})
		.returning();

	return row;
}

export async function upsertFromShoo(identity: ShooIdentity): Promise<User> {
	return upsertFromIdentity({
		subject: identity.userId,
		email: identity.email,
		name: identity.name,
		picture: identity.picture,
	});
}
