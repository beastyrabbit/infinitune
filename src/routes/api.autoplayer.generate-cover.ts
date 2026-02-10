import { createFileRoute } from '@tanstack/react-router'
import { generateCover } from '@/services/cover'

export const Route = createFileRoute('/api/autoplayer/generate-cover')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json() as { coverPrompt: string; provider: string; model?: string }
          const result = await generateCover({
            coverPrompt: body.coverPrompt,
            provider: body.provider,
            model: body.model,
          })
          return new Response(
            JSON.stringify(result || { imageBase64: null, format: null }),
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
