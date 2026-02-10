import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CoverArt } from './CoverArt'

interface Song {
  _id: string
  title: string
  artistName: string
  genre: string
  subGenre: string
  coverUrl?: string | null
  status: string
  orderIndex: number
  generationStartedAt?: number | null
  generationCompletedAt?: number | null
}

interface QueueGridProps {
  songs: Song[]
  currentSongId: string | null
  onSelectSong: (songId: string) => void
  onOpenDetail: (songId: string) => void
}

function getStatusLabel(status: string, isCurrent: boolean) {
  if (isCurrent) return { text: '[PLAYING]', className: 'text-red-500 font-black' }
  switch (status) {
    case 'ready':
      return { text: '[READY]', className: 'text-white font-bold' }
    case 'generating_metadata':
      return { text: '[WRITING...]', className: 'text-yellow-500 animate-pulse font-bold' }
    case 'generating_cover':
      return { text: '[COVER...]', className: 'text-yellow-500 animate-pulse font-bold' }
    case 'submitting_to_ace':
      return { text: '[SUBMITTING...]', className: 'text-yellow-500 animate-pulse font-bold' }
    case 'generating_audio':
      return { text: '[GENERATING AUDIO...]', className: 'text-yellow-500 animate-pulse font-bold' }
    case 'saving':
      return { text: '[SAVING...]', className: 'text-yellow-500 animate-pulse font-bold' }
    case 'played':
      return { text: '[DONE]', className: 'text-white/20 line-through' }
    case 'playing':
      return { text: '[PLAYING]', className: 'text-red-500 font-black' }
    case 'retry_pending':
      return { text: '[RETRY PENDING]', className: 'text-orange-400 font-bold' }
    case 'error':
      return { text: '[ERROR]', className: 'text-red-400 font-bold' }
    default:
      return { text: `[${status.toUpperCase()}]`, className: 'text-white' }
  }
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m${s}s`
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

export function QueueGrid({ songs, currentSongId, onSelectSong, onOpenDetail }: QueueGridProps) {
  const sorted = [...songs].sort((a, b) => a.orderIndex - b.orderIndex)

  const activeStatuses = ['generating_metadata', 'generating_cover', 'submitting_to_ace', 'generating_audio', 'saving']
  const generating = sorted.filter((s) => activeStatuses.includes(s.status)).length
  const retryPending = sorted.filter((s) => s.status === 'retry_pending').length
  const ready = sorted.filter((s) => s.status === 'ready').length
  const played = sorted.filter((s) => s.status === 'played').length

  return (
    <div className="border-b-4 border-white/20">
      <div className="bg-black px-4 py-2 flex items-center justify-between border-b-4 border-white/20">
        <span className="text-sm font-black uppercase tracking-widest">
          QUEUE [{sorted.length} TRACKS]
        </span>
        <div className="flex gap-4 text-xs uppercase tracking-wider text-white/30">
          <span>{played} PLAYED</span>
          <span>{ready} READY</span>
          <span className="text-yellow-500">{generating} GENERATING</span>
          {retryPending > 0 && <span className="text-orange-400">{retryPending} RETRY</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
        {sorted.map((song, i) => {
          const isCurrent = song._id === currentSongId
          const isPlayed = song.status === 'played'
          const isGenerating = song.status.startsWith('generating') || song.status === 'submitting_to_ace' || song.status === 'saving'
          const status = getStatusLabel(song.status, isCurrent)

          const totalGenTime =
            song.generationStartedAt && song.generationCompletedAt
              ? song.generationCompletedAt - song.generationStartedAt
              : null

          return (
            <div
              key={song._id}
              className={`border-r-4 border-b-4 border-white/10 cursor-pointer transition-colors ${
                isCurrent
                  ? 'bg-red-950/40'
                  : isPlayed
                    ? 'opacity-30'
                    : 'bg-gray-950 hover:bg-gray-900'
              }`}
              onClick={() => {
                if (song.status === 'ready') onSelectSong(song._id)
                else onOpenDetail(song._id)
              }}
            >
              <div className="relative">
                <CoverArt
                  title={song.title}
                  artistName={song.artistName}
                  coverUrl={song.coverUrl}
                  size="sm"
                />
                <div className="absolute top-0 left-0 bg-white text-black text-xs font-black px-2 py-1">
                  {String(i + 1).padStart(2, '0')}
                </div>
                {isCurrent && (
                  <div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white text-center text-xs font-black py-1 uppercase">
                    ▶ NOW PLAYING
                  </div>
                )}
                {isGenerating && (
                  <div className="absolute bottom-0 left-0 right-0 bg-yellow-500 text-black text-center text-xs font-black py-1 uppercase flex items-center justify-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {song.status === 'generating_metadata' ? 'WRITING' :
                     song.status === 'generating_cover' ? 'COVER' :
                     song.status === 'submitting_to_ace' ? 'SUBMITTING' :
                     song.status === 'generating_audio' ? 'AUDIO' :
                     song.status === 'saving' ? 'SAVING' : 'GENERATING'}
                  </div>
                )}
                {song.status === 'retry_pending' && (
                  <div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-black text-center text-xs font-black py-1 uppercase">
                    RETRY PENDING
                  </div>
                )}
                {song.status === 'error' && (
                  <div className="absolute bottom-0 left-0 right-0 bg-red-600 text-white text-center text-xs font-black py-1 uppercase">
                    ERROR
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className={`text-xs font-black uppercase truncate ${isPlayed ? 'line-through' : ''}`}>
                  {song.title}
                </p>
                <p className="text-[10px] uppercase text-white/30 truncate">
                  {song.artistName}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <p className={`text-[10px] uppercase ${status.className}`}>
                    {status.text}
                  </p>
                  <p className="text-[10px] uppercase text-white/20">
                    {isGenerating && song.generationStartedAt ? (
                      <LiveTimer startedAt={song.generationStartedAt} />
                    ) : totalGenTime ? (
                      formatElapsed(totalGenTime)
                    ) : null}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
