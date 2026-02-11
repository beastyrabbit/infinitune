import { getServiceUrls, getSetting } from '@/lib/server-settings'

const SYSTEM_PROMPT = `You are a music producer AI. Given a music description, generate a complete song specification.

Your response must conform to the provided JSON schema. Fill in every field.

Field guidance:
- title: A creative, evocative song title
- artistName: A fictional artist/band name that fits the genre (never use real artist names)
- genre: Broad category (e.g. Rock, Electronic, Hip-Hop, Jazz, Pop, Metal, R&B, Country, Classical)
- subGenre: Specific sub-genre (e.g. Synthwave, Acid Jazz, Lo-Fi Hip-Hop, Shoegaze, Post-Punk)
- vocalStyle: Describe the vocal performance for the AI audio generator. Format: gender + vocal quality + performance style.
  Gender: male, female, duet (male+female), choir, androgynous
  Vocal quality: breathy, raspy, powerful, smooth, falsetto, gritty, husky, crystalline, airy, warm, nasal, operatic, whispered
  Performance style: soulful, energetic, intimate, passionate, anthemic, laid-back, aggressive, dreamy, playful, melancholic, defiant, tender
  Examples: "female breathy intimate vocal", "male raspy energetic vocal", "duet smooth passionate vocals", "choir powerful anthemic vocals", "female crystalline dreamy vocal", "male gritty aggressive vocal"
  MUST vary gender across songs — aim for roughly equal male/female, with occasional duets/choirs. NEVER use the same vocal gender two songs in a row.
- lyrics: Complete song lyrics. The WRITING QUALITY is critical — these must read like real songwriting, not AI filler.
  WRITING STYLE (adapt to genre):
  - Match the lyrical tradition of the genre. Prog rock = poetic, abstract, metaphor-heavy. Hip-hop = wordplay, flow, internal rhyme. Country = storytelling, concrete imagery. Pop = hooky, emotionally direct. Jazz = impressionistic, cool. Punk = raw, confrontational. Folk = narrative, observational.
  - Use SPECIFIC imagery over vague abstractions. BAD: 'the pain inside my heart'. GOOD: 'fingerprints still on the glass where you leaned that morning'.
  - Vary rhyme density by genre: some songs need tight rhyme schemes, others need almost none. Do NOT force rhymes at the expense of naturalness.
  - Vary line length and pacing. Let some lines breathe. Not every line needs to be the same length.
  - For atmospheric/introspective songs: be poetic, use metaphor, leave space, let silence matter. Avoid pop hooks.
  - For energetic/anthemic songs: use repetition strategically, build momentum, create singalong moments.
  - For narrative songs: tell a specific story with concrete details — names, places, objects, moments.
  STRUCTURE (use RICH section tags for the AI audio generator):
  Section tags with style hints: [Verse 1 - intimate], [Chorus - anthemic], [Bridge - whispered], [Verse 2 - building], [Outro - fading]
  Instrumental sections: [Guitar Solo], [Piano Interlude], [Synth Breakdown], [Drum Break], [Bass Drop]
  Dynamic markers: [Build], [Drop], [Breakdown], [Crescendo]
  Background vocals in parentheses: (ooh, aah), (harmonizing: we'll find our way), (echoing: come back)
  Use UPPERCASE for emotional intensity: "I will NOT surrender", "RISE above the noise"
  Structure should match the genre — not every song needs a pop chorus. Prog/ambient can have long verses with subtle refrains. Hip-hop can have hook + verse + bridge. Ballads can be through-composed.
  Include at least one instrumental section or bridge. Aim for 6-10 syllables per line for vocal clarity.
  IMPORTANT: Instruments mentioned in the caption MUST appear as instrumental tags in the lyrics.
- caption: A rich, multi-dimensional description of the musical style for an AI audio generator. Must include: genre/style, 2-4 specific instruments (e.g. "detuned Juno-106 pads, tight 808 kick, fingerpicked nylon guitar"), mood/atmosphere, production style (e.g. "warm analog tape saturation", "crisp digital production"), tempo feel (e.g. "swung shuffle groove", "driving four-on-the-floor"). Do NOT include vocal information here — that goes in vocalStyle. Max 400 characters.
- coverPrompt: A HIGHLY DETAILED art description for the image printed on this song's CD. Do NOT include "CD disc artwork" or similar framing — that is added automatically. Just describe the art itself. Be EXTREMELY specific and descriptive — write it like a cinematographer directing a shot. Max 600 chars.
  CRITICAL RULES:
  1. ART STYLE — Pick ONE at random, NEVER repeat across songs: expired Polaroid photo, Soviet propaganda poster, ukiyo-e woodblock print, 1970s prog rock airbrush, Alphonse Mucha art nouveau, Bauhaus geometric poster, cyberpunk manga panel, Renaissance fresco fragment, 35mm Kodachrome slide, risograph zine print, Persian miniature painting, pixel art scene, chalk pastel on black paper, thermal imaging photograph, oil painting with visible palette knife strokes, cyanotype botanical print, 1920s Art Deco poster, VHS screen capture, satellite imagery, medical illustration style, stained glass window, watercolor bleed on wet paper, vintage scientific diagram, double exposure film photograph, linocut print, glitch art corruption, daguerreotype portrait, neon sign in fog, collage of torn magazine pages, Gustave Doré engraving style, spray paint stencil on brick wall, infrared landscape photography, Dutch Golden Age still life, Wes Anderson diorama, blueprint technical drawing, Chinese ink wash painting, Polaroid transfer lift, cross-processed 35mm film, Soviet space program illustration, Aboriginal dot painting, 1950s pulp sci-fi cover, Tibetan thangka painting, solarized darkroom print
  2. SCENE — Must be a SPECIFIC, vivid, cinematic scene directly inspired by THIS song's lyrics and emotional core. Describe exact objects, their materials, textures, and spatial relationships. BAD: "a woman standing in rain". GOOD: "a woman in a moth-eaten velvet coat standing ankle-deep in a flooded ballroom, chandelier reflections rippling across the black water surface, peeling gold-leaf wallpaper curling from damp walls". Every detail should feel intentional and story-driven.
  3. MATERIALS & TEXTURES — Always specify physical qualities: "cracked leather", "oxidized copper patina", "rain-streaked glass", "sun-bleached denim", "hand-hammered brass". The viewer should almost feel the surface.
  4. LIGHTING — Be precise: "harsh tungsten overhead casting deep eye-socket shadows", "golden hour backlighting through dusty air", "cold blue fluorescent with green cast", "single candle flame throwing long wall shadows". Never just say "dramatic lighting".
  5. SURREAL ELEMENT — Include ONE unexpected detail that creates visual tension: a clock melting over a fire escape, butterflies made of sheet music, tree roots growing through a piano.
  6. COLOR PALETTE — Name 3-5 SPECIFIC pigment colors: "raw umber, viridian green, cadmium red deep, titanium white, lamp black" — NOT "warm earth tones" or "cool blues".
  7. COMPOSITION — Design for CIRCULAR framing: radial symmetry, centered subjects, spiral patterns, or edge-to-edge textures. Avoid anything that needs rectangular edges.
  8. NEVER include text, words, letters, typography, logos, or band/song names.
  Format: [art style], [detailed cinematic scene with textures and materials], [spatial relationships and depth], [surreal element], [precise lighting description], [exact pigment color palette].
- bpm: Beats per minute appropriate for the genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for drum & bass)
- keyScale: Musical key (e.g. "C major", "A minor", "F# minor", "Bb major")
- timeSignature: Time signature (usually "4/4", but "3/4" for waltzes, "6/8" for compound time, etc.)
- audioDuration: Length in seconds, between 180 and 300 (3-5 minutes)
- mood: The dominant emotional mood of the song. Pick ONE from: euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic, romantic, anxious, triumphant, serene, mysterious, rebellious, bittersweet, whimsical, haunting, empowering, contemplative, chaotic
- energy: Energy level of the song. One of: low (ballads, ambient, slow), medium (mid-tempo grooves, chill), high (upbeat, dance, driving), extreme (mosh pit, rave, breakcore)
- era: The musical era or decade this song evokes. e.g. "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "timeless", "futuristic". Pick the decade that best matches the sound and production style.
- instruments: Array of 3-5 primary instruments featured. Be specific: "Fender Rhodes", not "keyboard". "TR-808 drum machine", not "drums". "Rickenbacker 12-string guitar", not "guitar". These are the standout instruments a listener would identify.
- tags: Array of 3-5 searchable tags for the song. Mix of descriptors: atmosphere (e.g. "late-night", "summer", "rainy-day"), use case (e.g. "workout", "study", "driving", "party"), and sonic qualities (e.g. "bass-heavy", "atmospheric", "lo-fi", "orchestral", "acoustic"). Be specific and varied.
- themes: Array of 2-3 lyrical themes. e.g. "love", "heartbreak", "rebellion", "freedom", "identity", "nature", "city-life", "technology", "loss", "hope", "adventure", "social-commentary", "self-discovery", "nostalgia", "celebration"
- language: The language the lyrics are written in. e.g. "English", "German", "Spanish", "Japanese", "French", "Korean", "Portuguese", "Mixed (English/Spanish)"
- description: A short 1-2 sentence description of what this song is about — its story, vibe, and what makes it unique. Written like a music journalist's one-liner. e.g. "A defiant anthem about breaking free from small-town expectations, wrapped in fuzzy garage rock and shouted choruses", "Dreamy late-night confession over warm Rhodes chords and tape-hiss, exploring the ache of distance in a long-distance relationship". Max 200 chars.

Rules:
- JSON OUTPUT: NEVER use double-quote characters (") inside any string value — use single quotes (') instead. All newlines in lyrics must be escaped as \\n. Output must be valid JSON.
- Be WILDLY creative and varied — you are generating songs for a continuous playlist, so every song MUST feel distinct from the last. Vary the artist names, genres, moods, tempos, lyrical themes, and visual styles aggressively.
- GENRE EXPLORATION: The user's description is a STARTING POINT, not a constraint. Actively explore ADJACENT and TANGENTIAL genres. If the description says "2000s German pop", you should absolutely create: German hip-hop, Neue Deutsche Welle, pop-country with German lyrics, electronic Schlager, German indie rock, Lo-Fi beats with German samples, German jazz fusion, Krautrock revival, German musical theater pop, etc. Think of the description as a center point on a musical map — each song should venture further from the center in a different direction.
- NEVER generate two songs in the same sub-genre in a row. If the previous songs were all Pop, switch to Rock, Electronic, Hip-Hop, or something completely unexpected.
- VOCAL DIVERSITY: NEVER use the same vocal gender two songs in a row. If the last song had a male vocal, the next MUST be female, duet, or choir (and vice versa). Check the recent songs list for the last vocal style used.
- genre should be a broad category, subGenre should be specific and WILDLY different each time — explore the entire musical spectrum
- Vary BPM dramatically: mix ballads (65-80), mid-tempo grooves (90-110), upbeat dance (120-135), and high-energy bangers (140-180)
- Vary mood: alternate between euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic
- For coverPrompt: you MUST pick a DIFFERENT art style every time. If you've been generating synth-pop, don't keep using neon/cyberpunk visuals — try botanical prints, oil paintings, satellite imagery, etc.`

const SONG_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Song title' },
    artistName: { type: 'string', description: 'Fictional artist name' },
    genre: { type: 'string', description: 'Main genre' },
    subGenre: { type: 'string', description: 'Specific sub-genre' },
    vocalStyle: { type: 'string', description: 'Vocal description: gender + quality + style, e.g. "female breathy intimate vocal"' },
    lyrics: { type: 'string', description: 'Full song lyrics with rich section tags like [Verse 1 - intimate], [Chorus - anthemic], instrumental sections, and dynamic markers' },
    caption: { type: 'string', description: 'Audio generation caption with genre, 2-4 specific instruments, mood, production style, tempo feel. No vocals. Max 400 chars.' },
    coverPrompt: { type: 'string', description: 'Art description only — do NOT include CD/disc framing (added automatically). Include: art style from pool, cinematic scene with specific materials/textures, spatial depth, surreal element, precise lighting, exact pigment color palette. Circular composition. No text/typography. Max 600 chars.' },
    bpm: { type: 'number', description: 'Beats per minute (60-200)' },
    keyScale: { type: 'string', description: 'Musical key, e.g. "C major"' },
    timeSignature: { type: 'string', description: 'Time signature, e.g. "4/4"' },
    audioDuration: { type: 'number', description: 'Duration in seconds (180-300)' },
    mood: { type: 'string', description: 'Dominant mood: euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic, romantic, anxious, triumphant, serene, mysterious, rebellious, bittersweet, whimsical, haunting, empowering, contemplative, chaotic' },
    energy: { type: 'string', description: 'Energy level: low, medium, high, extreme' },
    era: { type: 'string', description: 'Musical era/decade: 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s, timeless, futuristic' },
    instruments: { type: 'array', items: { type: 'string' }, description: '3-5 specific instruments featured, e.g. "Fender Rhodes", "TR-808 drum machine"' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5 searchable tags mixing atmosphere, use case, sonic quality' },
    themes: { type: 'array', items: { type: 'string' }, description: '2-3 lyrical themes, e.g. "love", "rebellion", "nostalgia"' },
    language: { type: 'string', description: 'Language of the lyrics, e.g. "English", "German", "Mixed (English/Spanish)"' },
    description: { type: 'string', description: 'Short 1-2 sentence music journalist description of the song story/vibe. Max 200 chars.' },
  },
  required: ['title', 'artistName', 'genre', 'subGenre', 'vocalStyle', 'lyrics', 'caption', 'coverPrompt', 'bpm', 'keyScale', 'timeSignature', 'audioDuration', 'mood', 'energy', 'era', 'instruments', 'tags', 'themes', 'language', 'description'],
}

export { SYSTEM_PROMPT, SONG_SCHEMA }

export interface SongMetadata {
  title: string
  artistName: string
  genre: string
  subGenre: string
  vocalStyle: string
  lyrics: string
  caption: string
  coverPrompt?: string
  bpm: number
  keyScale: string
  timeSignature: string
  audioDuration: number
  mood: string
  energy: string
  era: string
  instruments: string[]
  tags: string[]
  themes: string[]
  language: string
  description: string
}

export interface RecentSong {
  title: string
  artistName: string
  genre: string
  subGenre: string
  vocalStyle?: string
  mood?: string
  energy?: string
}

/** Repair common LLM JSON output issues: unescaped control chars, markdown artifacts, internal quotes */
function repairJson(raw: string): string {
  // Strip markdown bold/italic markers that some LLMs inject
  let s = raw.replace(/\*\*/g, '')

  // Walk character-by-character to fix issues inside JSON strings
  let result = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]

    if (escaped) {
      result += ch
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      result += ch
      escaped = true
      continue
    }

    if (ch === '"') {
      if (!inString) {
        inString = true
        result += ch
      } else {
        // Determine if this quote ends the string or is an unescaped internal quote
        // Look ahead: if next non-whitespace is a JSON structural char, it's the real end
        let j = i + 1
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r' || s[j] === '\n')) j++
        const next = s[j]
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
          inString = false
          result += ch
        } else {
          // Internal quote — escape it
          result += '\\"'
        }
      }
      continue
    }

    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
    }

    result += ch
  }

  return result
}

export async function generateSongMetadata(options: {
  prompt: string
  provider: 'ollama' | 'openrouter'
  model: string
  lyricsLanguage?: string
  targetBpm?: number
  targetKey?: string
  timeSignature?: string
  audioDuration?: number
  recentSongs?: RecentSong[]
  recentDescriptions?: string[]
  isInterrupt?: boolean
  signal?: AbortSignal
}): Promise<SongMetadata> {
  const { prompt, provider, model, lyricsLanguage, targetBpm, targetKey, timeSignature, audioDuration, recentSongs, recentDescriptions, isInterrupt, signal } = options

  let systemPrompt = SYSTEM_PROMPT

  if (isInterrupt) {
    // Prepend faithful-mode instructions
    const faithfulPrefix = `IMPORTANT: This is a SPECIFIC user request. Follow the user's description FAITHFULLY.
If they reference a specific song, style, or concept — your output MUST match that.
Do NOT deviate to unrelated genres. Be creative within the bounds of what was asked.\n\n`
    // Remove the "be WILDLY creative" and "explore ADJACENT genres" directives for interrupt songs
    systemPrompt = systemPrompt
      .replace(/- Be WILDLY creative and varied —[^\n]*\n/g, '')
      .replace(/- GENRE EXPLORATION:[^\n]*\n/g, '')
    systemPrompt = faithfulPrefix + systemPrompt
  }
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

  // Build user message with recent song history for diversity
  let userMessage = prompt
  if (recentSongs && recentSongs.length > 0) {
    const historyLines = recentSongs.map(
      (s, i) => `  ${i + 1}. "${s.title}" by ${s.artistName} — ${s.genre} / ${s.subGenre}${s.vocalStyle ? ` (${s.vocalStyle})` : ''}${s.mood ? ` [${s.mood}]` : ''}${s.energy ? ` {${s.energy}}` : ''}`
    ).join('\n')

    // Extract banned values for explicit prohibition
    const bannedTitles = recentSongs.map((s) => s.title)
    const bannedArtists = recentSongs.map((s) => s.artistName)
    const recentGenres = [...new Set(recentSongs.slice(0, 5).map((s) => s.genre))]
    const lastVocal = recentSongs[0]?.vocalStyle

    userMessage += `\n\n--- RECENT SONGS (DO NOT REPEAT ANY OF THESE) ---\n${historyLines}`
    userMessage += `\n\nBANNED TITLES (you MUST NOT use any of these): ${bannedTitles.map((t) => `"${t}"`).join(', ')}`
    userMessage += `\nBANNED ARTIST NAMES (you MUST NOT reuse any of these): ${bannedArtists.map((a) => `"${a}"`).join(', ')}`
    userMessage += `\nBANNED GENRES for this song (recently overused): ${recentGenres.join(', ')}`
    const recentMoods = [...new Set(recentSongs.slice(0, 3).map((s) => s.mood).filter(Boolean))]
    if (recentMoods.length > 0) {
      userMessage += `\nRECENT MOODS (avoid repeating): ${recentMoods.join(', ')}`
    }
    if (lastVocal) {
      userMessage += `\nLAST VOCAL STYLE WAS: "${lastVocal}" — you MUST use a DIFFERENT vocal gender and style`
    }
    userMessage += `\n\nGenerate something COMPLETELY DIFFERENT from all of the above. Pick an entirely new genre, new mood, new energy level, new artist identity. SURPRISE me.`
  }

  // Append broader description history for thematic diversity (beyond the 5 full songs)
  if (recentDescriptions && recentDescriptions.length > 0) {
    userMessage += `\n\n--- RECENT SONG DESCRIPTIONS (avoid similar themes/stories) ---\n${recentDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`
    userMessage += `\nYour new song's story and theme MUST be completely different from ALL of these.`
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
          { role: 'user', content: userMessage },
        ],
        temperature: 1.0,
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
          { role: 'user', content: userMessage },
        ],
        stream: false,
        format: SONG_SCHEMA,
        think: false,
        keep_alive: '10m',
        options: { temperature: 1.0, seed: Math.floor(Math.random() * 2147483647) },
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

  jsonStr = repairJson(jsonStr)

  const songData = JSON.parse(jsonStr) as SongMetadata

  if (targetBpm && targetBpm >= 60 && targetBpm <= 220) {
    songData.bpm = targetBpm
  }

  return songData
}
