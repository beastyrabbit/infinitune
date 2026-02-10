import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { SYSTEM_PROMPT, SONG_SCHEMA } from './api.autoplayer.generate-song'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  type StepState,
  formatElapsed,
  LiveTimer,
  StatusBadge,
  CollapsibleJson,
} from '@/components/autoplayer/test/shared'

export const Route = createFileRoute('/autoplayer_/test/e2e')({
  component: PipelineTestPage,
})

const STEP_NAMES: Record<string, string> = {
  llm: '1. LLM Generation',
  create: '2. Create in Convex',
  ace: '3a. Submit ACE-Step',
  cover: '3b. Generate Cover',
  poll: '4. Poll ACE-Step',
  save: '5. Save to NFS',
  ready: '6. Mark Ready',
}

const STEP_ORDER = ['llm', 'create', 'ace', 'cover', 'poll', 'save', 'ready']

function createInitialSteps(): Record<string, StepState> {
  const steps: Record<string, StepState> = {}
  for (const key of STEP_ORDER) {
    steps[key] = {
      status: 'pending',
      startedAt: null,
      completedAt: null,
      input: null,
      output: null,
      error: null,
    }
  }
  return steps
}

function PipelineTestPage() {
  const settings = useQuery(api.settings.getAll)
  const currentSession = useQuery(api.sessions.getCurrent)
  const sessionId = currentSession?._id ?? null

  const createSong = useMutation(api.songs.create)
  const updateAceTask = useMutation(api.songs.updateAceTask)
  const updateCover = useMutation(api.songs.updateCover)
  const updateStoragePath = useMutation(api.songs.updateStoragePath)
  const markReady = useMutation(api.songs.markReady)
  const incrementSongs = useMutation(api.sessions.incrementSongsGenerated)

  const [prompt, setPrompt] = useState('upbeat electronic dance music')
  const [steps, setSteps] = useState<Record<string, StepState>>(createInitialSteps)
  const [isRunning, setIsRunning] = useState(false)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [songMeta, setSongMeta] = useState<any>(null)
  const abortRef = useRef<AbortController | null>(null)

  const collectedData = useRef<{
    songData?: any
    songId?: string
    taskId?: string
    audioPath?: string
    coverBase64?: string | null
  }>({})

  const updateStep = useCallback((key: string, patch: Partial<StepState>) => {
    setSteps((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }))
  }, [])

  const runPipeline = useCallback(
    async (fromStep?: string) => {
      if (!sessionId || !currentSession) return

      const ac = new AbortController()
      abortRef.current = ac
      const signal = ac.signal
      setIsRunning(true)

      const startIdx = fromStep ? STEP_ORDER.indexOf(fromStep) : 0
      setSteps((prev) => {
        const next = { ...prev }
        for (let i = startIdx; i < STEP_ORDER.length; i++) {
          const key = STEP_ORDER[i]
          next[key] = {
            status: 'pending',
            startedAt: null,
            completedAt: null,
            input: null,
            output: null,
            error: null,
          }
        }
        return next
      })

      const provider = settings?.textProvider || 'ollama'
      const model = settings?.textModel || ''
      const imageProvider = settings?.imageProvider === 'ollama' ? 'comfyui' : (settings?.imageProvider || 'comfyui')
      const imageModel = settings?.imageModel || ''
      const aceModel = settings?.aceModel || ''
      const cd = collectedData.current

      try {
        // Step 1: LLM Generation
        if (startIdx <= 0) {
          const llmInput = {
            provider,
            model,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: prompt,
            schema: SONG_SCHEMA,
            structuredOutput: provider === 'ollama' ? 'format (JSON schema)' : 'response_format (json_schema)',
          }
          updateStep('llm', { status: 'running', startedAt: Date.now(), input: llmInput })

          const llmRes = await fetch('/api/autoplayer/generate-song', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(llmInput),
            signal,
          })

          if (!llmRes.ok) throw new Error(`LLM failed: ${await llmRes.text()}`)
          const songData = await llmRes.json()
          if (songData.error) throw new Error(songData.error)

          cd.songData = songData
          setSongMeta(songData)
          updateStep('llm', { status: 'done', completedAt: Date.now(), output: songData })
        }

        if (signal.aborted) throw new Error('Cancelled')

        // Step 2: Create in Convex
        if (startIdx <= 1) {
          const songData = cd.songData!
          const createInput = {
            sessionId,
            orderIndex: Date.now(),
            title: songData.title,
            artistName: songData.artistName,
            genre: songData.genre,
            subGenre: songData.subGenre || songData.genre,
            lyrics: songData.lyrics,
            caption: songData.caption,
            coverPrompt: songData.coverPrompt,
            bpm: songData.bpm,
            keyScale: songData.keyScale,
            timeSignature: songData.timeSignature,
            audioDuration: songData.audioDuration,
          }
          updateStep('create', { status: 'running', startedAt: Date.now(), input: createInput })

          const songId = await createSong(createInput as any)
          cd.songId = songId
          updateStep('create', { status: 'done', completedAt: Date.now(), output: { songId } })
        }

        if (signal.aborted) throw new Error('Cancelled')

        // Steps 3a + 3b in parallel
        const acePromise = (async () => {
          if (startIdx <= 2) {
            const songData = cd.songData!
            const aceInput = {
              lyrics: songData.lyrics,
              caption: songData.caption,
              bpm: songData.bpm,
              keyScale: songData.keyScale,
              timeSignature: songData.timeSignature,
              audioDuration: songData.audioDuration,
              aceModel,
            }
            updateStep('ace', { status: 'running', startedAt: Date.now(), input: aceInput })

            const aceRes = await fetch('/api/autoplayer/submit-ace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(aceInput),
              signal,
            })

            if (!aceRes.ok) throw new Error(`ACE-Step submit failed: ${await aceRes.text()}`)
            const aceData = await aceRes.json()
            if (aceData.error) throw new Error(aceData.error)

            cd.taskId = aceData.taskId
            await updateAceTask({ id: cd.songId as any, aceTaskId: aceData.taskId })
            updateStep('ace', { status: 'done', completedAt: Date.now(), output: aceData })
          }
        })()

        const coverPromise = (async () => {
          if (startIdx <= 3) {
            const songData = cd.songData!
            if (!imageProvider || !songData.coverPrompt) {
              updateStep('cover', { status: 'skipped' })
              return
            }
            const coverInput = {
              coverPrompt: songData.coverPrompt,
              provider: imageProvider,
              model: imageModel,
            }
            updateStep('cover', { status: 'running', startedAt: Date.now(), input: coverInput })

            try {
              const coverRes = await fetch('/api/autoplayer/generate-cover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(coverInput),
                signal,
              })

              if (coverRes.ok) {
                const coverData = await coverRes.json()
                if (coverData.imageBase64) {
                  cd.coverBase64 = coverData.imageBase64
                  setCoverPreview(`data:image/png;base64,${coverData.imageBase64}`)
                  if (cd.songId) {
                    await updateCover({
                      id: cd.songId as any,
                      coverUrl: `data:image/png;base64,${coverData.imageBase64}`,
                    })
                  }
                  updateStep('cover', {
                    status: 'done',
                    completedAt: Date.now(),
                    output: { format: coverData.format, imageSize: `${Math.round(coverData.imageBase64.length / 1024)}KB` },
                  })
                } else {
                  updateStep('cover', { status: 'done', completedAt: Date.now(), output: { imageBase64: null } })
                }
              } else {
                const errText = await coverRes.text()
                updateStep('cover', { status: 'error', completedAt: Date.now(), error: errText })
              }
            } catch (e: any) {
              if (signal.aborted) throw e
              updateStep('cover', { status: 'error', completedAt: Date.now(), error: e.message })
            }
          }
        })()

        await acePromise
        await coverPromise.catch(() => {})

        if (signal.aborted) throw new Error('Cancelled')

        // Step 4: Poll ACE-Step
        if (startIdx <= 4) {
          const pollInput = { taskId: cd.taskId }
          updateStep('poll', { status: 'running', startedAt: Date.now(), input: pollInput })

          let attempts = 0
          const maxAttempts = 120
          let audioPath: string | null = null

          while (attempts < maxAttempts) {
            if (signal.aborted) throw new Error('Cancelled')
            await new Promise((r) => setTimeout(r, 5000))
            if (signal.aborted) throw new Error('Cancelled')

            const pollRes = await fetch('/api/autoplayer/poll-ace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: cd.taskId }),
              signal,
            })

            if (!pollRes.ok) { attempts++; continue }
            const pollData = await pollRes.json()

            if (pollData.status === 'succeeded') {
              audioPath = pollData.audioPath
              cd.audioPath = audioPath!
              updateStep('poll', {
                status: 'done',
                completedAt: Date.now(),
                output: { ...pollData, pollCount: attempts + 1 },
              })
              break
            } else if (pollData.status === 'failed') {
              throw new Error(pollData.error || 'Audio generation failed')
            }
            attempts++
          }

          if (!audioPath) throw new Error('Audio generation timed out')
        }

        if (signal.aborted) throw new Error('Cancelled')

        // Step 5: Save to NFS
        if (startIdx <= 5) {
          const songData = cd.songData!
          const saveInput = {
            songId: cd.songId,
            title: songData.title,
            artistName: songData.artistName,
            genre: songData.genre,
            subGenre: songData.subGenre || songData.genre,
            lyrics: songData.lyrics,
            caption: songData.caption,
            coverPrompt: songData.coverPrompt,
            bpm: songData.bpm,
            keyScale: songData.keyScale,
            timeSignature: songData.timeSignature,
            audioDuration: songData.audioDuration,
            aceAudioPath: cd.audioPath,
            coverBase64: cd.coverBase64 || null,
          }
          updateStep('save', { status: 'running', startedAt: Date.now(), input: saveInput })

          try {
            const saveRes = await fetch('/api/autoplayer/save-song', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(saveInput),
              signal,
            })

            if (saveRes.ok) {
              const saveData = await saveRes.json()
              if (cd.songId) {
                await updateStoragePath({
                  id: cd.songId as any,
                  storagePath: saveData.storagePath,
                  aceAudioPath: cd.audioPath!,
                })
              }
              updateStep('save', { status: 'done', completedAt: Date.now(), output: saveData })
            } else {
              const errText = await saveRes.text()
              updateStep('save', { status: 'error', completedAt: Date.now(), error: errText })
            }
          } catch (e: any) {
            if (signal.aborted) throw e
            updateStep('save', { status: 'error', completedAt: Date.now(), error: e.message })
          }
        }

        if (signal.aborted) throw new Error('Cancelled')

        // Step 6: Mark Ready
        if (startIdx <= 6) {
          const readyInput = { songId: cd.songId, audioPath: cd.audioPath }
          updateStep('ready', { status: 'running', startedAt: Date.now(), input: readyInput })

          const encodedAudioPath = encodeURIComponent(cd.audioPath!)
          const finalAudioUrl = `/api/autoplayer/audio/${cd.songId}?aceAudioPath=${encodedAudioPath}`
          await markReady({ id: cd.songId as any, audioUrl: finalAudioUrl })
          await incrementSongs({ id: sessionId as any })

          setAudioUrl(finalAudioUrl)
          updateStep('ready', {
            status: 'done',
            completedAt: Date.now(),
            output: { audioUrl: finalAudioUrl },
          })
        }
      } catch (error: any) {
        if (signal.aborted && error.message === 'Cancelled') {
          setSteps((prev) => {
            const next = { ...prev }
            for (const key of STEP_ORDER) {
              if (next[key].status === 'running') {
                next[key] = { ...next[key], status: 'error', error: 'Cancelled', completedAt: Date.now() }
              }
            }
            return next
          })
        } else {
          setSteps((prev) => {
            const next = { ...prev }
            for (const key of STEP_ORDER) {
              if (next[key].status === 'running') {
                next[key] = { ...next[key], status: 'error', error: error.message, completedAt: Date.now() }
                break
              }
            }
            return next
          })
        }
      } finally {
        setIsRunning(false)
        abortRef.current = null
      }
    },
    [sessionId, currentSession, settings, prompt, createSong, updateAceTask, updateCover, updateStoragePath, markReady, incrementSongs, updateStep],
  )

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleReset = useCallback(() => {
    setSteps(createInitialSteps())
    setCoverPreview(null)
    setAudioUrl(null)
    setSongMeta(null)
    collectedData.current = {}
  }, [])

  const handleRetryFrom = useCallback(
    (stepKey: string) => {
      runPipeline(stepKey)
    },
    [runPipeline],
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* CONFIG */}
      <section className="border-4 border-white/10 bg-black">
        <div className="border-b-2 border-white/10 px-4 py-2">
          <span className="text-xs font-black uppercase tracking-widest text-white/40">
            CONFIGURATION
          </span>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase text-white/40 mb-1 block">
              Prompt
            </label>
            <textarea
              className="w-full h-20 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white p-2 focus:outline-none focus:border-yellow-500"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
            />
          </div>

          <div className="text-[10px] font-bold uppercase text-white/30 space-y-1">
            <p>PROVIDER: {settings?.textProvider || 'ollama'} | MODEL: {settings?.textModel || 'default'}</p>
            <p>IMAGE: {settings?.imageProvider || 'comfyui'} | ACE: {settings?.aceModel || 'default'}</p>
            <p>SESSION: {sessionId || 'NONE'}</p>
          </div>

          <div className="flex gap-2">
            <button
              className={`flex-1 h-10 border-4 font-mono text-xs font-black uppercase transition-colors ${
                isRunning
                  ? 'border-white/10 bg-white/5 text-white/20 cursor-not-allowed'
                  : 'border-white/20 bg-green-600 text-white hover:bg-green-500'
              }`}
              onClick={() => runPipeline()}
              disabled={isRunning || !sessionId}
            >
              {!sessionId ? '[NO SESSION]' : '[GENERATE ONE SONG]'}
            </button>
            <button
              className={`h-10 px-4 border-4 font-mono text-xs font-black uppercase transition-colors ${
                isRunning
                  ? 'border-red-500 bg-red-600 text-white hover:bg-red-500'
                  : 'border-white/10 bg-white/5 text-white/20 cursor-not-allowed'
              }`}
              onClick={handleCancel}
              disabled={!isRunning}
            >
              [CANCEL]
            </button>
            <button
              className="h-10 px-4 border-4 border-white/20 bg-gray-900 font-mono text-xs font-black uppercase text-white/60 hover:text-white transition-colors"
              onClick={handleReset}
              disabled={isRunning}
            >
              [RESET]
            </button>
          </div>
        </div>
      </section>

      {/* STEP CARDS */}
      <section className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-red-500 border-b-2 border-white/10 pb-1">
          PIPELINE STEPS
        </h2>

        {['llm', 'create'].map((key) => (
          <StepCard
            key={key}
            stepKey={key}
            step={steps[key]}
            onRetry={handleRetryFrom}
            isRunning={isRunning}
          />
        ))}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StepCard stepKey="ace" step={steps.ace} onRetry={handleRetryFrom} isRunning={isRunning} />
          <StepCard stepKey="cover" step={steps.cover} onRetry={handleRetryFrom} isRunning={isRunning} />
        </div>

        {['poll', 'save', 'ready'].map((key) => (
          <StepCard
            key={key}
            stepKey={key}
            step={steps[key]}
            onRetry={handleRetryFrom}
            isRunning={isRunning}
          />
        ))}
      </section>

      {/* PREVIEW */}
      {(coverPreview || audioUrl || songMeta) && (
        <section className="border-4 border-white/10 bg-black">
          <div className="border-b-2 border-white/10 px-4 py-2">
            <span className="text-xs font-black uppercase tracking-widest text-white/40">
              PREVIEW
            </span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex gap-4">
              {coverPreview && (
                <img
                  src={coverPreview}
                  alt="Cover art"
                  className="w-32 h-32 border-4 border-white/20 object-cover"
                />
              )}
              {songMeta && (
                <div className="flex-1 space-y-1">
                  <p className="text-lg font-black uppercase">{songMeta.title}</p>
                  <p className="text-sm font-bold uppercase text-white/50">{songMeta.artistName}</p>
                  <p className="text-xs font-bold uppercase text-white/30">
                    {songMeta.genre} / {songMeta.subGenre}
                  </p>
                  <p className="text-xs font-bold uppercase text-white/30">
                    {songMeta.bpm} BPM | {songMeta.keyScale} | {songMeta.timeSignature}
                  </p>
                </div>
              )}
            </div>
            {audioUrl && (
              <audio controls className="w-full" src={audioUrl}>
                <track kind="captions" />
              </audio>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function StepCard({
  stepKey,
  step,
  onRetry,
  isRunning,
}: {
  stepKey: string
  step: StepState
  onRetry: (key: string) => void
  isRunning: boolean
}) {
  return (
    <div
      className={`border-4 bg-black ${
        step.status === 'error'
          ? 'border-red-500/40'
          : step.status === 'running'
            ? 'border-yellow-500/40'
            : step.status === 'done'
              ? 'border-green-600/30'
              : 'border-white/10'
      }`}
    >
      <div className="px-4 py-2 flex items-center justify-between border-b-2 border-white/10">
        <div className="flex items-center gap-2">
          {step.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />}
          <span className="text-xs font-black uppercase tracking-widest">
            {STEP_NAMES[stepKey]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {step.startedAt && (
            <span className="text-[10px] font-bold uppercase text-white/30">
              {step.completedAt
                ? formatElapsed(step.completedAt - step.startedAt)
                : <LiveTimer startedAt={step.startedAt} />}
            </span>
          )}
          <StatusBadge status={step.status} />
        </div>
      </div>

      <div className="px-4 py-2">
        <CollapsibleJson label="INPUT" data={step.input} />
        <CollapsibleJson label="OUTPUT" data={step.output} />

        {step.error && (
          <div className="mt-2 space-y-2">
            <p className="text-[10px] font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
              {step.error}
            </p>
            {!isRunning && step.error !== 'Cancelled' && (
              <button
                className="flex items-center gap-1 text-[10px] font-black uppercase text-orange-400 hover:text-orange-300"
                onClick={() => onRetry(stepKey)}
              >
                <RotateCcw className="h-3 w-3" />
                [RETRY FROM HERE]
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
