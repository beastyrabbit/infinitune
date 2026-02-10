import { createFileRoute } from '@tanstack/react-router'
import { getServiceUrls, getSetting } from '@/lib/server-settings'
import WebSocket from 'ws'
import COMFYUI_WORKFLOW from '@/data/comfyui-workflow-z-image-turbo.json'

export const Route = createFileRoute('/api/autoplayer/generate-cover')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { coverPrompt, provider } = body as {
            coverPrompt: string
            provider: string
            model: string
          }

          // Use ComfyUI for image generation (default and recommended)
          if (provider === 'comfyui' || provider === 'ollama') {
            const urls = await getServiceUrls()
            const comfyuiUrl = urls.comfyuiUrl

            // Deep-clone the built-in workflow so we can inject prompt + seed
            const workflow = JSON.parse(JSON.stringify(COMFYUI_WORKFLOW))

            // Find the positive prompt node and sampler node to inject prompt + random seed
            // Support multiple title conventions: "Positive", "Prompt", or first CLIPTextEncode with non-empty text
            let promptNodeId: string | null = null
            let samplerNodeId: string | null = null
            let firstClipNode: string | null = null
            for (const [id, node] of Object.entries(workflow) as [string, any][]) {
              if (node.class_type === 'CLIPTextEncode') {
                const title = (node._meta?.title || '').toLowerCase()
                if (title.includes('positive') || title.includes('prompt')) {
                  promptNodeId = id
                }
                if (!firstClipNode && !title.includes('negative')) {
                  firstClipNode = id
                }
              }
              if (node.class_type === 'KSampler') {
                samplerNodeId = id
              }
            }
            // Fall back to first non-negative CLIPTextEncode if no "Positive"/"Prompt" match
            if (!promptNodeId && firstClipNode) promptNodeId = firstClipNode
            if (promptNodeId) workflow[promptNodeId]["inputs"]["text"] = coverPrompt
            if (samplerNodeId) workflow[samplerNodeId]["inputs"]["seed"] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

            // Ensure workflow uses a WebSocket save node for WS image retrieval
            // Swap SaveImage → SaveImageWebsocket, keep existing SaveImageWebsocket/Websocket_Image_Save as-is
            const WS_SAVE_NODES = ['SaveImageWebsocket', 'Websocket_Image_Save']
            let hasWsSaveNode = false
            for (const [_id, node] of Object.entries(workflow) as [string, any][]) {
              if (WS_SAVE_NODES.includes(node.class_type)) {
                hasWsSaveNode = true
              }
            }
            if (!hasWsSaveNode) {
              // Swap any SaveImage/PreviewImage to SaveImageWebsocket
              for (const [id, node] of Object.entries(workflow) as [string, any][]) {
                if (node.class_type === 'SaveImage' || node.class_type === 'PreviewImage') {
                  workflow[id] = {
                    inputs: { images: node.inputs.images },
                    class_type: 'SaveImageWebsocket',
                    _meta: { title: 'SaveImageWebsocket' },
                  }
                  break // only swap the first one
                }
              }
            }

            // Generate a client ID for WebSocket
            const clientId = crypto.randomUUID()

            // Open WebSocket to ComfyUI
            const wsUrl = comfyuiUrl.replace(/^http/, 'ws')
            const base64 = await new Promise<string>((resolve, reject) => {
              const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientId}`)
              let imageBuffer: Buffer | null = null
              let resolved = false

              const timeout = setTimeout(() => {
                if (!resolved) {
                  resolved = true
                  ws.close()
                  reject(new Error('ComfyUI WebSocket timed out (3 min)'))
                }
              }, 180_000)

              ws.on('open', async () => {
                try {
                  const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
                  })

                  if (!submitRes.ok) {
                    const errText = await submitRes.text()
                    throw new Error(`ComfyUI submit failed: ${errText}`)
                  }
                } catch (err) {
                  if (!resolved) {
                    resolved = true
                    clearTimeout(timeout)
                    ws.close()
                    reject(err)
                  }
                }
              })

              ws.on('message', (data: Buffer | string) => {
                if (resolved) return

                const raw = Buffer.isBuffer(data) ? data : Buffer.from(data)

                // Try parsing as JSON first — ComfyUI sends all messages as binary
                try {
                  const msg = JSON.parse(raw.toString())
                  if (msg.type === 'executed' || msg.type === 'execution_success') {
                    if (imageBuffer) {
                      resolved = true
                      clearTimeout(timeout)
                      ws.close()
                      resolve(imageBuffer.toString('base64'))
                    }
                  } else if (msg.type === 'execution_error') {
                    resolved = true
                    clearTimeout(timeout)
                    ws.close()
                    reject(new Error('ComfyUI generation failed'))
                  }
                  return
                } catch {
                  // Not JSON — treat as binary image data
                }

                // Binary message = image data from SaveImageWebsocket
                // First 8 bytes are header (event type + format), rest is PNG
                if (raw.length > 8) {
                  imageBuffer = raw.subarray(8)
                }
              })

              ws.on('error', (err) => {
                if (!resolved) {
                  resolved = true
                  clearTimeout(timeout)
                  reject(new Error(`ComfyUI WebSocket error: ${err.message}`))
                }
              })

              ws.on('close', () => {
                if (!resolved) {
                  if (imageBuffer) {
                    resolved = true
                    clearTimeout(timeout)
                    resolve(imageBuffer.toString('base64'))
                  } else {
                    resolved = true
                    clearTimeout(timeout)
                    reject(new Error('ComfyUI WebSocket closed without image'))
                  }
                }
              })
            })

            return new Response(
              JSON.stringify({ imageBase64: base64, format: 'png' }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          if (provider === 'openrouter') {
            const openrouterKey = (await getSetting('openrouterApiKey')) || process.env.OPENROUTER_API_KEY || ''
            const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterKey}`,
              },
              body: JSON.stringify({
                model: body.model,
                prompt: coverPrompt,
                n: 1,
                size: '512x512',
                response_format: 'b64_json',
              }),
            })

            if (!response.ok) {
              const err = await response.text()
              throw new Error(`OpenRouter image generation failed: ${err}`)
            }

            const data = await response.json()
            const b64 = data.data?.[0]?.b64_json
            if (!b64) throw new Error('No image data returned from OpenRouter')

            return new Response(
              JSON.stringify({ imageBase64: b64, format: 'png' }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          // Unknown provider — return null
          return new Response(
            JSON.stringify({ imageBase64: null, format: null }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message || 'Failed to generate cover', imageBase64: null }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
