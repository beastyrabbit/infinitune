import * as http from 'node:http'
import type { EndpointQueues } from './queues'
import type { EndpointType } from './endpoint-queue'

interface WorkerHttpContext {
  queues: EndpointQueues
  getSongWorkerCount: () => number
  getPlaylistInfo: () => { id: string; name: string; activeSongWorkers: number }[]
  startTime: number
  onTriggerPersonaScan?: () => void
}

const ENDPOINT_TYPES: EndpointType[] = ['llm', 'image', 'audio']

export function startHttpServer(ctx: WorkerHttpContext, port: number): http.Server {
  const server = http.createServer((req, res) => {
    // CORS headers for frontend
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`)

    if (req.method === 'GET' && url.pathname === '/api/worker/status') {
      const status = ctx.queues.getFullStatus()
      const body = JSON.stringify({
        queues: status,
        songWorkers: ctx.getSongWorkerCount(),
        playlists: ctx.getPlaylistInfo(),
        uptime: Date.now() - ctx.startTime,
      })
      res.writeHead(200)
      res.end(body)
      return
    }

    // /api/worker/queue/:endpointType
    const queueMatch = url.pathname.match(/^\/api\/worker\/queue\/(\w+)$/)
    if (req.method === 'GET' && queueMatch) {
      const endpointType = queueMatch[1] as EndpointType
      if (!ENDPOINT_TYPES.includes(endpointType)) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: `Unknown endpoint type: ${endpointType}` }))
        return
      }

      const queueStatus = ctx.queues.get(endpointType).getStatus()
      const now = Date.now()
      const body = JSON.stringify({
        ...queueStatus,
        activeItems: queueStatus.activeItems.map((a) => ({
          ...a,
          runningMs: now - a.startedAt,
        })),
        pendingItems: queueStatus.pendingItems.map((p) => ({
          ...p,
          waitingMs: now - p.waitingSince,
        })),
      })
      res.writeHead(200)
      res.end(body)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/worker/persona/trigger') {
      ctx.onTriggerPersonaScan?.()
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, message: 'Persona scan triggered' }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  let nextPort = port
  const maxPort = port + 10

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      nextPort++
      if (nextPort > maxPort) {
        console.error(`[worker-api] All ports ${port}-${maxPort} in use, giving up. Worker continues without HTTP API.`)
        return
      }
      console.warn(`[worker-api] Port ${nextPort - 1} in use, trying ${nextPort}`)
      server.listen(nextPort)
    } else {
      console.error('[worker-api] HTTP server error:', err.message)
    }
  })

  server.listen(nextPort, () => {
    const addr = server.address()
    const actualPort = typeof addr === 'object' && addr ? addr.port : nextPort
    console.log(`[worker-api] HTTP server listening on port ${actualPort}`)
  })

  return server
}
