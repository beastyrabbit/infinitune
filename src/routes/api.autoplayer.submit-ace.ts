import { createFileRoute } from '@tanstack/react-router'
import { getServiceUrls } from '@/lib/server-settings'

export const Route = createFileRoute('/api/autoplayer/submit-ace')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { lyrics, caption, bpm, keyScale, timeSignature, audioDuration, aceModel } = body as {
            lyrics: string
            caption: string
            bpm: number
            keyScale: string
            timeSignature: string
            audioDuration: number
            aceModel?: string
          }

          const urls = await getServiceUrls()
          const aceUrl = urls.aceStepUrl

          const payload: Record<string, unknown> = {
            prompt: caption,
            lyrics,
            bpm,
            key_scale: keyScale,
            time_signature: timeSignature,
            audio_duration: audioDuration,
            thinking: true,
            batch_size: 1,
            inference_steps: 8,
            audio_format: 'mp3',
          }

          if (aceModel) {
            payload.model = aceModel
          }

          const response = await fetch(`${aceUrl}/release_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

          const data = await response.json()

          // Unwrap: ACE-Step wraps in { data: { task_id, status }, code: 200 }
          const taskId = data.data?.task_id
          if (!taskId) {
            throw new Error(data.error || 'No task_id returned from ACE-Step')
          }

          return new Response(JSON.stringify({ taskId }), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message || 'Failed to submit to ACE-Step' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
