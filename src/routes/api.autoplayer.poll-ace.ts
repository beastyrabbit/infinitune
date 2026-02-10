import { createFileRoute } from '@tanstack/react-router'
import { getServiceUrls } from '@/lib/server-settings'

export const Route = createFileRoute('/api/autoplayer/poll-ace')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { taskId } = body as { taskId: string }

          const urls = await getServiceUrls()
          const aceUrl = urls.aceStepUrl

          const response = await fetch(`${aceUrl}/query_result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id_list: [taskId] }),
          })

          const data = await response.json()

          // data.data is an array of results
          const results = data.data
          if (!results || !Array.isArray(results) || results.length === 0) {
            return new Response(
              JSON.stringify({ status: 'running' }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          const task = results[0]
          // Status: 0 = queued/running, 1 = succeeded, 2 = failed
          if (task.status === 0) {
            return new Response(
              JSON.stringify({ status: 'running' }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          if (task.status === 2) {
            return new Response(
              JSON.stringify({ status: 'failed', error: 'Audio generation failed' }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          if (task.status === 1) {
            // Parse the result JSON string
            let resultItems: any[] = []
            try {
              resultItems = JSON.parse(task.result)
            } catch {
              throw new Error('Failed to parse ACE-Step result JSON')
            }

            if (resultItems.length === 0) {
              throw new Error('No audio files in ACE-Step result')
            }

            const firstResult = resultItems[0]
            // firstResult.file contains the audio download path like "/v1/audio?path=..."
            return new Response(
              JSON.stringify({
                status: 'succeeded',
                audioPath: firstResult.file,
                result: firstResult,
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          return new Response(
            JSON.stringify({ status: 'running' }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message || 'Failed to poll ACE-Step' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
