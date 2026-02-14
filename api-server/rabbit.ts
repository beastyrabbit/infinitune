import amqplib from "amqplib"

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>
type AmqpChannel = Awaited<ReturnType<AmqpConnection["createChannel"]>>

const RABBITMQ_URL =
	process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672/infinitune"

const WORK_EXCHANGE = "infinitune.work"
const EVENTS_EXCHANGE = "infinitune.events"

const WORK_QUEUES = ["work.metadata", "work.audio", "work.retry"] as const

let connection: AmqpConnection | null = null
let channel: AmqpChannel | null = null
let connecting = false

async function connect(): Promise<AmqpChannel> {
	if (channel) return channel
	if (connecting) {
		// Wait for ongoing connection attempt
		while (connecting) {
			await new Promise((r) => setTimeout(r, 100))
		}
		if (channel) return channel
	}

	connecting = true
	try {
		console.log("[rabbit] Connecting to RabbitMQ...")
		const conn = await amqplib.connect(RABBITMQ_URL)
		connection = conn
		const ch = await conn.createChannel()
		channel = ch

		// Assert exchanges
		await ch.assertExchange(WORK_EXCHANGE, "direct", { durable: true })
		await ch.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true })

		// Assert work queues and bind them
		for (const queue of WORK_QUEUES) {
			await ch.assertQueue(queue, { durable: true })
			// Routing key is the part after "work." (e.g., "metadata", "audio", "retry")
			const routingKey = queue.replace("work.", "")
			await ch.bindQueue(queue, WORK_EXCHANGE, routingKey)
		}

		// Handle connection errors
		conn.on("error", (err: Error) => {
			console.error("[rabbit] Connection error:", err.message)
			channel = null
			connection = null
		})
		conn.on("close", () => {
			console.log(
				"[rabbit] Connection closed, will reconnect on next publish",
			)
			channel = null
			connection = null
		})

		console.log("[rabbit] Connected, exchanges and queues asserted")
		return ch
	} finally {
		connecting = false
	}
}

/**
 * Publish a message to the work exchange (direct routing).
 * Used to dispatch work items to the worker.
 */
export async function publishWork(
	routingKey: "metadata" | "audio" | "retry",
	payload: Record<string, unknown>,
) {
	try {
		const ch = await connect()
		ch.publish(
			WORK_EXCHANGE,
			routingKey,
			Buffer.from(JSON.stringify(payload)),
			{ persistent: true },
		)
	} catch (err) {
		console.error(`[rabbit] Failed to publish work.${routingKey}:`, err)
	}
}

/**
 * Publish an event to the events exchange (topic routing).
 * Used to notify browser and room server of data changes.
 */
export async function publishEvent(
	routingKey: string,
	payload: Record<string, unknown>,
) {
	try {
		const ch = await connect()
		ch.publish(
			EVENTS_EXCHANGE,
			routingKey,
			Buffer.from(JSON.stringify(payload)),
			{ persistent: false },
		)
	} catch (err) {
		console.error(`[rabbit] Failed to publish event ${routingKey}:`, err)
	}
}

/**
 * Get a channel for consuming (used by worker and room server).
 */
export async function getChannel(): Promise<AmqpChannel> {
	return connect()
}

/**
 * Graceful shutdown.
 */
export async function closeRabbit() {
	try {
		if (channel) await channel.close()
		if (connection) await connection.close()
	} catch {
		// Ignore close errors
	}
	channel = null
	connection = null
}

export { WORK_EXCHANGE, EVENTS_EXCHANGE, WORK_QUEUES }
export type { AmqpChannel, AmqpConnection }
