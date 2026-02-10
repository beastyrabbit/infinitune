import { createFileRoute } from '@tanstack/react-router'
import { getServiceUrls } from '@/lib/server-settings'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const Route = createFileRoute('/api/autoplayer/save-song')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const {
            songId,
            title,
            artistName,
            genre,
            subGenre,
            lyrics,
            caption,
            coverPrompt,
            bpm,
            keyScale,
            timeSignature,
            audioDuration,
            aceAudioPath,
            coverBase64,
          } = body as {
            songId: string
            title: string
            artistName: string
            genre: string
            subGenre: string
            lyrics: string
            caption: string
            coverPrompt?: string
            bpm: number
            keyScale: string
            timeSignature: string
            audioDuration: number
            aceAudioPath: string
            coverBase64?: string
          }

          const urls = await getServiceUrls()
          const aceUrl = urls.aceStepUrl
          const storagePath = process.env.MUSIC_STORAGE_PATH || '/mnt/music/autoplayer'

          // Sanitize names for filesystem
          const sanitize = (s: string) =>
            s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()

          const genreDir = sanitize(genre)
          const subGenreDir = sanitize(subGenre)
          const songFolder = sanitize(`${artistName} - ${title}`)

          // Build folder path: $MUSIC_STORAGE_PATH/{Genre}/{SubGenre}/{ArtistName} - {SongTitle}/
          const songDir = path.join(storagePath, genreDir, subGenreDir, songFolder)
          fs.mkdirSync(songDir, { recursive: true })

          // Also create an ID-based symlink for quick lookup
          const byIdDir = path.join(storagePath, '.by-id')
          fs.mkdirSync(byIdDir, { recursive: true })
          const idLink = path.join(byIdDir, songId)
          try {
            if (fs.existsSync(idLink)) fs.unlinkSync(idLink)
            fs.symlinkSync(songDir, idLink)
          } catch {
            // Symlinks may not work on all filesystems — copy path instead
            fs.writeFileSync(idLink, songDir)
          }

          // Download audio from ACE-Step
          const audioUrl = `${aceUrl}${aceAudioPath}`
          const audioResponse = await fetch(audioUrl)
          if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.status}`)
          }
          const audioBuffer = Buffer.from(await audioResponse.arrayBuffer())
          const audioFile = path.join(songDir, 'audio.mp3')
          fs.writeFileSync(audioFile, audioBuffer)

          // Save cover art if available
          if (coverBase64) {
            const coverBuffer = Buffer.from(coverBase64, 'base64')
            fs.writeFileSync(path.join(songDir, 'cover.png'), coverBuffer)
          }

          // Save lyrics
          fs.writeFileSync(path.join(songDir, 'lyrics.txt'), lyrics)

          // Save generation log
          const log = {
            songId,
            title,
            artistName,
            genre,
            subGenre,
            caption,
            coverPrompt,
            bpm,
            keyScale,
            timeSignature,
            audioDuration,
            aceAudioPath,
            generatedAt: new Date().toISOString(),
          }
          fs.writeFileSync(
            path.join(songDir, 'generation.log'),
            JSON.stringify(log, null, 2),
          )

          return new Response(
            JSON.stringify({
              storagePath: songDir,
              audioFile,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message || 'Failed to save song' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
