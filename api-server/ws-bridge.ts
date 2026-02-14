import type { WSContext } from "hono/ws"
import { getChannel, EVENTS_EXCHANGE } from "./rabbit"

type WSClient = WSContext

const clients = new Set<WSClient>()

/**
 * Register a new browser WebSocket client.
 */
export function addClient(ws: WSClient) {
	clients.add(ws)
}

/**
 * Remove a disconnected browser WebSocket client.
 */
export function removeClient(ws: WSClient) {
	clients.delete(ws)
}

/**
 * Broadcast a message to all connected browser clients.
 */
function broadcast(message: string) {
	for (const client of clients) {
		try {
			client.send(message)
		} catch (err) {
			console.warn(
				"[ws-bridge] Failed to send to client, removing:",
				err instanceof Error ? err.message : err,
			)
			clients.delete(client)
		}
	}
}

/**
 * Start consuming from the events exchange and forwarding to browser WebSocket clients.
 * Creates a temporary exclusive queue that auto-deletes when the server disconnects.
 * Binds to all routing keys (#) — every event reaches every connected browser.
 * The browser-side provider filters by routingKey to invalidate only relevant queries.
 */
export async function startBridge() {
	try {
		const channel = await getChannel()

		// Create a temporary exclusive queue
		const { queue } = await channel.assertQueue("", {
			exclusive: true,
			autoDelete: true,
		})

		// Bind to all events
		await channel.bindQueue(queue, EVENTS_EXCHANGE, "#")

		// Consume and forward to browser clients
		await channel.consume(
			queue,
			(msg) => {
				if (!msg) return
				try {
					const routingKey = msg.fields.routingKey
					const payload = msg.content.toString()
					broadcast(
						JSON.stringify({ routingKey, data: JSON.parse(payload) }),
					)
				} catch (err) {
					console.error("[ws-bridge] Failed to process message:", err)
				}
				channel.ack(msg)
			},
			{ noAck: false },
		)

		console.log(
			"[ws-bridge] Listening for events, forwarding to browser clients",
		)
	} catch (err) {
		console.error("[ws-bridge] Failed to start bridge:", err)
		// Retry after a delay
		setTimeout(() => startBridge(), 5000)
	}
}

export function getClientCount(): number {
	return clients.size
}
