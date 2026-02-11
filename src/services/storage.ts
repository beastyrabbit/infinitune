import { getServiceUrls } from '@/lib/server-settings'
import * as fs from 'node:fs'
import * as path from 'node:path'

export async function saveSongToNfs(options: {
  songId: string
  title: string
  artistName: string
  genre: string
  subGenre: string
  lyrics: string
  caption: string
  vocalStyle?: string
  coverPrompt?: string
  mood?: string
  energy?: string
  era?: string
  instruments?: string[]
  tags?: string[]
  themes?: string[]
  language?: string
  bpm: number
  keyScale: string
  timeSignature: string
  audioDuration: number
  aceAudioPath: string
  coverBase64?: string | null
}): Promise<{ storagePath: string; audioFile: string }> {
  const {
    songId, title, artistName, genre, subGenre,
    lyrics, caption, vocalStyle, coverPrompt,
    mood, energy, era, instruments, tags, themes, language,
    bpm, keyScale, timeSignature, audioDuration, aceAudioPath, coverBase64,
  } = options

  const urls = await getServiceUrls()
  const aceUrl = urls.aceStepUrl
  const storagePath = process.env.MUSIC_STORAGE_PATH || '/mnt/music/autoplayer'

  const sanitize = (s: string) =>
    s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim()

  const genreDir = sanitize(genre)
  const subGenreDir = sanitize(subGenre)
  const songFolder = sanitize(`${artistName} - ${title}`)

  const songDir = path.join(storagePath, genreDir, subGenreDir, songFolder)
  fs.mkdirSync(songDir, { recursive: true })

  const byIdDir = path.join(storagePath, '.by-id')
  fs.mkdirSync(byIdDir, { recursive: true })
  const idLink = path.join(byIdDir, songId)
  try {
    if (fs.existsSync(idLink)) fs.unlinkSync(idLink)
    fs.symlinkSync(songDir, idLink)
  } catch {
    fs.writeFileSync(idLink, songDir)
  }

  const audioUrl = `${aceUrl}${aceAudioPath}`
  const audioResponse = await fetch(audioUrl)
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`)
  }
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer())
  const audioFile = path.join(songDir, 'audio.mp3')
  fs.writeFileSync(audioFile, audioBuffer)

  if (coverBase64) {
    const coverBuffer = Buffer.from(coverBase64, 'base64')
    fs.writeFileSync(path.join(songDir, 'cover.png'), coverBuffer)
  }

  fs.writeFileSync(path.join(songDir, 'lyrics.txt'), lyrics)

  const log = {
    songId, title, artistName, genre, subGenre, caption, vocalStyle, coverPrompt,
    mood, energy, era, instruments, tags, themes, language,
    bpm, keyScale, timeSignature, audioDuration, aceAudioPath,
    generatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(songDir, 'generation.log'), JSON.stringify(log, null, 2))

  return { storagePath: songDir, audioFile }
}
