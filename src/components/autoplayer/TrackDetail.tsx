import { useEffect, useState } from 'react'
import { X, Music, Clock, Disc3, FileText, Palette, Loader2 } from 'lucide-react'
import { CoverArt } from './CoverArt'

interface Song {
  _id: string
  title?: string
  artistName?: string
  genre?: string
  subGenre?: string
  lyrics?: string
  caption?: string
  coverPrompt?: string | null
  coverUrl?: string | null
  bpm?: number
  keyScale?: string
  timeSignature?: string
  audioDuration?: number
  status: string
  aceTaskId?: string | null
  audioUrl?: string | null
  storagePath?: string | null
  errorMessage?: string | null
  retryCount?: number | null
  erroredAtStatus?: string | null
  generationStartedAt?: number | null
  generationCompletedAt?: number | null
  isInterrupt?: boolean
  interruptPrompt?: string | null
  orderIndex: number
}

interface TrackDetailProps {
  song: Song
  onClose: () => void
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}S`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}M ${s}S`
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'QUEUED — WAITING FOR WORKER',
  generating_metadata: 'WRITING LYRICS & METADATA',
  metadata_ready: 'METADATA READY — QUEUED FOR AUDIO',
  submitting_to_ace: 'COVER ART + SUBMITTING TO ENGINE',
  generating_audio: 'AUDIO SYNTHESIS IN PROGRESS',
  saving: 'SAVING TO LIBRARY',
  ready: 'READY TO PLAY',
  playing: 'NOW PLAYING',
  played: 'PLAYED',
  retry_pending: 'RETRY PENDING',
  error: 'ERROR',
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  return <>{formatElapsed(elapsed)}</>
}

export function TrackDetail({ song, onClose }: TrackDetailProps) {
  const isGenerating = [
    'pending',
    'generating_metadata',
    'metadata_ready',
    'submitting_to_ace',
    'generating_audio',
    'saving',
  ].includes(song.status)

  const totalGenTime =
    song.generationStartedAt && song.generationCompletedAt
      ? song.generationCompletedAt - song.generationStartedAt
      : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto border-4 border-white/20 bg-gray-950">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b-4 border-white/20 bg-black px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Disc3 className="h-4 w-4 text-red-500" />
            <span className="text-sm font-black uppercase tracking-widest">
              TRACK {String(Math.round(song.orderIndex)).padStart(2, '0')} — DETAILS
            </span>
          </div>
          <button
            className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Top: Cover + Basic Info */}
          <div className="flex gap-6">
            <div className="w-48 shrink-0">
              <CoverArt
                title={song.title || 'Generating...'}
                artistName={song.artistName || '...'}
                coverUrl={song.coverUrl}
                size="md"
              />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h2 className="text-2xl font-black uppercase">{song.title || 'Generating...'}</h2>
                <p className="text-sm font-bold uppercase text-white/50">{song.artistName || '...'}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="border-2 border-white/20 px-2 py-1 text-xs font-black uppercase">
                  {song.genre || '...'}
                </span>
                <span className="border-2 border-white/20 px-2 py-1 text-xs font-black uppercase text-white/60">
                  {song.subGenre || '...'}
                </span>
                {song.isInterrupt && (
                  <span className="border-2 border-yellow-500 px-2 py-1 text-xs font-black uppercase text-yellow-500">
                    INTERRUPT
                  </span>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                {isGenerating && <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />}
                <span
                  className={`text-sm font-black uppercase ${
                    song.status === 'error'
                      ? 'text-red-500'
                      : song.status === 'retry_pending'
                        ? 'text-orange-400'
                        : isGenerating
                          ? 'text-yellow-500'
                          : song.status === 'ready'
                            ? 'text-green-500'
                            : 'text-white/60'
                  }`}
                >
                  {STATUS_LABELS[song.status] || song.status.toUpperCase()}
                </span>
              </div>

              {song.errorMessage && (
                <p className="text-xs font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-3 py-2">
                  {song.errorMessage}
                </p>
              )}

              {(song.retryCount != null && song.retryCount > 0) && (
                <span className="text-xs font-black uppercase text-orange-400">
                  RETRY {song.retryCount}/3
                </span>
              )}

              {/* Generation Time */}
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-white/40">
                <Clock className="h-3 w-3" />
                {isGenerating && song.generationStartedAt ? (
                  <span className="text-yellow-500">
                    RUNNING: <LiveTimer startedAt={song.generationStartedAt} />
                  </span>
                ) : totalGenTime ? (
                  <span>GENERATED IN {formatElapsed(totalGenTime)}</span>
                ) : (
                  <span>--</span>
                )}
              </div>
            </div>
          </div>

          {/* Music Properties */}
          <div className="border-4 border-white/10 bg-black">
            <div className="border-b-2 border-white/10 px-4 py-2">
              <span className="text-xs font-black uppercase tracking-widest text-white/40">
                <Music className="h-3 w-3 inline mr-2" />
                MUSIC PROPERTIES
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x-2 divide-white/10">
              <div className="p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-white/30">BPM</p>
                <p className="text-lg font-black">{song.bpm ?? '--'}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-white/30">KEY</p>
                <p className="text-lg font-black uppercase">{song.keyScale ?? '--'}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-white/30">TIME SIG</p>
                <p className="text-lg font-black">{song.timeSignature ?? '--'}</p>
              </div>
              <div className="p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-white/30">DURATION</p>
                <p className="text-lg font-black">{song.audioDuration ? formatDuration(song.audioDuration) : '--'}</p>
              </div>
            </div>
          </div>

          {/* Caption */}
          <div className="border-4 border-white/10 bg-black">
            <div className="border-b-2 border-white/10 px-4 py-2">
              <span className="text-xs font-black uppercase tracking-widest text-white/40">
                AUDIO CAPTION (ACE-STEP INPUT)
              </span>
            </div>
            <p className="px-4 py-3 text-sm font-bold uppercase text-white/70">{song.caption || 'Pending...'}</p>
          </div>

          {/* Cover Prompt */}
          {song.coverPrompt && (
            <div className="border-4 border-white/10 bg-black">
              <div className="border-b-2 border-white/10 px-4 py-2">
                <span className="text-xs font-black uppercase tracking-widest text-white/40">
                  <Palette className="h-3 w-3 inline mr-2" />
                  COVER ART PROMPT
                </span>
              </div>
              <p className="px-4 py-3 text-sm font-bold uppercase text-white/70">
                {song.coverPrompt}
              </p>
            </div>
          )}

          {/* Interrupt Prompt */}
          {song.interruptPrompt && (
            <div className="border-4 border-yellow-500/30 bg-black">
              <div className="border-b-2 border-yellow-500/30 px-4 py-2">
                <span className="text-xs font-black uppercase tracking-widest text-yellow-500/60">
                  INTERRUPT REQUEST
                </span>
              </div>
              <p className="px-4 py-3 text-sm font-bold uppercase text-yellow-500/70">
                {song.interruptPrompt}
              </p>
            </div>
          )}

          {/* Lyrics */}
          <div className="border-4 border-white/10 bg-black">
            <div className="border-b-2 border-white/10 px-4 py-2">
              <span className="text-xs font-black uppercase tracking-widest text-white/40">
                <FileText className="h-3 w-3 inline mr-2" />
                LYRICS
              </span>
            </div>
            <pre className="px-4 py-3 text-xs font-bold text-white/60 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {song.lyrics || 'Pending...'}
            </pre>
          </div>

          {/* Technical IDs */}
          <div className="border-4 border-white/10 bg-black">
            <div className="border-b-2 border-white/10 px-4 py-2">
              <span className="text-xs font-black uppercase tracking-widest text-white/40">
                TECHNICAL
              </span>
            </div>
            <div className="px-4 py-3 space-y-1 text-[10px] font-bold uppercase text-white/20 font-mono">
              <p>SONG ID: {song._id}</p>
              {song.aceTaskId && <p>ACE TASK: {song.aceTaskId}</p>}
              {song.storagePath && <p>NFS PATH: {song.storagePath}</p>}
              {song.audioUrl && <p>AUDIO URL: {song.audioUrl}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
