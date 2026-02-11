import { getServiceUrls } from '@/lib/server-settings'

export interface AceSubmitResult {
  taskId: string
}

export interface AcePollResult {
  status: 'running' | 'succeeded' | 'failed' | 'not_found'
  audioPath?: string
  error?: string
  result?: unknown
}

export async function submitToAce(options: {
  lyrics: string
  caption: string
  vocalStyle?: string
  bpm: number
  keyScale: string
  timeSignature: string
  audioDuration: number
  aceModel?: string
  inferenceSteps?: number
  vocalLanguage?: string
  lmTemperature?: number
  lmCfgScale?: number
  inferMethod?: string
  signal?: AbortSignal
}): Promise<AceSubmitResult> {
  const { lyrics, caption, vocalStyle, bpm, keyScale, timeSignature, audioDuration, aceModel, inferenceSteps, vocalLanguage, lmTemperature, lmCfgScale, inferMethod, signal } = options

  const urls = await getServiceUrls()
  const aceUrl = urls.aceStepUrl

  const fullPrompt = vocalStyle ? `${caption}, ${vocalStyle}` : caption

  const payload: Record<string, unknown> = {
    prompt: fullPrompt,
    lyrics,
    bpm,
    key_scale: keyScale,
    time_signature: timeSignature,
    audio_duration: audioDuration,
    thinking: true,
    batch_size: 1,
    inference_steps: inferenceSteps ?? 12,
    vocal_language: vocalLanguage || 'en',
    use_format: false,
    use_cot_caption: false,
    use_cot_metas: false,
    lm_temperature: lmTemperature ?? 0.85,
    lm_cfg_scale: lmCfgScale ?? 2.5,
    infer_method: inferMethod || 'ode',
    audio_format: 'mp3',
  }

  if (aceModel) {
    payload.model = aceModel
  }

  const response = await fetch(`${aceUrl}/release_task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  const data = await response.json()
  const taskId = data.data?.task_id
  if (!taskId) {
    throw new Error(data.error || 'No task_id returned from ACE-Step')
  }

  return { taskId }
}

export async function pollAce(taskId: string, signal?: AbortSignal): Promise<AcePollResult> {
  const urls = await getServiceUrls()
  const aceUrl = urls.aceStepUrl

  const response = await fetch(`${aceUrl}/query_result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id_list: [taskId] }),
    signal,
  })

  const data = await response.json()
  const results = data.data
  if (!results || !Array.isArray(results) || results.length === 0) {
    return { status: 'not_found' }
  }

  const task = results[0]

  if (task.status === 0) {
    return { status: 'running' }
  }

  if (task.status === 2) {
    return { status: 'failed', error: 'Audio generation failed' }
  }

  if (task.status === 1) {
    let resultItems: { file: string }[] = []
    try {
      resultItems = JSON.parse(task.result)
    } catch {
      throw new Error('Failed to parse ACE-Step result JSON')
    }

    if (resultItems.length === 0) {
      throw new Error('No audio files in ACE-Step result')
    }

    const firstResult = resultItems[0]
    return {
      status: 'succeeded',
      audioPath: firstResult.file,
      result: firstResult,
    }
  }

  return { status: 'running' }
}
