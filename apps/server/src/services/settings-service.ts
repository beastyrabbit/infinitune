import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { settings } from "../db/schema";
import { emit } from "../events/event-bus";

export async function getAll(): Promise<Record<string, string>> {
	const rows = await db.select().from(settings);
	return Object.fromEntries(rows.map((s) => [s.key, s.value]));
}

export async function get(key: string): Promise<string | null> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key));
	return row?.value ?? null;
}

export async function set(key: string, value: string) {
	await db.insert(settings).values({ key, value }).onConflictDoUpdate({
		target: settings.key,
		set: { value },
	});

	emit("settings.changed", { key });
}
