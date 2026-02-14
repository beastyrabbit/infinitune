import amqplib from "amqplib"

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>
type AmqpChannel = Awaited<ReturnType<AmqpConnection["createChannel"]>>

const RABBITMQ_URL =
	process.env.RABBITMQ_URL ?? "amqp://localhost:5672/infinitune"

export interface WorkMessage {
	songId: string
	playlistId: string
}

export interface WorkerRabbitHandlers {
	onMetadata: (msg: WorkMessage) => Promise<void>
	onAudio: (msg: WorkMessage) => Promise<void>
	onRetry: (msg: WorkMessage) => Promise<void>
}

let connection: AmqpConnection | null = null
let channel: AmqpChannel | null = null
let reconnecting = false

export async function connectWorkerRabbit(
	handlers: WorkerRabbitHandlers,
): Promise<void> {
	async function connect() {
		try {
			const conn = await amqplib.connect(RABBITMQ_URL)
			connection = conn

			conn.on("error", (err) => {
				console.error("[worker-rabbit] Connection error:", err.message)
			})
			conn.on("close", () => {
				console.warn("[worker-rabbit] Connection closed, reconnecting...")
				connection = null
				channel = null
				scheduleReconnect()
			})

			const ch = await conn.createChannel()
			channel = ch

			// Prefetch 1 — process one work item at a time per queue
			await ch.prefetch(1)

			// Assert the work exchange and queues (should already exist from API server)
			await ch.assertExchange("infinitune.work", "direct", { durable: true })
			await ch.assertQueue("work.metadata", { durable: true })
			await ch.assertQueue("work.audio", { durable: true })
			await ch.assertQueue("work.retry", { durable: true })
			await ch.bindQueue("work.metadata", "infinitune.work", "metadata")
			await ch.bindQueue("work.audio", "infinitune.work", "audio")
			await ch.bindQueue("work.retry", "infinitune.work", "retry")

			// Consume work.metadata
			await ch.consume("work.metadata", async (msg) => {
				if (!msg) return
				try {
					const data = JSON.parse(msg.content.toString()) as WorkMessage
					await handlers.onMetadata(data)
					ch.ack(msg)
				} catch (err) {
					console.error(
						"[worker-rabbit] Error processing metadata message:",
						err instanceof Error ? err.message : err,
					)
					// Requeue on failure
					ch.nack(msg, false, true)
				}
			})

			// Consume work.audio
			await ch.consume("work.audio", async (msg) => {
				if (!msg) return
				try {
					const data = JSON.parse(msg.content.toString()) as WorkMessage
					await handlers.onAudio(data)
					ch.ack(msg)
				} catch (err) {
					console.error(
						"[worker-rabbit] Error processing audio message:",
						err instanceof Error ? err.message : err,
					)
					ch.nack(msg, false, true)
				}
			})

			// Consume work.retry
			await ch.consume("work.retry", async (msg) => {
				if (!msg) return
				try {
					const data = JSON.parse(msg.content.toString()) as WorkMessage
					await handlers.onRetry(data)
					ch.ack(msg)
				} catch (err) {
					console.error(
						"[worker-rabbit] Error processing retry message:",
						err instanceof Error ? err.message : err,
					)
					ch.nack(msg, false, true)
				}
			})

			console.log("[worker-rabbit] Connected and consuming work queues")
		} catch (err) {
			console.error(
				"[worker-rabbit] Connection failed:",
				err instanceof Error ? err.message : err,
			)
			scheduleReconnect()
		}
	}

	function scheduleReconnect() {
		if (reconnecting) return
		reconnecting = true
		setTimeout(() => {
			reconnecting = false
			connect()
		}, 5000)
	}

	await connect()
}

export async function closeWorkerRabbit(): Promise<void> {
	try {
		await channel?.close()
		await connection?.close()
	} catch {
		// Ignore close errors
	}
	channel = null
	connection = null
}
