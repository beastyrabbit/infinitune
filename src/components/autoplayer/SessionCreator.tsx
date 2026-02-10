import { useState, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { Music, Settings, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

interface ModelOption {
  name: string
  type?: string
  vision?: boolean
}

interface SessionCreatorProps {
  onCreateSession: (data: {
    name: string
    prompt: string
    provider: string
    model: string
  }) => void
  onResumeSession: (id: string) => void
  onOpenSettings: () => void
}

export function SessionCreator({ onCreateSession, onResumeSession, onOpenSettings }: SessionCreatorProps) {
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState('ollama')
  const [model, setModel] = useState('')
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)

  const closedSessions = useQuery(api.sessions.listClosed)

  useEffect(() => {
    fetch('/api/autoplayer/ollama-models')
      .then((r) => r.json())
      .then((d) => {
        const allModels = d.models || []
        setOllamaModels(allModels)
        const textOnly = allModels.filter((m: ModelOption) => m.type === 'text' || (!m.type && !m.vision))
        if (textOnly.length > 0 && !model) {
          const preferred = textOnly.find((m: ModelOption) => m.name === 'gpt-oss:20b')
          setModel(preferred ? preferred.name : textOnly[0].name)
        }
      })
      .catch(() => {})
  }, [])

  const textModels = ollamaModels.filter((m) => m.type === 'text' || (!m.type && !m.vision))

  const handleStart = async () => {
    if (!prompt.trim() || !model.trim()) return
    setLoading(true)
    const name = prompt.trim().slice(0, 50)
    onCreateSession({ name, prompt: prompt.trim(), provider, model })
  }

  return (
    <div className="font-mono min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase">
            AUTOPLAYER
          </h1>
          <p className="mt-2 text-sm uppercase tracking-widest text-white/30">
            AI-GENERATED MUSIC // INFINITE PLAYBACK
          </p>
        </div>

        {/* Main card */}
        <div className="border-4 border-white/20 bg-black">
          <div className="border-b-4 border-white/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-red-500" />
              <span className="text-sm font-black uppercase tracking-widest">
                NEW SESSION
              </span>
            </div>
            <button
              className="flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
              onClick={onOpenSettings}
            >
              <Settings className="h-4 w-4" />
              [SETTINGS]
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Prompt */}
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
                DESCRIBE YOUR MUSIC
              </label>
              <Textarea
                className="min-h-[120px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-white/40 resize-none"
                placeholder="GERMAN ROCK LIKE RAMMSTEIN MEETS LINKIN PARK WITH HEAVY INDUSTRIAL BEATS..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.toUpperCase())}
              />
            </div>

            {/* Model selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
                  PROVIDER
                </label>
                <div className="flex gap-0">
                  <button
                    className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
                      provider === 'ollama'
                        ? 'bg-white text-black'
                        : 'bg-transparent text-white hover:bg-white/10'
                    }`}
                    onClick={() => setProvider('ollama')}
                  >
                    OLLAMA
                  </button>
                  <button
                    className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
                      provider === 'openrouter'
                        ? 'bg-white text-black'
                        : 'bg-transparent text-white hover:bg-white/10'
                    }`}
                    onClick={() => setProvider('openrouter')}
                  >
                    OPENROUTER
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
                  TEXT MODEL
                </label>
                {provider === 'ollama' && textModels.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
                      <SelectValue placeholder="SELECT MODEL" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
                      {textModels.map((m) => (
                        <SelectItem
                          key={m.name}
                          value={m.name}
                          className="font-mono text-sm font-bold uppercase text-white"
                        >
                          {m.name.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
                    placeholder={provider === 'openrouter' ? 'GOOGLE/GEMINI-2.5-FLASH' : 'LLAMA3.1:8B'}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                )}
              </div>
            </div>

            {/* Start button */}
            <Button
              className="w-full h-14 rounded-none border-4 border-white/20 bg-red-500 font-mono text-lg font-black uppercase text-white hover:bg-white hover:text-black hover:border-white disabled:opacity-30"
              onClick={handleStart}
              disabled={!prompt.trim() || !model.trim() || loading}
            >
              {loading ? '>>> INITIALIZING <<<' : '>>> START LISTENING <<<'}
            </Button>
          </div>
        </div>

        {/* Previous Sessions */}
        {closedSessions && closedSessions.length > 0 && (
          <div className="mt-6 border-4 border-white/20 bg-black">
            <div className="border-b-4 border-white/20 px-4 py-3 flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-white/40" />
              <span className="text-sm font-black uppercase tracking-widest text-white/60">
                PREVIOUS SESSIONS
              </span>
            </div>
            <div className="divide-y-2 divide-white/10">
              {closedSessions.map((s) => (
                <button
                  key={s._id}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors text-left"
                  onClick={() => onResumeSession(s._id)}
                >
                  <div>
                    <p className="text-sm font-black uppercase text-white/80">
                      {s.name}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-white/30 mt-0.5">
                      {s.llmProvider.toUpperCase()} / {s.llmModel.toUpperCase()} | {s.songsGenerated} TRACKS
                    </p>
                  </div>
                  <span className="text-xs font-black uppercase text-yellow-400 hover:text-white">
                    [RESUME]
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-white/10">
          AUTOPLAYER V1.0 // POWERED BY ACE-STEP 1.5
        </p>
      </div>
    </div>
  )
}
