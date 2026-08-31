import type { WSContext } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit, removeAllListeners } from "../events/event-bus";
import { addClient, removeClient, startWsBridge } from "../events/ws-bridge";

describe("WebSocket event bridge", () => {
	const clients: WSContext[] = [];

	afterEach(() => {
		for (const client of clients) removeClient(client);
		clients.length = 0;
		removeAllListeners();
	});

	it("broadcasts only the routing key and omits private event data", async () => {
		const send = vi.fn();
		const client = { send } as unknown as WSContext;
		clients.push(client);
		addClient(client);
		startWsBridge();

		emit("song.created", {
			songId: "private-song-id",
			playlistId: "private-playlist-id",
			status: "pending",
		});

		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		const message = JSON.parse(String(send.mock.calls[0]?.[0])) as Record<
			string,
			unknown
		>;
		expect(message).toEqual({ routingKey: "songs.private-playlist-id" });
		expect(message).not.toHaveProperty("data");
		expect(JSON.stringify(message)).not.toContain("private-song-id");
	});
});
