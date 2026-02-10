import { writeFile, mkdir } from "node:fs/promises";

// ─── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_URL = "http://192.168.10.120:11434";

const MODELS = [
  { name: "granite4:latest", params: "3.4B", tier: "tiny" },
  { name: "gemma3:4b", params: "4.3B", tier: "tiny" },
  { name: "mistral:7b", params: "7.2B", tier: "small" },
  { name: "qwen3:8b", params: "8.2B", tier: "small", promptPrefix: "/nothink\n", label: "qwen3:8b (no-think)" },
  { name: "qwen3:8b", params: "8.2B", tier: "small", promptPrefix: "/think\n", label: "qwen3:8b (think)" },
  { name: "ministral-3:14b", params: "13.9B", tier: "medium" },
  { name: "gpt-oss:20b", params: "20.9B", tier: "medium" },
  { name: "gemma3:27b", params: "27.4B", tier: "large" },
  { name: "qwen3-coder:30b", params: "30.5B", tier: "large", promptPrefix: "/nothink\n", label: "qwen3-coder:30b (no-think)" },
  { name: "qwen3-coder:30b", params: "30.5B", tier: "large", promptPrefix: "/think\n", label: "qwen3-coder:30b (think)" },
  { name: "deepseek-r1:32b", params: "32.8B", tier: "large" },
  { name: "qwen3:32b", params: "32.8B", tier: "large", promptPrefix: "/nothink\n", label: "qwen3:32b (no-think)" },
  { name: "qwen3:32b", params: "32.8B", tier: "large", promptPrefix: "/think\n", label: "qwen3:32b (think)" },
  { name: "gpt-oss:120b", params: "116.8B", tier: "huge" },
  { name: "gpt-oss-safeguard:120b", params: "116.8B", tier: "huge" },
] as const;

const TIMEOUT_MS: Record<string, number> = {
  tiny: 3 * 60_000,
  small: 3 * 60_000,
  medium: 5 * 60_000,
  large: 5 * 60_000,
  huge: 15 * 60_000,
};

const GENERATION_PROMPT = `Write complete song lyrics for an indie folk-rock song about "A bittersweet farewell to a childhood home being demolished."

Requirements:
- Give the song a title at the top
- Use section markers: [Verse 1], [Verse 2], [Chorus], [Bridge], [Outro], etc.
- Include vivid sensory imagery (sounds, smells, textures, light)
- Convey deep emotional resonance — the ache of losing a place that shaped you
- Include at least one unexpected or striking metaphor
- The bridge should shift from grief to gratitude
- Aim for 3-4 verses, a repeating chorus, a bridge, and an outro
- Write lyrics only — no explanations, no commentary`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModelConfig {
  name: string;
  params: string;
  tier: string;
  promptPrefix?: string;
  label?: string;
}

interface GenerationResult {
  model: string;
  label: string;
  params: string;
  tier: string;
  lyrics: string;
  thinkingContent?: string;
  ttftMs: number;
  totalTimeMs: number;
  modelLoadTimeMs: number;
  tokenCount: number;
  tokensPerSec: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

function stripThinkingTags(text: string): { clean: string; thinking?: string } {
  const match = text.match(/<think>([\s\S]*?)<\/think>/);
  if (!match) return { clean: text };
  return {
    clean: text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim(),
    thinking: match[1].trim(),
  };
}

// ─── Generation ──────────────────────────────────────────────────────────────

async function generateLyrics(
  model: ModelConfig
): Promise<GenerationResult> {
  const timeoutMs = TIMEOUT_MS[model.tier];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const displayLabel = model.label || model.name;
  const prompt = (model.promptPrefix || "") + GENERATION_PROMPT;

  const startTime = performance.now();
  let ttftMs = 0;
  let fullResponse = "";
  let modelLoadTimeMs = 0;
  let tokenCount = 0;
  let tokensPerSec = 0;
  let firstTokenReceived = false;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.name,
        prompt,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: 2048,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);

          if (!firstTokenReceived && chunk.response) {
            ttftMs = performance.now() - startTime;
            firstTokenReceived = true;
          }

          if (chunk.response) {
            fullResponse += chunk.response;
          }

          if (chunk.done) {
            modelLoadTimeMs = chunk.load_duration
              ? chunk.load_duration / 1e6
              : 0;
            tokenCount = chunk.eval_count || 0;
            const evalDurationMs = chunk.eval_duration
              ? chunk.eval_duration / 1e6
              : 0;
            tokensPerSec =
              evalDurationMs > 0 ? (tokenCount / evalDurationMs) * 1000 : 0;
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return {
        model: model.name,
        label: displayLabel,
        params: model.params,
        tier: model.tier,
        lyrics: "",
        ttftMs: 0,
        totalTimeMs: performance.now() - startTime,
        modelLoadTimeMs: 0,
        tokenCount: 0,
        tokensPerSec: 0,
        error: `Timeout after ${formatDuration(timeoutMs)}`,
      };
    }
    return {
      model: model.name,
      label: displayLabel,
      params: model.params,
      tier: model.tier,
      lyrics: "",
      ttftMs: 0,
      totalTimeMs: performance.now() - startTime,
      modelLoadTimeMs: 0,
      tokenCount: 0,
      tokensPerSec: 0,
      error: err.message,
    };
  }

  clearTimeout(timeout);
  const totalTimeMs = performance.now() - startTime;

  // Handle deepseek-r1 thinking tags
  const { clean, thinking } = stripThinkingTags(fullResponse);

  return {
    model: model.name,
    label: displayLabel,
    params: model.params,
    tier: model.tier,
    lyrics: clean,
    ...(thinking && { thinkingContent: thinking }),
    ttftMs,
    totalTimeMs,
    modelLoadTimeMs,
    tokenCount,
    tokensPerSec,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("# Ollama Lyrics Benchmark\n");
  log(`Ollama endpoint: ${OLLAMA_URL}`);
  log(`Models to test: ${MODELS.length}`);
  log(`Judging: will be done externally by Claude Opus 4.6`);

  // Verify Ollama is reachable
  try {
    const ping = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
    const tags = await ping.json();
    log(`Ollama is reachable — ${tags.models?.length ?? 0} models available`);
  } catch (err: any) {
    console.error(`Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}`);
    process.exit(1);
  }

  const results: GenerationResult[] = [];
  const startAll = performance.now();

  console.log("\n---\n## Generation\n");

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const displayLabel = model.label || model.name;
    log(
      `[${i + 1}/${MODELS.length}] Generating with ${displayLabel} (${model.params}, tier: ${model.tier})...`
    );
    const gen = await generateLyrics(model as ModelConfig);

    if (gen.error) {
      log(`  FAILED: ${gen.error}`);
    } else {
      log(
        `  OK — ${gen.tokenCount} tokens in ${formatDuration(gen.totalTimeMs)} (${gen.tokensPerSec.toFixed(1)} tok/s, TTFT: ${formatDuration(gen.ttftMs)})`
      );
    }

    results.push(gen);
  }

  // Report
  const totalElapsed = performance.now() - startAll;
  console.log("\n---\n## Performance Metrics\n");
  log(`Total benchmark time: ${formatDuration(totalElapsed)}`);

  console.log(
    "| Model | Params | TTFT | Total Time | Model Load | Tokens | Tok/s | Status |"
  );
  console.log(
    "|-------|--------|------|------------|------------|--------|-------|--------|"
  );

  for (const g of results) {
    if (g.error) {
      console.log(
        `| ${g.label} | ${g.params} | — | ${formatDuration(g.totalTimeMs)} | — | — | — | ${g.error} |`
      );
    } else {
      console.log(
        `| ${g.label} | ${g.params} | ${formatDuration(g.ttftMs)} | ${formatDuration(g.totalTimeMs)} | ${formatDuration(g.modelLoadTimeMs)} | ${g.tokenCount} | ${g.tokensPerSec.toFixed(1)} | OK |`
      );
    }
  }

  // Save full results to JSON
  await mkdir("scripts/results", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `scripts/results/benchmark-${timestamp}.json`;

  const output = {
    timestamp: new Date().toISOString(),
    ollamaUrl: OLLAMA_URL,
    prompt: GENERATION_PROMPT,
    totalElapsedMs: totalElapsed,
    results: results.map((g) => ({
      model: g.model,
      label: g.label,
      params: g.params,
      tier: g.tier,
      lyrics: g.lyrics,
      thinkingContent: g.thinkingContent,
      ttftMs: g.ttftMs,
      totalTimeMs: g.totalTimeMs,
      modelLoadTimeMs: g.modelLoadTimeMs,
      tokenCount: g.tokenCount,
      tokensPerSec: g.tokensPerSec,
      error: g.error,
    })),
  };

  await writeFile(outPath, JSON.stringify(output, null, 2));
  log(`Full results saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
