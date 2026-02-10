import { Loader2 } from 'lucide-react'

interface Song {
  _id: string
  title: string
  status: string
  orderIndex: number
}

interface GenerationBannerProps {
  songs: Song[]
}

export function GenerationBanner({ songs }: GenerationBannerProps) {
  const activeStatuses = [
    'generating_metadata',
    'submitting_to_ace',
    'generating_audio',
    'saving',
    'retry_pending',
  ]

  const generating = songs.filter((s) => activeStatuses.includes(s.status))

  if (generating.length === 0) return null

  const current = generating[0]
  const statusMap: Record<string, string> = {
    generating_metadata: 'STEP 1/4 — WRITING LYRICS & METADATA',
    submitting_to_ace: 'STEP 2/4 — SUBMITTING TO ENGINE + COVER ART',
    generating_audio: 'STEP 3/4 — AUDIO SYNTHESIS IN PROGRESS',
    saving: 'STEP 4/4 — SAVING TO LIBRARY',
    retry_pending: 'WAITING TO RETRY',
  }
  const statusText = statusMap[current.status] || current.status.toUpperCase()

  return (
    <div className="border-b-4 border-white/20 bg-yellow-500 px-4 py-3 flex items-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-black" />
      <span className="animate-pulse text-sm sm:text-base font-black uppercase tracking-wider text-black">
        &gt;&gt;&gt; GENERATING TRACK{' '}
        {String(Math.round(current.orderIndex)).padStart(2, '0')} &lt;&lt;&lt;
      </span>
      <span className="ml-auto text-xs font-bold uppercase text-black/60 hidden sm:inline">
        {statusText}
        {generating.length > 1 && ` | +${generating.length - 1} QUEUED`}
      </span>
    </div>
  )
}
