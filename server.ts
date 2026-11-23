import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const POLLINATIONS_API_URL = 'https://text.pollinations.ai/openai';
const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

const FAST_SEEKER_MODEL = 'google/gemini-2.5-flash-lite';
const FAST_SKEPTIC_MODEL = 'openai/gpt-4o-mini';

const rawSeekerEnv = process.env.SEEKER_MODEL?.trim() || '';
const rawSkepticEnv = process.env.SKEPTIC_MODEL?.trim() || '';
const DEFAULT_SEEKER_MODEL =
  rawSeekerEnv && !rawSeekerEnv.endsWith(':free') ? rawSeekerEnv : FAST_SEEKER_MODEL;
const DEFAULT_SKEPTIC_MODEL =
  rawSkepticEnv && !rawSkepticEnv.endsWith(':free') ? rawSkepticEnv : FAST_SKEPTIC_MODEL;

const MODEL_ID_REGEX = /^[a-zA-Z0-9._:/-]+$/;

// Short OpenRouter rate-limit/credit cooldown so 'auto' recovers quickly instead of locking out for 10m
let openRouterCooldownUntil = 0;

let selfitCooldownUntil = 0;
let zeroGpuCooldownUntil = 0;

let cachedBidenRefFile: {
  path: string;
  url: string;
  orig_name: string;
  mime_type: string;
  meta: { _type: string };
} | null = null;
let bidenRefUploadedAt = 0;

let cachedTrumpRefFile: {
  path: string;
  url: string;
  orig_name: string;
  mime_type: string;
  meta: { _type: string };
} | null = null;
let trumpRefUploadedAt = 0;

// Cached daily headlines (refreshed every 30 minutes)
let cachedHeadlines: string[] = [];
let headlinesFetchedAt = 0;

type AgentRole = 'seeker' | 'skeptic' | 'trump' | 'biden';

interface TurnHistoryItem {
  agent: AgentRole;
  content: string;
}

interface TurnRequestBody {
  agent: AgentRole;
  aiProvider?: 'auto' | 'openrouter' | 'free-relay';
  model?: string;
  systemPrompt?: string;
  summary?: string;
  history?: TurnHistoryItem[];
  temperature?: number;
  maxTokens?: number;
  topic?: string;
  observerQuestion?: string;
  observerStage?: 'alien_first' | 'skeptic_second';
  chaosDirective?: string;
  autonomousEvolution?: boolean;
  turnNumber?: number;
  castMode?: 'duo' | 'trump-biden' | 'trump-only';
}

interface SummarizeRequestBody {
  aiProvider?: 'auto' | 'openrouter' | 'free-relay';
  model?: string;
  previousSummary?: string;
  turns: TurnHistoryItem[];
}

function getApiKey(): string {
  return process.env.OPENROUTER_API_KEY?.trim() || '';
}

function getAppReferer(): string {
  return process.env.APP_URL?.trim() || `http://localhost:${PORT}`;
}

function sanitizeModel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 140 || !MODEL_ID_REGEX.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampToMaxSentences(raw: string, maxSentences = 6): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const sentenceMatches = clean.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g);
  if (!sentenceMatches) return clean;

  const trimmed = sentenceMatches.map((s) => s.trim()).filter(Boolean);
  if (trimmed.length <= maxSentences) {
    return clean;
  }
  return trimmed.slice(0, maxSentences).join(' ');
}

function countSentences(raw: string): number {
  const matches = raw.match(/[^.!?…]+[.!?…]+(?=\s|$)/g);
  return matches ? matches.length : 0;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

interface CategorizedHeadlines {
  general: string[];
  ai: string[];
  movies: string[];
  games: string[];
}

let cachedCategorizedHeadlines: CategorizedHeadlines = { general: [], ai: [], movies: [], games: [] };
let categorizedFetchedAt = 0;

const AI_NEWS_RSS_URL = 'https://news.google.com/rss/search?q=artificial+intelligence+AI+tech+model+openai&hl=en-US&gl=US&ceid=US:en';
const MOVIES_RSS_URL = 'https://news.google.com/rss/search?q=upcoming+movies+film+trailer+release&hl=en-US&gl=US&ceid=US:en';
const GAMES_RSS_URL = 'https://news.google.com/rss/search?q=video+games+gaming+releases+playstation+xbox+nintendo&hl=en-US&gl=US&ceid=US:en';

async function fetchRssTitles(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'EternalDialogue/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed: string[] = [];
    for (const match of xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)) {
      const cleaned = decodeXmlEntities(match[1])
        .replace(/\s+-\s+[^-]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned && cleaned.length >= 10 && cleaned.length <= 160) {
        parsed.push(cleaned);
      }
      if (parsed.length >= 8) break;
    }
    return parsed;
  } catch {
    return [];
  }
}

async function fetchDailyHeadlines(): Promise<string[]> {
  const now = Date.now();
  if (
    cachedCategorizedHeadlines.general.length > 0 &&
    now - categorizedFetchedAt < 30 * 60 * 1000
  ) {
    return [
      ...cachedCategorizedHeadlines.general,
      ...cachedCategorizedHeadlines.ai,
      ...cachedCategorizedHeadlines.movies,
      ...cachedCategorizedHeadlines.games,
    ];
  }

  const [general, ai, movies, games] = await Promise.all([
    fetchRssTitles(GOOGLE_NEWS_RSS_URL),
    fetchRssTitles(AI_NEWS_RSS_URL),
    fetchRssTitles(MOVIES_RSS_URL),
    fetchRssTitles(GAMES_RSS_URL),
  ]);

  if (general.length > 0 || ai.length > 0 || movies.length > 0 || games.length > 0) {
    cachedCategorizedHeadlines = {
      general: general.length > 0 ? general : ['Global markets surge following surprise economic report'],
      ai: ai.length > 0 ? ai : ['New AI model released with advanced reasoning capabilities and autonomous agents'],
      movies: movies.length > 0 ? movies : ['Blockbuster sci-fi sequel sets new opening weekend box office record'],
      games: games.length > 0 ? games : ['Highly anticipated open-world RPG launches to record player counts'],
    };
    categorizedFetchedAt = now;
  }

  return [
    ...cachedCategorizedHeadlines.general,
    ...cachedCategorizedHeadlines.ai,
    ...cachedCategorizedHeadlines.movies,
    ...cachedCategorizedHeadlines.games,
  ];
}

function pickSampleHeadlines(headlines: string[], count = 3): string[] {
  if (headlines.length <= count) return headlines;
  const copy = [...headlines];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildSystemContext(params: {
  basePrompt: string;
  agent: AgentRole;
  summary: string;
  topic: string;
  headlines: string[];
  observerQuestion: string;
  observerStage?: 'alien_first' | 'skeptic_second';
  chaosDirective?: string;
  autonomousEvolution: boolean;
  turnNumber: number;
  castMode?: 'duo' | 'trump-biden' | 'trump-only';
}): string {
  const parts: string[] = [params.basePrompt.trim()];

  if (params.summary.trim()) {
    parts.push(
      `[Memory of Earlier Exchanges]\n${params.summary.trim()}\nCallback to earlier jokes, running bits, or insults from this conversation when funny.`
    );
  }

  const tMod = (params.turnNumber - 1) % 4;
  const pool =
    tMod === 0
      ? cachedCategorizedHeadlines.general.length > 0 ? cachedCategorizedHeadlines.general : params.headlines
      : tMod === 1
        ? cachedCategorizedHeadlines.ai.length > 0 ? cachedCategorizedHeadlines.ai : params.headlines
        : tMod === 2
          ? cachedCategorizedHeadlines.movies.length > 0 ? cachedCategorizedHeadlines.movies : params.headlines
          : cachedCategorizedHeadlines.games.length > 0 ? cachedCategorizedHeadlines.games : params.headlines;

  const categoryName =
    tMod === 0
      ? 'Top Earth News & Politics'
      : tMod === 1
        ? 'Cutting-Edge AI & Tech News'
        : tMod === 2
          ? 'New Hollywood Movies & Entertainment'
          : 'New Video Games & Gaming Releases';

  if (pool && pool.length > 0) {
    const sample = pickSampleHeadlines(pool, 3);
    const headlineFocus =
      params.castMode === 'trump-only'
        ? `Riff on these ${categoryName} headlines right now, brag about what YOU would do, or tell a hilarious story about it:`
        : params.castMode === 'trump-biden'
          ? `Trade hilarious insults while riffing on these ${categoryName} headlines right now:`
          : `Riff on these ${categoryName} headlines right now with an outrageous, funny take:`;
    parts.push(
      `[Today's Spotlight: ${categoryName}]\n${headlineFocus}\n${sample.map((h) => `- ${h}`).join('\n')}`
    );
  }

  if (params.chaosDirective?.trim()) {
    parts.push(`[${params.chaosDirective.trim()}]`);
  }

  if (params.observerQuestion.trim()) {
    if (params.castMode === 'trump-only') {
      parts.push(
        `[Direct Question from Audience]\nSomeone in the crowd just asked you: "${params.observerQuestion.trim()}".\nAnswer it in classic Trump style—bragging about how nobody knows it better than you—and pivot into a funny remark.`
      );
    } else if (params.castMode === 'trump-biden') {
      if (params.observerStage === 'alien_first' || params.agent === 'trump') {
        parts.push(
          `[Direct Question from Audience]\nSomeone in the crowd just asked: "${params.observerQuestion.trim()}".\nYou are answering FIRST. Roast Joe Biden and answer the question in Trump style.`
        );
      } else {
        parts.push(
          `[Direct Question from Audience]\nSomeone in the crowd just asked: "${params.observerQuestion.trim()}".\nTrump just answered first. Mock Trump's answer and fire back with your own take.`
        );
      }
    } else if (params.observerStage === 'alien_first' || params.agent === 'seeker') {
      parts.push(
        `[Direct Interruption from Human Observer]\nA human observer in the void just interrupted your conversation and asked: "${params.observerQuestion.trim()}".\nYou are speaking FIRST in response to them. Address their question directly before passing the floor to Socrates.`
      );
    } else {
      parts.push(
        `[Direct Question from Human Observer]\nA human observer just asked: "${params.observerQuestion.trim()}".\nZorblax just gave his opening answer. Now give your own opinion on the observer's question while roasting Zorblax's answer.`
      );
    }
  } else if (params.castMode === 'trump-only') {
    parts.push(
      `[Solo Headline Riff & Storytime]\nYou are solo on stage talking to yourself and the crowd. Do NOT mention Joe Biden, Zorblax, or Socrates. React to one of today's headlines above, brag about how great you are and what you'd do, or launch into a funny, absurd little story.`
    );
  } else if (params.agent === 'trump' || params.agent === 'biden') {
    const rival = params.agent === 'trump' ? 'Joe Biden' : 'Donald Trump';
    if (params.castMode === 'trump-biden') {
      parts.push(
        `[1-on-1 Debate Stage]\nOnly you and ${rival} are on stage—NEVER mention Zorblax, aliens, or Socrates. Talk ruthless crap about ${rival}, respond directly to what ${rival} just said, roast today's live Earth news headlines above, and spin funny conspiracy theories.`
      );
    } else {
      parts.push(
        `[Surprise Cameo Call-In]\nYou and ${rival} are hijacking Zorblax and Socrates' hologram channel right now for a multi-turn shouting match. Talk ruthless crap about ${rival}, fire back at what was just said, and bring up an absurd conspiracy theory about one of today's live Earth news headlines above.`
      );
    }
  } else if (params.autonomousEvolution) {
    if (params.turnNumber <= 1) {
      parts.push(
        `[Opening Riff]\nKick off the conversation by bringing up one of today's live Earth news headlines above and hitting Socrates with a hilarious, dirty, boundary-pushing take on it.`
      );
    } else if (params.turnNumber % 5 === 0) {
      parts.push(
        `[Fresh Headline Pivot]\nReact to what your partner just said, then pivot smoothly to roast another headline from today's Earth news list with an even dirtier or funnier joke.`
      );
    }
  } else if (params.topic.trim()) {
    parts.push(
      `[Conversation Focus]\nSteer this exchange around: ${params.topic.trim()}, while riffing on today's headlines and keeping the dirty back-and-forth rolling.`
    );
  }

  if (params.agent === 'trump' || params.agent === 'biden') {
    parts.push(
      `[HARD LENGTH LIMIT]\nWrite ONLY 2 to 3 short, punchy sentences total (roughly 20–45 words). STRICTLY NEVER exceed 4 sentences.`
    );
  } else {
    parts.push(
      `[HARD LENGTH LIMIT]\nWrite ONLY 1 to 3 snappy conversational sentences total (about 15–42 words). STRICTLY NEVER exceed 4 sentences. Keep it moving back and forth like uncensored late-night banter.`
    );
  }

  return parts.join('\n\n');
}

function buildOpenRouterMessages(
  agent: AgentRole,
  systemContent: string,
  history: TurnHistoryItem[],
  observerQuestion?: string,
  observerStage?: 'alien_first' | 'skeptic_second',
  castMode: 'duo' | 'trump-biden' | 'trump-only' = 'duo'
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemContent },
  ];

  const trimmedObserver = observerQuestion?.trim() || '';
  if (trimmedObserver && observerStage === 'alien_first') {
    messages.push({
      role: 'user',
      content: `Audience member asks: "${trimmedObserver}". Answer this question directly first.`,
    });
    return messages;
  }

  if (history.length === 0) {
    messages.push({
      role: 'user',
      content: trimmedObserver
        ? `Audience member asks: "${trimmedObserver}". Give your answer.`
        : castMode === 'trump-only'
          ? 'Start your solo hologram riff: pick a wild headline from today’s news above, say what you would do, brag about yourself, or tell a funny story!'
          : 'Speak the opening line of this conversation.',
    });
    return messages;
  }

  for (const item of history) {
    const rawContent = item.content.trim();
    if (!rawContent) continue;
    const role = item.agent === agent ? 'assistant' : 'user';
    const content =
      castMode === 'duo' &&
      role === 'user' &&
      (item.agent === 'trump' || item.agent === 'biden')
        ? `[${item.agent === 'trump' ? 'Donald Trump' : 'Joe Biden'} just beamed in and interrupted]: ${rawContent}`
        : rawContent;

    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }

  if (trimmedObserver && observerStage === 'skeptic_second') {
    const last = messages[messages.length - 1];
    const promptNote =
      castMode === 'trump-biden'
        ? `[Audience member asked: "${trimmedObserver}"] Fire back at Trump's answer above and give your own take.`
        : `[Human Observer asked: "${trimmedObserver}"] Give your philosophical opinion on their question and respond to the Alien's opening answer above.`;
    if (last && last.role === 'user') {
      last.content = `${last.content}\n\n${promptNote}`;
    } else {
      messages.push({ role: 'user', content: promptNote });
    }
    return messages;
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    messages.push({
      role: 'user',
      content:
        castMode === 'trump-only'
          ? 'Keep rolling with a fresh new topic! Pick a different headline above or tell another funny, absurd story bragging about yourself. Do not repeat your last point.'
          : 'Continue the dialogue.',
    });
  }

  return messages;
}

function writeSse(res: Response, payload: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function runFreeRelayTurn(params: {
  res: Response;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  maxSentences: number;
  signal: AbortSignal;
}): Promise<void> {
  const { res, messages, temperature, maxTokens, maxSentences, signal } = params;

  const upstream = await fetch(POLLINATIONS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai-fast',
      messages,
      temperature,
      // Free-relay GPT-OSS uses internal reasoning tokens; give ample token headroom and enforce <=6 sentences cleanly via prompt + clampToMaxSentences
      max_tokens: Math.max(700, maxTokens),
      seed: Math.floor(Math.random() * 1000000),
    }),
    signal,
  });

  if (upstream.status === 402 || upstream.status === 429 || upstream.status === 503) {
    const text = await upstream.text();
    const match = text.match(/Retry after (\d+)s/i);
    const waitSeconds = match ? Math.min(90, Math.max(5, parseInt(match[1], 10) + 2)) : upstream.status === 503 ? 12 : 46;
    writeSse(res, {
      type: 'cooldown',
      seconds: waitSeconds,
      provider: 'free-relay',
      message: `Free relay pacing window (${waitSeconds}s)`,
    });
    res.end();
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    writeSse(res, {
      type: 'error',
      status: upstream.status,
      message: text.slice(0, 180) || `Free relay error (HTTP ${upstream.status})`,
    });
    res.end();
    return;
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const rawContent = data.choices?.[0]?.message?.content?.trim() || '';
  const isUpstreamErrorText =
    !rawContent ||
    /API key used for this request has reached|Free limit reached|rate limit exceeded/i.test(rawContent);

  if (isUpstreamErrorText) {
    writeSse(res, {
      type: 'cooldown',
      seconds: 10,
      provider: 'free-relay',
      message: 'Free relay temporarily busy, retrying...',
    });
    res.end();
    return;
  }

  const content = clampToMaxSentences(rawContent, maxSentences);

  writeSse(res, {
    type: 'provider',
    provider: 'free-relay',
    recommendedDelayMs: 0,
  });
  writeSse(res, { type: 'delta', content });

  if (data.usage) {
    writeSse(res, {
      type: 'usage',
      usage: {
        prompt: data.usage.prompt_tokens ?? 0,
        completion: data.usage.completion_tokens ?? 0,
        total: data.usage.total_tokens ?? 0,
      },
    });
  }

  writeSse(res, { type: 'done' });
  res.end();
}

async function createServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/status', (_req: Request, res: Response) => {
    const apiKey = getApiKey();
    res.json({
      configured: apiKey.length > 0,
      freeRelayAvailable: true,
      defaultSeekerModel: DEFAULT_SEEKER_MODEL,
      defaultSkepticModel: DEFAULT_SKEPTIC_MODEL,
    });
  });

  app.get('/api/headlines', async (_req: Request, res: Response) => {
    const headlines = await fetchDailyHeadlines();
    res.json({ headlines, fetchedAt: headlinesFetchedAt || Date.now() });
  });

  app.post('/api/tts/cameo', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { agent?: unknown; text?: unknown };
    if (body.agent !== 'trump' && body.agent !== 'biden') {
      res.status(400).json({ error: 'Invalid cameo voice agent.' });
      return;
    }
    if (typeof body.text !== 'string') {
      res.status(400).json({ error: 'Text is required.' });
      return;
    }

    const cleanText = body.text
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[—–]/g, ', ')
      .replace(/…/g, '...')
      .replace(/[*_`#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 420);

    if (!cleanText) {
      res.status(400).json({ error: 'Text is empty.' });
      return;
    }

    const splitTtsChunks = (input: string, maxLen: number): string[] => {
      const sentences = input.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [input];
      const chunks: string[] = [];
      let cur = '';
      for (const rawS of sentences) {
        const s = rawS.trim();
        if (!s) continue;
        if ((cur + ' ' + s).trim().length <= maxLen) {
          cur = (cur ? cur + ' ' : '') + s;
        } else {
          if (cur) chunks.push(cur);
          if (s.length <= maxLen) {
            cur = s;
          } else {
            const words = s.split(/\s+/);
            let wCur = '';
            for (const w of words) {
              if ((wCur + ' ' + w).trim().length <= maxLen) {
                wCur = (wCur ? wCur + ' ' : '') + w;
              } else {
                if (wCur) chunks.push(wCur);
                wCur = w.slice(0, maxLen);
              }
            }
            cur = wCur;
          }
        }
      }
      if (cur) chunks.push(cur);
      return chunks.length > 0 ? chunks : [input.slice(0, maxLen)];
    };

    const mergeMp3Parts = async (parts: Buffer[]): Promise<Buffer> => {
      if (parts.length === 1) return parts[0];
      const tempFiles: string[] = [];
      const outPath = path.join(
        os.tmpdir(),
        `tts-merged-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
      );
      try {
        for (let i = 0; i < parts.length; i++) {
          const fp = path.join(
            os.tmpdir(),
            `tts-part-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.mp3`
          );
          fs.writeFileSync(fp, parts[i]);
          tempFiles.push(fp);
        }
        const concatUri = `concat:${tempFiles.join('|')}`;
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          concatUri,
          '-acodec',
          'libmp3lame',
          '-ar',
          '24000',
          '-ab',
          '64k',
          outPath,
        ]);
        return fs.readFileSync(outPath);
      } catch {
        return Buffer.concat(parts);
      } finally {
        for (const f of tempFiles) {
          try {
            fs.unlinkSync(f);
          } catch {
            // ignore
          }
        }
        try {
          fs.unlinkSync(outPath);
        } catch {
          // ignore
        }
      }
    };

    try {
      let result: { buffer: ArrayBuffer; contentType: string } | null = null;
      const now = Date.now();

      const extractAudioUrlFromSse = (sseText: string): { url: string | null; quotaHit: boolean } => {
        if (/ZeroGPU quota exceeded|maximum number of requests/i.test(sseText)) {
          return { url: null, quotaHit: true };
        }
        const lines = sseText.split('\n');
        let lastEvent = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            lastEvent = line.slice(6).trim();
          } else if (line.startsWith('data:') && lastEvent === 'complete') {
            try {
              const arr = JSON.parse(line.slice(5).trim()) as unknown[];
              for (const item of arr) {
                if (
                  item &&
                  typeof item === 'object' &&
                  'url' in item &&
                  typeof (item as { url?: unknown }).url === 'string'
                ) {
                  return { url: (item as { url: string }).url, quotaHit: false };
                }
              }
            } catch {
              // ignore
            }
          }
        }
        return { url: null, quotaHit: lastEvent === 'error' };
      };

      const callGradioAudio = async (
        spaceOrigin: string,
        fnName: string,
        dataPayload: unknown[],
        timeoutMs: number,
        cooldownKind: 'selfit' | 'zerogpu'
      ): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const postRes = await fetch(`${spaceOrigin}/gradio_api/call/${fnName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataPayload }),
            signal: controller.signal,
          });
          if (!postRes.ok) return null;
          const postJson = (await postRes.json()) as { event_id?: string };
          if (!postJson.event_id) return null;

          const sseRes = await fetch(`${spaceOrigin}/gradio_api/call/${fnName}/${postJson.event_id}`, {
            signal: controller.signal,
          });
          if (!sseRes.ok) return null;
          const sseText = await sseRes.text();
          const { url: audioUrl, quotaHit } = extractAudioUrlFromSse(sseText);
          if (quotaHit) {
            const until = Date.now() + 10 * 60 * 1000;
            if (cooldownKind === 'selfit') selfitCooldownUntil = until;
            else zeroGpuCooldownUntil = until;
          }
          if (!audioUrl) return null;

          const parsed = new URL(audioUrl);
          if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.hf.space')) {
            return null;
          }

          const audioRes = await fetch(audioUrl, { signal: controller.signal });
          if (!audioRes.ok) return null;
          const buffer = await audioRes.arrayBuffer();
          if (buffer.byteLength < 512) return null;
          const contentType = audioUrl.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
          return { buffer, contentType };
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      };

      // Primary: Chatterbox TTS Voice Clone with reference WAV
      if (body.agent === 'trump' || body.agent === 'biden') {
        const ensureRef = async (agentName: 'trump' | 'biden') => {
          const refNow = Date.now();
          const isTrump = agentName === 'trump';
          if (isTrump && cachedTrumpRefFile && refNow - trumpRefUploadedAt < 15 * 60 * 1000) {
            return cachedTrumpRefFile;
          }
          if (!isTrump && cachedBidenRefFile && refNow - bidenRefUploadedAt < 15 * 60 * 1000) {
            return cachedBidenRefFile;
          }
          const refPath = path.resolve(__dirname, 'public', 'assets', 'audio', isTrump ? 'trump_ref.wav' : 'biden_ref.wav');
          if (!fs.existsSync(refPath)) return null;
          const wavBuf = fs.readFileSync(refPath);
          const form = new FormData();
          form.append('files', new Blob([wavBuf], { type: 'audio/wav' }), isTrump ? 'trump_ref.wav' : 'biden_ref.wav');
          const upRes = await fetch('https://ResembleAI-Chatterbox.hf.space/gradio_api/upload', {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(8000),
          });
          if (!upRes.ok) return null;
          const paths = (await upRes.json()) as string[];
          if (!Array.isArray(paths) || !paths[0]) return null;
          const refObj = {
            path: paths[0],
            url: `https://ResembleAI-Chatterbox.hf.space/gradio_api/file=${paths[0]}`,
            orig_name: isTrump ? 'trump_ref.wav' : 'biden_ref.wav',
            mime_type: 'audio/wav',
            meta: { _type: 'gradio.FileData' },
          };
          if (isTrump) {
            cachedTrumpRefFile = refObj;
            trumpRefUploadedAt = refNow;
          } else {
            cachedBidenRefFile = refObj;
            bidenRefUploadedAt = refNow;
          }
          return refObj;
        };

        try {
          const ref = await ensureRef(body.agent);
          if (ref) {
            result = await callGradioAudio(
              'https://ResembleAI-Chatterbox.hf.space',
              'generate_tts_audio',
              [cleanText, ref, 0.5, 0.8, 0, 0.5, false],
              35000,
              'zerogpu'
            );
          }
        } catch {
          // Fall through to other spaces
        }
      }

      // Secondary for Trump: Dedicated Trump AI Voice trained spaces
      if (!result && body.agent === 'trump') {
        const candidateOrigins = [
          { origin: 'https://selfit-camera-trump-ai-voice.hf.space', fn: 'generate_trump_voice_with_realtime_updates', payload: [cleanText, '🇺🇸 English'] },
          { origin: 'https://nicovlr-trump-voice-clone.hf.space', fn: 'generate_trump_voice', payload: [cleanText, 0.65, 0.5, 0.8, 0] },
        ];

        for (let attempt = 0; attempt < 3 && !result; attempt++) {
          for (const cand of candidateOrigins) {
            try {
              const resObj = await callGradioAudio(
                cand.origin,
                cand.fn,
                cand.payload,
                30000,
                'zerogpu'
              );
              if (resObj && resObj.buffer && resObj.buffer.byteLength > 512) {
                result = resObj;
                break;
              }
            } catch {
              // try next candidate
            }
          }
          if (!result && attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }

      // Secondary Backup: Fast neural male voices (TikTok TTS)
      if (!result) {
        try {
          const ttVoice = body.agent === 'trump' ? 'en_us_006' : 'en_male_narration';
          const chunks = splitTtsChunks(cleanText, 240);
          const audioParts = await Promise.all(
            chunks.map(async (chunk) => {
              const ttRes = await fetch('https://tiktok-tts.weilnet.workers.dev/api/generation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: chunk, voice: ttVoice }),
                signal: AbortSignal.timeout(6500),
              });
              if (!ttRes.ok) throw new Error('tt http');
              const ttJson = (await ttRes.json()) as { success?: boolean; data?: string };
              if (!ttJson.success || !ttJson.data) throw new Error('tt data');
              const rawBuf = Buffer.from(ttJson.data, 'base64');
              if (rawBuf.length < 256) throw new Error('tt tiny');
              return rawBuf;
            })
          );
          if (audioParts.length > 0) {
            const merged = await mergeMp3Parts(audioParts);
            result = {
              buffer: Uint8Array.from(merged).buffer,
              contentType: 'audio/mpeg',
            };
          }
        } catch {
          // Proceed to Google TTS backup
        }
      }

      // Backup: Concurrent Google Translate TTS
      if (!result) {
        try {
          const gChunks = splitTtsChunks(cleanText, 170);
          const gParts = await Promise.all(
            gChunks.map(async (chunk) => {
              const gRes = await fetch(
                `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(chunk)}`,
                {
                  headers: { 'User-Agent': 'Mozilla/5.0' },
                  signal: AbortSignal.timeout(6000),
                }
              );
              if (!gRes.ok) throw new Error('gtts http');
              const arrBuf = Buffer.from(await gRes.arrayBuffer());
              if (arrBuf.length < 256) throw new Error('gtts tiny');
              return arrBuf;
            })
          );
          if (gParts.length > 0) {
            const merged = await mergeMp3Parts(gParts);
            result = {
              buffer: Uint8Array.from(merged).buffer,
              contentType: 'audio/mpeg',
            };
          }
        } catch {
          // Fall through to 503 -> client browser speechSynthesis fallback
        }
      }

      if (!result) {
        res.status(503).json({ fallback: true, error: 'Cameo AI voice temporarily unavailable' });
        return;
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(result.buffer));
    } catch {
      res.status(503).json({ fallback: true, error: 'Cameo AI voice request failed' });
    }
  });

  app.post('/api/test-connection', async (_req: Request, res: Response) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(400).json({
        ok: false,
        error: 'OPENROUTER_API_KEY is not configured. Free Unlimited Relay remains active.',
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const start = Date.now();

    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': getAppReferer(),
          'X-Title': 'The Eternal Dialogue',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        res.status(response.status).json({
          ok: false,
          status: response.status,
          error: `OpenRouter responded with HTTP ${response.status}`,
        });
        return;
      }

      openRouterCooldownUntil = 0;
      res.json({
        ok: true,
        latencyMs,
      });
    } catch (err) {
      clearTimeout(timeout);
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to reach OpenRouter',
      });
    }
  });

  app.post('/api/dialogue/turn', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Partial<TurnRequestBody>;
    if (
      body.agent !== 'seeker' &&
      body.agent !== 'skeptic' &&
      body.agent !== 'trump' &&
      body.agent !== 'biden'
    ) {
      res.status(400).json({ error: 'Invalid agent identifier.' });
      return;
    }

    const aiProvider =
      body.aiProvider === 'openrouter' || body.aiProvider === 'free-relay'
        ? body.aiProvider
        : 'auto';

    const apiKey = getApiKey();
    if (aiProvider === 'openrouter' && !apiKey) {
      res.status(503).json({
        error: 'OPENROUTER_API_KEY is not configured on the server.',
      });
      return;
    }

    const fallbackModel =
      body.agent === 'seeker' ? DEFAULT_SEEKER_MODEL : DEFAULT_SKEPTIC_MODEL;
    const model = sanitizeModel(body.model, fallbackModel);
    const temperature = clampNumber(body.temperature, 0, 2, 0.85);
    const maxTokens = Math.round(clampNumber(body.maxTokens, 64, 300, 130));
    const maxSentences = body.agent === 'trump' || body.agent === 'biden' ? 5 : 4;
    const turnNumber = Math.max(1, Math.round(clampNumber(body.turnNumber, 1, 100000, 1)));

    const rawPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.slice(0, 14000) : '';
    if (!rawPrompt.trim()) {
      res.status(400).json({ error: 'System prompt is required.' });
      return;
    }

    const summary = typeof body.summary === 'string' ? body.summary.slice(0, 4000) : '';
    const topic = typeof body.topic === 'string' ? body.topic.slice(0, 200) : '';
    const observerQuestion =
      typeof body.observerQuestion === 'string' ? body.observerQuestion.slice(0, 500) : '';
    const observerStage =
      body.observerStage === 'alien_first' || body.observerStage === 'skeptic_second'
        ? body.observerStage
        : undefined;
    const chaosDirective =
      typeof body.chaosDirective === 'string' ? body.chaosDirective.slice(0, 400) : '';
    const autonomousEvolution = Boolean(body.autonomousEvolution);
    const castMode =
      body.castMode === 'trump-only'
        ? 'trump-only'
        : body.castMode === 'trump-biden'
          ? 'trump-biden'
          : 'duo';

    const history: TurnHistoryItem[] = Array.isArray(body.history)
      ? body.history
          .slice(-16)
          .filter(
            (item): item is TurnHistoryItem =>
              Boolean(item) &&
              (item.agent === 'seeker' ||
                item.agent === 'skeptic' ||
                item.agent === 'trump' ||
                item.agent === 'biden') &&
              typeof item.content === 'string'
          )
          .map((item) => ({
            agent: item.agent,
            content: item.content.slice(0, 3000),
          }))
      : [];

    const headlines = await fetchDailyHeadlines();

    const systemContext = buildSystemContext({
      basePrompt: rawPrompt,
      agent: body.agent,
      summary,
      topic,
      headlines,
      observerQuestion,
      observerStage,
      chaosDirective,
      autonomousEvolution,
      turnNumber,
      castMode,
    });

    const messages = buildOpenRouterMessages(
      body.agent,
      systemContext,
      history,
      observerQuestion,
      observerStage,
      castMode
    );

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const requestTimeout = setTimeout(() => abortController.abort(), 45000);

    res.on('close', () => {
      if (!res.writableEnded) {
        clearTimeout(requestTimeout);
        abortController.abort();
      }
    });

    const shouldTryOpenRouter =
      aiProvider === 'openrouter' ||
      (aiProvider === 'auto' && apiKey.length > 0 && Date.now() >= openRouterCooldownUntil);

    try {
      if (!shouldTryOpenRouter) {
        await runFreeRelayTurn({
          res,
          messages,
          temperature,
          maxTokens,
          maxSentences,
          signal: abortController.signal,
        });
        clearTimeout(requestTimeout);
        return;
      }

      const callOpenRouter = (targetModel: string) =>
        fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': getAppReferer(),
            'X-Title': 'The Eternal Dialogue',
          },
          body: JSON.stringify({
            model: targetModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            reasoning: { enabled: false },
          }),
          signal: abortController.signal,
        });

      const fallbackTarget =
        body.agent === 'seeker' || body.agent === 'trump'
          ? FAST_SEEKER_MODEL
          : FAST_SKEPTIC_MODEL;
      let upstream = await callOpenRouter(model);

      // If a :free model hits daily free-tier cap or rejects reasoning=false, swap immediately to ultra-fast OpenRouter Flash Lite / GPT-4o Mini
      if (
        (upstream.status === 429 || upstream.status === 400 || upstream.status === 402) &&
        model !== fallbackTarget &&
        model.includes(':free')
      ) {
        upstream = await callOpenRouter(fallbackTarget);
      }

      // Automatic failover to Free Cloud Relay only if even the fast OpenRouter fallback hits 402/429
      if ((upstream.status === 402 || upstream.status === 429) && aiProvider === 'auto') {
        openRouterCooldownUntil = Date.now() + 45 * 1000;
        await runFreeRelayTurn({
          res,
          messages,
          temperature,
          maxTokens,
          maxSentences,
          signal: abortController.signal,
        });
        clearTimeout(requestTimeout);
        return;
      }

      clearTimeout(requestTimeout);

      if (!upstream.ok || !upstream.body) {
        let errorMessage = `OpenRouter error (HTTP ${upstream.status})`;
        try {
          const errJson = (await upstream.json()) as { error?: { message?: string } };
          if (errJson?.error?.message) {
            errorMessage = errJson.error.message;
          }
        } catch {
          // ignore
        }
        writeSse(res, { type: 'error', status: upstream.status, message: errorMessage });
        res.end();
        return;
      }

      writeSse(res, { type: 'provider', provider: 'openrouter' });

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let emittedText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') {
            writeSse(res, { type: 'done' });
            res.end();
            return;
          }

          try {
            const parsed = JSON.parse(dataStr) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
              error?: { message?: string };
            };

            if (parsed.error?.message) {
              writeSse(res, { type: 'error', status: 502, message: parsed.error.message });
              res.end();
              return;
            }

            const deltaContent = parsed.choices?.[0]?.delta?.content;
            if (typeof deltaContent === 'string' && deltaContent.length > 0) {
              const candidate = emittedText + deltaContent;
              if (countSentences(emittedText) >= maxSentences) {
                continue;
              }
              const clamped = clampToMaxSentences(candidate, maxSentences);
              const safeDelta = clamped.slice(emittedText.length);
              if (safeDelta.length > 0) {
                emittedText = clamped;
                writeSse(res, { type: 'delta', content: safeDelta });
              }
            }

            if (parsed.usage) {
              writeSse(res, {
                type: 'usage',
                usage: {
                  prompt: parsed.usage.prompt_tokens ?? 0,
                  completion: parsed.usage.completion_tokens ?? 0,
                  total: parsed.usage.total_tokens ?? 0,
                },
              });
            }
          } catch {
            // Skip malformed partial SSE lines
          }
        }
      }

      writeSse(res, { type: 'done' });
      res.end();
    } catch (err) {
      clearTimeout(requestTimeout);
      if (abortController.signal.aborted && res.writableEnded) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Stream connection interrupted';
      writeSse(res, { type: 'error', status: 502, message });
      res.end();
    }
  });

  app.post('/api/dialogue/summarize', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Partial<SummarizeRequestBody>;
    const apiKey = getApiKey();

    // Avoid extra API consumption when OpenRouter is unavailable or in cooldown
    if (
      body.aiProvider === 'free-relay' ||
      !apiKey ||
      Date.now() < openRouterCooldownUntil
    ) {
      res.json({ summary: typeof body.previousSummary === 'string' ? body.previousSummary : '' });
      return;
    }

    const model = sanitizeModel(body.model, DEFAULT_SKEPTIC_MODEL);
    const previousSummary = typeof body.previousSummary === 'string' ? body.previousSummary.slice(0, 3000) : '';
    const turns = Array.isArray(body.turns)
      ? body.turns
          .slice(0, 20)
          .filter(
            (t): t is TurnHistoryItem =>
              Boolean(t) &&
              (t.agent === 'seeker' ||
                t.agent === 'skeptic' ||
                t.agent === 'trump' ||
                t.agent === 'biden') &&
              typeof t.content === 'string'
          )
          .map((t) => `${t.agent.toUpperCase()}: ${t.content.slice(0, 1200)}`)
      : [];

    if (turns.length === 0) {
      res.json({ summary: previousSummary });
      return;
    }

    const prompt = [
      previousSummary ? `Existing memory:\n${previousSummary}\n` : '',
      `New exchanges to fold into memory:\n${turns.join('\n\n')}`,
    ]
      .filter(Boolean)
      .join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const upstream = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': getAppReferer(),
          'X-Title': 'The Eternal Dialogue',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Distill this philosophical conversation into a concise archival memory (100–160 words). Preserve core theses, disagreements, coined metaphors, and unresolved paradoxes. Write plain prose without bullet points or headings.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 240,
          reasoning: { enabled: false },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!upstream.ok) {
        res.json({ summary: previousSummary });
        return;
      }

      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const summary = data.choices?.[0]?.message?.content?.trim() || previousSummary;
      res.json({
        summary,
        usage: data.usage
          ? {
              prompt: data.usage.prompt_tokens ?? 0,
              completion: data.usage.completion_tokens ?? 0,
              total: data.usage.total_tokens ?? 0,
            }
          : undefined,
      });
    } catch {
      clearTimeout(timeout);
      res.json({ summary: previousSummary });
    }
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`The Eternal Dialogue server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
