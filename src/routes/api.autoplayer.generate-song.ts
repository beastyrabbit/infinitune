import { createFileRoute } from '@tanstack/react-router'
import { generateSongMetadata, SYSTEM_PROMPT, SONG_SCHEMA } from '@/services/llm'

export { SYSTEM_PROMPT, SONG_SCHEMA }

export const Route = createFileRoute('/api/autoplayer/generate-song')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const songData = await generateSongMetadata(body as Parameters<typeof generateSongMetadata>[0])
          return new Response(JSON.stringify(songData), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message || 'Failed to generate song metadata' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
