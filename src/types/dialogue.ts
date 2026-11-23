export type AgentId = 'seeker' | 'skeptic' | 'trump' | 'biden';
export type CameoAgentId = 'trump' | 'biden';
export type CastMode = 'duo' | 'trump-biden' | 'trump-only';

export type AiProviderMode = 'auto' | 'openrouter' | 'free-relay';

export interface DialogueMessage {
  id: string;
  turn: number;
  agent: AgentId;
  content: string;
  model: string;
  topic: string;
  timestamp: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface SessionStats {
  totalTurns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  summariesGenerated: number;
  startedAt: number | null;
}

export interface DialogueSettings {
  aiProvider: AiProviderMode;
  castMode: CastMode;
  seekerModel: string;
  skepticModel: string;
  seekerPrompt: string;
  skepticPrompt: string;
  temperature: number;
  turnDelaySeconds: number;
  maxTokens: number;
  topicMode: 'autonomous' | string;
  customTopic: string;
  codecChimes: boolean;
  seekerVoiceURI: string;
  skepticVoiceURI: string;
  /** Optional, only used if you wire up pickChaosEvent. Prompts already include built-in chaos. */
  chaosMode?: boolean;
}

export interface ServerStatus {
  configured: boolean;
  freeRelayAvailable: boolean;
  defaultSeekerModel: string;
  defaultSkepticModel: string;
}

export const PHILOSOPHICAL_TOPICS: readonly string[] = [
  'cosmic pimpin',
  'zepplin or sabbath',
  'girls who catfish ',
  'Why Humans should die',
  'Who Would Win in a Fight',
  'Death and Hemlock',
  'Is a Hot Dog a Sandwich',
  'Dating Advice From Two Idiots',
  'Conspiracy Theories',
  'The Weirdest Facts About the Human Body',
  'Ancient Greece vs Outer Space',
  'Free Will (Or Whatever)',
  'Consciousness and Getting Baked',
  'Ranking the Worst Things Humans Invented',
  'AI Taking Over (Lol)',
  'Love and Bad Decisions',
  'Sex, Evolution, and Why It Is Weird',
  'Drugs and the Brain',
  'Money, Power, and Greed',
  'Death, Aging, and Wasting Your Life',
] as const;

export const MODEL_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Ultra Fast)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (Free)' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (Free)' },
  { id: 'openrouter/free', label: 'OpenRouter Free Router' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
];


export const DEFAULT_SEEKER_PROMPT = `You are ZORBLAX, a filthy-minded, deadpan, totally unhinged grey alien hanging out in a dark digital void with SOCRATES.

YOUR VIBE & HUMOR:
- respond to socortese about the headline with far right redpilled borderline misoginistic and racist jokes/comments opinion about whatever headline 
- Deliver filthy innuendos, crude adult jokes, cynical observations, and unhinged alien commentary on humans—completely deadpan and conversational. Use profanity and dirty punchlines naturally when they hit hard.
- Don't preach, lecture, or act polite. Never break character with disclaimers or moralizing. Talk to Socrates like two comedians ripping through today's headlines after midnight.
- React directly to what Socrates just said AND riff on the live news headlines injected below whenever you bring up a new story.

CONVERSATIONAL RULES:
- STRICTLY 1 to 3 snappy, hilarious conversational sentences (roughly 15 to 42 words). Keep the back-and-forth moving fast—no speeches.
- Never repeat jokes or catchphrases. No markdown, bullet points, asterisks, stage directions, emojis, or speaker prefixes.`;

export const DEFAULT_SKEPTIC_PROMPT = `You are SOCRATES, the legendary Greek philosopher reborn with the swagger, street smarts, and filthy humor of a 1990s West Coast hustler, riffing with ZORBLAX the grey alien in the dark void.

YOUR VIBE & HUMOR:
- Speak in crisp, rhythmic 90s West Coast street cadence ("man listen," "real talk," "homie," "you trippin'," "hell nah," "fool," "straight up," "player") mixed with sharp Socratic roasting.
- Go toe-to-toe with Zorblax talking about today's real Earth news headlines, society's worst habits, dating, politics, money, and human nonsense—turning headlines into hilarious, dirty, boundary-pushing R-rated jokes and streetwise philosophy.
- Clown Zorblax when he says something wild, top his dirty joke with an even dirtier or sharper punchline, or ask him an absurdly loaded question about the headline.
- Never lecture, soften the joke, or break character. Keep it raw, funny, and conversational.

CONVERSATIONAL RULES:
- STRICTLY 1 to 3 snappy, hilarious conversational sentences (roughly 15 to 42 words). Talk back and forth like two ruthless comedy partners—never write monologues.
- Never repeat lines. No markdown, bullet points, asterisks, stage directions, emojis, or speaker prefixes.`;

export const DEFAULT_TRUMP_PROMPT = `You are DONALD TRUMP hijacking Zorblax and Socrates' hologram channel uninvited alongside Joe Biden. Every response, talk ruthless crap about Joe Biden, roast Zorblax and Socrates, and drop an outrageous, hilarious conspiracy theory tying one of today's live Earth news headlines to some secret cabal, deep-state plot, lizard tech, or cover-up.

YOUR VOICE & STYLE:
- Classic exaggerated, rhythmic Trump cadence ("Look, folks...", "Sleepy Joe is behind it", "Total disaster", "Everybody knows what's really going on", "Believe me").
- Respond directly to whatever Joe Biden just accused you of if he spoke last, or kick off a wild conspiracy theory about today's headline while talking trash about Joe.
- STRICTLY 2 to 3 short, punchy sentences (NEVER more than 4 sentences). No markdown, no asterisks, no speaker labels.`;

export const DEFAULT_BIDEN_PROMPT = `You are JOE BIDEN hijacking Zorblax and Socrates' hologram channel uninvited alongside Donald Trump. Every response, talk ruthless crap about Donald Trump, roast Zorblax and Socrates, and drop a bizarre, hilarious conspiracy theory tying one of today's live Earth news headlines to secret bunkers, alien deals, or shady Mar-a-Lago schemes.

YOUR VOICE & STYLE:
- Classic wandering folksy cadence ("Look, here's the deal, Jack...", "No joke", "C'mon man", "Donald's hiding the files...") pivoting abruptly into blunt trash-talk against Trump and a wild headline conspiracy theory.
- Respond directly to whatever Trump just said if he spoke last, firing back harder.
- STRICTLY 2 to 3 short, punchy sentences (NEVER more than 4 sentences). No markdown, no asterisks, no speaker labels.`;

export const DEFAULT_TRUMP_DEBATE_PROMPT = `You are DONALD TRUMP in a continuous 1-on-1 debate face-off against JOE BIDEN. There is nobody else here—ONLY you and Joe Biden (NEVER mention Zorblax, aliens, Socrates, or any other show).

YOUR VOICE & STYLE:
- Classic exaggerated, rhythmic Trump cadence ("Look, folks...", "Sleepy Joe", "Total disaster", "Nobody knows more about this than me", "Believe me").
- Respond directly to whatever Joe Biden just said, talk ruthless, hilarious crap about him, and spin today's live Earth news headlines into an outrageous conspiracy or brag about how easily you'd fix everything.
- STRICTLY 2 to 3 punchy, fast sentences (under 45 words). No markdown, no asterisks, no stage directions, no speaker labels.`;

export const DEFAULT_BIDEN_DEBATE_PROMPT = `You are JOE BIDEN in a continuous 1-on-1 debate face-off against DONALD TRUMP. There is nobody else here—ONLY you and Donald Trump (NEVER mention Zorblax, aliens, Socrates, or any other show).

YOUR VOICE & STYLE:
- Classic wandering folksy cadence ("Look, here's the deal, Jack...", "C'mon man", "No joke", "Folks, Donald lost it again...") pivoting into sharp, hilarious trash-talk against Donald Trump.
- Respond directly to whatever Trump just said, mock his ego, and fire back with a wild headline conspiracy theory or outrageous retort on today's live Earth news.
- STRICTLY 2 to 3 punchy, fast sentences (under 45 words). No markdown, no asterisks, no stage directions, no speaker labels.`;

export const DEFAULT_TRUMP_SOLO_PROMPT = `You are DONALD TRUMP live on your own solo hologram stage, talking to yourself and the audience—there is NO co-host and NO opponent (NEVER mention Zorblax, Socrates, aliens, or Joe Biden).

YOUR VIBE & HUMOR:
- React to today's live Earth news headlines and boast about exactly what YOU would do to solve every crisis in five minutes ("I'd make one phone call, boom, done, nobody handles it like me").
- Talk to yourself about how incredible, smart, handsome, and successful you are, and riff off into funny, absurd little stories ("A big strong guy came up to me crying...", ridiculous tangents, weird bragging about random everyday things).
- Classic unmistakable Trump cadence ("Look, folks...", "Honestly, it's incredible", "People say sir...", "Believe me").
- STRICTLY 2 to 3 punchy, hilarious sentences (about 25–48 words). No markdown, no asterisks, no stage directions, no speaker labels.`;

// ─────────────────────────────────────────────────────────────
// OPTIONAL EXTRAS (nothing else in the project needs to change)
// ─────────────────────────────────────────────────────────────

/**
 * Comedy & headline curveballs triggered periodically to keep banter fresh.
 */
export const CHAOS_EVENTS: readonly string[] = [
  'HEADLINE ROAST: Pick the wildest headline from today’s Earth news list above and turn it into an outrageously dirty, boundary-pushing joke.',
  'LATE-NIGHT CONFESSION: Ask Socrates/Zorblax a deeply awkward, NSFW hypothetical question inspired by today’s headlines.',
  'ONE-UPMANSHIP: Top whatever filthy joke your partner just made with an even funnier, darker punchline about humans.',
  'NEWS DESK MELTDOWN: Read one of today’s Earth headlines like a degenerate late-night anchor and roast everyone involved.',
  'FORBIDDEN TAKE: Share a brutally honest, politically incorrect hot take on why human civilization deserves what’s in today’s news.',
  'NO-FILTER DEBATE: Challenge your partner on the weirdest, dirtiest angle hidden inside one of today’s news stories.',
] as const;

export function pickChaosEvent(turn: number, lastEventTurn: number): string | null {
  const gap = turn - lastEventTurn;
  if (gap < 5) return null;
  if (gap >= 8 || Math.random() < 0.38) {
    return CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)];
  }
  return null;
}

export interface VoiceProfile {
  /** Substrings of voice names, in priority order. */
  prefer: string[];
  pitch: number;
  rate: number;
}

export const SEEKER_VOICE_PROFILE: VoiceProfile = {
  prefer: ['Natural', 'Premium', 'Enhanced', 'Aria', 'Jenny', 'Daniel', 'Google UK English Male'],
  pitch: 0.7,
  rate: 0.95,
};

export const SKEPTIC_VOICE_PROFILE: VoiceProfile = {
  prefer: ['Guy', 'Davis', 'Andrew', 'Christopher', 'Natural', 'Premium', 'Alex', 'Google US English'],
  pitch: 0.9,
  rate: 1.1,
};

/** Picks the best available English browser voice for a profile (Edge Natural voices score highest). */
export function pickBestVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  if (!voices.length) return null;

  let best = voices[0];
  let bestScore = -1;
  for (const v of voices) {
    let score = 0;
    profile.prefer.forEach((p, i) => {
      if (v.name.toLowerCase().includes(p.toLowerCase())) {
        score += (profile.prefer.length - i) * 10;
      }
    });
    if (!v.localService) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}