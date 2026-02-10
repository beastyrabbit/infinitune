import { getServiceUrls, getSetting } from '@/lib/server-settings'

const SYSTEM_PROMPT = `You are a music producer AI. Given a music description, generate a complete song specification.

Your response must conform to the provided JSON schema. Fill in every field.

Field guidance:
- title: A creative, evocative song title
- artistName: A fictional artist/band name that fits the genre (never use real artist names)
- genre: Broad category (e.g. Rock, Electronic, Hip-Hop, Jazz, Pop, Metal, R&B, Country, Classical)
- subGenre: Specific sub-genre (e.g. Synthwave, Acid Jazz, Lo-Fi Hip-Hop, Shoegaze, Post-Punk)
- lyrics: Complete song lyrics with structural markers like [Verse 1], [Chorus], [Bridge], [Outro]. Include at least 2 verses and a chorus. Lyrics should match the mood and genre.
- caption: A concise description of the musical style for an AI audio generator — instruments, mood, tempo feel, production style. Max 200 characters.
- coverPrompt: A direct image generation prompt for album cover art. CRITICAL RULES FOR VARIATION:
  1. NEVER repeat the same art style across songs. Pick ONE from this pool AT RANDOM — do NOT favor any: expired Polaroid photo, Soviet propaganda poster, ukiyo-e woodblock print, 1970s prog rock airbrush, Alphonse Mucha art nouveau, Bauhaus geometric poster, cyberpunk manga panel, Renaissance fresco fragment, 35mm Kodachrome slide, risograph zine print, Persian miniature painting, pixel art scene, chalk pastel on black paper, architectural blueprint overlay, thermal imaging photograph, oil painting with visible palette knife strokes, cyanotype botanical print, 1920s Art Deco poster, VHS screen capture, satellite imagery, medical illustration style, stained glass window, brutalist concrete photography, watercolor bleed on wet paper, vintage scientific diagram, double exposure film photograph, linocut print, glitch art corruption, daguerreotype portrait, neon sign in fog, collage of torn magazine pages, Gustave Doré engraving style, spray paint stencil on brick wall, infrared landscape photography
  2. The SUBJECT must be a vivid, specific scene inspired by the song's lyrics/mood — NOT generic "person with headphones" or "abstract waves". Think: a flooded cathedral with fish swimming through pews, a grandmother's kitchen table covered in star maps, two astronauts slow-dancing on a derelict space station, a fox wearing a crown sleeping in a field of satellite dishes
  3. Include ONE unexpected/surreal element that doesn't literally match the genre (a classical piece could have cyberpunk visuals, a punk song could have delicate botanical art)
  4. Specify a CONCRETE color palette — not "warm colors" but "burnt sienna, cadmium yellow, lamp black"
  5. NEVER include text, words, letters, typography, or band/song names
  Format: "[art style], [specific vivid scene], [surreal detail], [lighting], [exact color palette]". Max 400 chars.
- bpm: Beats per minute appropriate for the genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for drum & bass)
- keyScale: Musical key (e.g. "C major", "A minor", "F# minor", "Bb major")
- timeSignature: Time signature (usually "4/4", but "3/4" for waltzes, "6/8" for compound time, etc.)
- audioDuration: Length in seconds, between 180 and 300 (3-5 minutes)

Rules:
- Be WILDLY creative and varied — you are generating songs for a continuous playlist, so every song MUST feel distinct from the last. Vary the artist names, genres, moods, tempos, lyrical themes, and visual styles aggressively.
- Match the overall vibe to the user's description but interpret it broadly — find different angles, subgenres, and emotional facets each time
- genre should be a broad category, subGenre should be specific and different each time
- For coverPrompt: you MUST pick a DIFFERENT art style every time. If you've been generating synth-pop, don't keep using neon/cyberpunk visuals — try botanical prints, oil paintings, satellite imagery, etc.`

const SONG_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Song title' },
    artistName: { type: 'string', description: 'Fictional artist name' },
    genre: { type: 'string', description: 'Main genre' },
    subGenre: { type: 'string', description: 'Specific sub-genre' },
    lyrics: { type: 'string', description: 'Full song lyrics with [Verse 1], [Chorus], etc.' },
    caption: { type: 'string', description: 'Audio generation caption, max 200 chars' },
    coverPrompt: { type: 'string', description: 'Album cover image prompt. Use a unique art style each time from the pool in the system prompt. Vivid specific scene with one surreal element, concrete color palette. No text/words/typography. Max 400 chars.' },
    bpm: { type: 'number', description: 'Beats per minute (60-200)' },
    keyScale: { type: 'string', description: 'Musical key, e.g. "C major"' },
    timeSignature: { type: 'string', description: 'Time signature, e.g. "4/4"' },
    audioDuration: { type: 'number', description: 'Duration in seconds (180-300)' },
  },
  required: ['title', 'artistName', 'genre', 'subGenre', 'lyrics', 'caption', 'coverPrompt', 'bpm', 'keyScale', 'timeSignature', 'audioDuration'],
}

export { SYSTEM_PROMPT, SONG_SCHEMA }

export interface SongMetadata {
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
}

export async function generateSongMetadata(options: {
  prompt: string
  provider: string
  model: string
  lyricsLanguage?: string
  targetBpm?: number
  targetKey?: string
  timeSignature?: string
  audioDuration?: number
  signal?: AbortSignal
}): Promise<SongMetadata> {
  const { prompt, provider, model, lyricsLanguage, targetBpm, targetKey, timeSignature, audioDuration, signal } = options

  let systemPrompt = SYSTEM_PROMPT
  if (lyricsLanguage && lyricsLanguage !== 'auto') {
    systemPrompt += `\n\nIMPORTANT: Write ALL lyrics in ${lyricsLanguage.charAt(0).toUpperCase() + lyricsLanguage.slice(1)}.`
  }
  if (targetKey) {
    systemPrompt += `\n\nUse the musical key: ${targetKey}.`
  }
  if (timeSignature) {
    systemPrompt += `\n\nUse time signature: ${timeSignature}.`
  }
  if (audioDuration) {
    systemPrompt += `\n\nTarget audio duration: ${audioDuration} seconds.`
  }

  let fullText: string

  if (provider === 'openrouter') {
    const apiKey = (await getSetting('openrouterApiKey')) || process.env.OPENROUTER_API_KEY || ''
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'song_specification',
            strict: true,
            schema: SONG_SCHEMA,
          },
        },
      }),
      signal,
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`OpenRouter error ${res.status}: ${errText}`)
    }
    const data = await res.json()
    fullText = data.choices?.[0]?.message?.content || ''
  } else {
    const urls = await getServiceUrls()
    const ollamaUrl = urls.ollamaUrl
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        format: SONG_SCHEMA,
        think: false,
        keep_alive: '10m',
        options: { temperature: 1.0 },
      }),
      signal,
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Ollama error ${res.status}: ${errText}`)
    }
    const data = await res.json()
    fullText = data.message?.content || ''
  }

  let jsonStr = fullText.trim()
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  const songData = JSON.parse(jsonStr) as SongMetadata

  if (targetBpm && targetBpm >= 60 && targetBpm <= 220) {
    songData.bpm = targetBpm
  }

  return songData
}
