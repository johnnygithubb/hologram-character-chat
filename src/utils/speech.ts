import type { AgentId } from '../types/dialogue';

export interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
}

const PREMIUM_PATTERNS = [
  /natural/i,
  /neural/i,
  /online/i,
  /enhanced/i,
  /premium/i,
  /wavenet/i,
  /studio/i,
];

const FEMALE_VOICE_PATTERNS = [
  /\bfemale\b/i,
  /\bmicrosoft\s+(?:ava|aria|jenny|emma|sonia|libby|michelle|ana|clara|molly|elena|natasha|zira|hazel|susan|heera|kalpana|catherine|claire|emily|maisie|neerja|rosa|yan)\b/i,
  /\b(?:samantha|victoria|karen|moira|fiona|tessa|serena|kate|martha|allison|nicky|kathy|princess|shelley|sandy|flo|grandma|siri female)\b/i,
  /^google us english$/i,
];

const MALE_VOICE_PATTERNS = [
  /\bmale\b/i,
  /\bmicrosoft\s+(?:andrew|brian|ryan|guy|christopher|eric|davis|steffan|george|thomas|liam|connor|william|james|mitchell|wayne|sam|mark|david|ravi|prabhat|roger|luke|abeo|elim)\b/i,
  /\b(?:daniel|arthur|oliver|jamie|alex|aaron|reed|gordon|lee|rishi|evan|nathan|malcolm|fred|bruce)\b/i,
];

const ROBOTIC_BLACKLIST = [
  /espeak/i,
  /albert/i,
  /bad news/i,
  /bahh/i,
  /bells/i,
  /boing/i,
  /bubbles/i,
  /cellos/i,
  /compact/i,
  /deranged/i,
  /good news/i,
  /hysterical/i,
  /jester/i,
  /junior/i,
  /organ/i,
  /ralph/i,
  /superstar/i,
  /trinoids/i,
  /whisper/i,
  /wobble/i,
  /zarvox/i,
  /eddy/i,
  /grandpa/i,
  /rocko/i,
];

function isFemaleVoice(v: SpeechSynthesisVoice): boolean {
  const full = `${v.name} ${v.voiceURI}`.trim();
  return FEMALE_VOICE_PATTERNS.some((rx) => rx.test(full));
}

function isMaleVoice(v: SpeechSynthesisVoice): boolean {
  const full = `${v.name} ${v.voiceURI}`.trim();
  return MALE_VOICE_PATTERNS.some((rx) => rx.test(full));
}

function scoreMaleVoice(v: SpeechSynthesisVoice): number {
  const name = `${v.name} ${v.voiceURI}`;
  if (ROBOTIC_BLACKLIST.some((rx) => rx.test(name))) {
    return -1000;
  }
  if (isFemaleVoice(v)) {
    return -500;
  }

  let score = 0;
  if (isMaleVoice(v)) score += 200;
  if (/^en(-|_)(us|gb|au|ca|ie|in)/i.test(v.lang)) score += 20;
  if (!v.localService) score += 35;

  for (const rx of PREMIUM_PATTERNS) {
    if (rx.test(name)) score += 50;
  }

  return score;
}

class DialogueAudioEngine {
  private audioCtx: AudioContext | null = null;
  private isSpeaking = false;
  private speechStartedAt = 0;
  private sentenceQueue: Array<{
    text: string;
    agent: AgentId;
    voiceURI: string;
  }> = [];
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private activeCameoSource: AudioBufferSourceNode | null = null;
  private activeCameoAudio: HTMLAudioElement | null = null;
  private cameoAnalyser: AnalyserNode | null = null;
  private cameoAnalyserBins: Uint8Array<ArrayBuffer> | null = null;
  private cameoAbortControllers: Set<AbortController> = new Set();
  private cameoWaiter: (() => void) | null = null;
  private drainWaiters: Array<() => void> = [];
  private sentenceIndex = 0;
  private stoppedGeneration = 0;
  private autoplayBlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const tryUnlock = () => {
        this.unlock();
      };
      window.addEventListener('pointerdown', tryUnlock, { passive: true });
      window.addEventListener('keydown', tryUnlock, { passive: true });
    }
  }

  public isAutoplayBlocked(): boolean {
    return this.autoplayBlocked;
  }

  public unlock(): void {
    this.autoplayBlocked = false;
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => {
          this.autoplayBlocked = false;
        })
        .catch(() => {});
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public getVoices(): VoiceOption[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    const english = window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => scoreMaleVoice(b) - scoreMaleVoice(a));

    const maleOnly = english.filter((v) => scoreMaleVoice(v) > 0);
    const list = maleOnly.length >= 2 ? maleOnly : english.filter((v) => !isFemaleVoice(v));
    const finalVoices = list.length > 0 ? list : english;

    return finalVoices.map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
    }));
  }

  public pickDefaultVoices(): { seeker: string; skeptic: string; trump: string; biden: string } {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return { seeker: '', skeptic: '', trump: '', biden: '' };
    }
    const allEnglish = window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => scoreMaleVoice(b) - scoreMaleVoice(a));

    if (allEnglish.length === 0) return { seeker: '', skeptic: '', trump: '', biden: '' };

    const pool = allEnglish.filter((v) => !isFemaleVoice(v) && scoreMaleVoice(v) > -500);
    const candidates = pool.length >= 2 ? pool : allEnglish;

    // Zorblax (Alien, left): deep, calm, resonant male voice
    const seekerVoice =
      candidates.find((v) =>
        /ryan|daniel|arthur|oliver|george|brian|william|google uk english male|mark|david/i.test(
          v.name
        )
      ) || candidates[0];

    // Socrates (right): strictly different male voice for sharp contrast
    const skepticVoice =
      candidates.find(
        (v) =>
          v.voiceURI !== seekerVoice.voiceURI &&
          /andrew|guy|christopher|eric|davis|steffan|aaron|reed|alex|gordon|lee|thomas|liam/i.test(
            v.name
          )
      ) ||
      candidates.find((v) => v.voiceURI !== seekerVoice.voiceURI) ||
      candidates[0];

    const trumpVoice =
      candidates.find(
        (v) =>
          /christopher|guy|andrew|steffan|mark|aaron|alex/i.test(v.name) &&
          v.voiceURI !== seekerVoice.voiceURI
      ) || skepticVoice;

    const bidenVoice =
      candidates.find(
        (v) =>
          /david|george|arthur|brian|davis|reed|daniel/i.test(v.name) &&
          v.voiceURI !== trumpVoice.voiceURI
      ) || seekerVoice;

    return {
      seeker: seekerVoice.voiceURI,
      skeptic: skepticVoice.voiceURI,
      trump: trumpVoice.voiceURI,
      biden: bidenVoice.voiceURI,
    };
  }

  public playCodecChime(agent: AgentId, enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const baseFreq =
      agent === 'seeker' ? 432 : agent === 'skeptic' ? 360 : agent === 'trump' ? 520 : 300;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.12, now + 0.09);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.02, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playWakeAck(): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [528, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      gain.gain.setValueAtTime(0.0001, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.035, now + i * 0.07 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.24);
    });
  }

  public enqueueSentence(text: string, agent: AgentId, voiceURI: string, muted: boolean): void {
    if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || clean === '...') return;

    this.sentenceQueue.push({ text: clean, agent, voiceURI });
    if (!this.activeUtterance) {
      this.pumpQueue();
    }
  }

  private pumpQueue(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.resolveDrain();
      return;
    }

    const next = this.sentenceQueue.shift();
    if (!next) {
      this.activeUtterance = null;
      this.isSpeaking = false;
      this.resolveDrain();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(next.text);
    const voices = window.speechSynthesis.getVoices();
    const fallback = this.pickDefaultVoices();
    const targetURI =
      next.voiceURI ||
      (next.agent === 'seeker'
        ? fallback.seeker
        : next.agent === 'skeptic'
          ? fallback.skeptic
          : next.agent === 'trump'
            ? fallback.trump
            : fallback.biden);

    if (targetURI) {
      const matched = voices.find((v) => v.voiceURI === targetURI);
      if (matched) utterance.voice = matched;
    }

    // Distinct male prosody across Zorblax, Socrates, Trump, and Biden
    this.sentenceIndex++;
    const micro = ((this.sentenceIndex % 3) - 1) * 0.015;
    if (next.agent === 'seeker') {
      utterance.pitch = 0.86 + micro;
      utterance.rate = 0.98;
    } else if (next.agent === 'skeptic') {
      utterance.pitch = 1.03 + micro;
      utterance.rate = 1.04;
    } else if (next.agent === 'trump') {
      utterance.pitch = 0.96 + micro;
      utterance.rate = 1.05;
    } else {
      utterance.pitch = 0.80 + micro;
      utterance.rate = 0.90;
    }
    utterance.volume = 0.92;

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.speechStartedAt = performance.now();
    };

    let safetyTimer = 0;
    const finish = () => {
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = 0;
      }
      if (this.activeUtterance === utterance) {
        this.activeUtterance = null;
        this.isSpeaking = false;
        window.setTimeout(() => this.pumpQueue(), 20);
      }
    };

    safetyTimer = window.setTimeout(finish, Math.max(5000, next.text.length * 110));
    utterance.onend = finish;
    utterance.onerror = finish;

    this.activeUtterance = utterance;
    this.isSpeaking = true;
    this.speechStartedAt = performance.now();
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }
    window.speechSynthesis.speak(utterance);
  }

  public waitForQueueDrain(): Promise<void> {
    if (!this.activeUtterance && this.sentenceQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
      window.setTimeout(() => {
        this.resolveDrain();
      }, 26000);
    });
  }

  private resolveDrain(): void {
    const waiters = this.drainWaiters.splice(0, this.drainWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }

  public prefetchCameoAudio(
    text: string,
    agent: 'trump' | 'biden'
  ): { promise: Promise<Blob | null>; abort: () => void } {
    const clean = text.replace(/\s+/g, ' ').trim();
    const controller = new AbortController();
    this.cameoAbortControllers.add(controller);

    const promise = (async (): Promise<Blob | null> => {
      if (!clean || clean === '...') return null;
      const fetchOnce = async (): Promise<Blob | null> => {
        const timeoutTimer = window.setTimeout(() => {
          controller.abort();
        }, 12000);
        try {
          const res = await fetch('/api/tts/cameo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent, text: clean.slice(0, 420) }),
            signal: controller.signal,
          });
          if (!res.ok) return null;
          const blob = await res.blob();
          if (controller.signal.aborted || blob.size < 512) return null;
          return blob;
        } catch {
          return null;
        } finally {
          clearTimeout(timeoutTimer);
        }
      };

      try {
        const first = await fetchOnce();
        if (first || controller.signal.aborted) return first;
        // One quick automatic retry on transient network failure
        return await fetchOnce();
      } finally {
        this.cameoAbortControllers.delete(controller);
      }
    })();

    return {
      promise,
      abort: () => controller.abort(),
    };
  }

  private async playCameoBlob(blob: Blob, myStopGen: number): Promise<'ok' | 'blocked' | 'error'> {
    if (this.stoppedGeneration !== myStopGen) return 'ok';
    const ctx = this.ensureAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await Promise.race([
          ctx.resume().catch(() => {}),
          new Promise<void>((r) => window.setTimeout(r, 150)),
        ]);
      }
      if (this.stoppedGeneration !== myStopGen) return 'ok';
      if (ctx.state === 'running') {
        try {
          const rawBuf = await blob.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(rawBuf.slice(0));
          if (audioBuf.duration <= 0.05) return 'error';
          if (this.stoppedGeneration !== myStopGen) return 'ok';

          this.autoplayBlocked = false;
          await new Promise<void>((resolve) => {
            let settled = false;
            const src = ctx.createBufferSource();
            src.buffer = audioBuf;

            const gain = ctx.createGain();
            gain.gain.value = 1.7;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;

            src.connect(gain);
            gain.connect(analyser);
            analyser.connect(ctx.destination);

            this.activeCameoSource = src;
            this.cameoAnalyser = analyser;
            this.cameoAnalyserBins = new Uint8Array(analyser.frequencyBinCount);

            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(safetyTimer);
              if (this.activeCameoSource === src) {
                this.activeCameoSource = null;
              }
              this.cameoAnalyser = null;
              this.cameoAnalyserBins = null;
              this.cameoWaiter = null;
              this.isSpeaking = false;
              try {
                src.disconnect();
                gain.disconnect();
                analyser.disconnect();
              } catch {
                // ignore
              }
              resolve();
            };

            const safetyTimer = window.setTimeout(
              finish,
              Math.max(5000, Math.ceil(audioBuf.duration * 1000) + 2500)
            );
            this.cameoWaiter = finish;
            src.onended = finish;

            this.isSpeaking = true;
            this.speechStartedAt = performance.now();
            src.start(0);
          });
          return 'ok';
        } catch {
          return 'error';
        }
      }
    }

    // Secondary path: HTMLAudioElement if Web Audio wasn't resumed yet
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.volume = 1.0;
    this.activeCameoAudio = audio;

    return new Promise<'ok' | 'blocked' | 'error'>((resolve) => {
      let settled = false;
      let started = false;
      const cleanup = () => {
        clearTimeout(safetyTimer);
        if (this.activeCameoAudio === audio) {
          this.activeCameoAudio = null;
        }
        this.cameoWaiter = null;
        this.isSpeaking = false;
        URL.revokeObjectURL(objectUrl);
      };
      const done = (outcome: 'ok' | 'blocked' | 'error') => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(outcome);
      };

      const safetyTimer = window.setTimeout(() => done('ok'), 22000);
      this.cameoWaiter = () => done('ok');
      audio.onplaying = () => {
        started = true;
        this.autoplayBlocked = false;
        this.isSpeaking = true;
        this.speechStartedAt = performance.now();
      };
      audio.onended = () => done('ok');
      audio.onerror = () => done(started ? 'ok' : 'error');

      this.isSpeaking = true;
      this.speechStartedAt = performance.now();
      audio.play().catch((err: unknown) => {
        const isAutoplayBlock =
          err instanceof Error &&
          (err.name === 'NotAllowedError' || /user didn't interact|not allowed/i.test(err.message));
        if (isAutoplayBlock) {
          this.autoplayBlocked = true;
          done('blocked');
        } else {
          done('error');
        }
      });
    });
  }

  private async fallbackSpeakSentence(
    text: string,
    agent: AgentId,
    voiceURI: string,
    muted: boolean,
    myStopGen: number
  ): Promise<void> {
    if (muted || this.stoppedGeneration !== myStopGen) return;
    this.sentenceQueue = [];
    this.activeUtterance = null;
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      await new Promise<void>((r) => window.setTimeout(r, 60));
    }
    if (this.stoppedGeneration !== myStopGen) return;
    this.enqueueSentence(text, agent, voiceURI, muted);
    await this.waitForQueueDrain();
  }

  public startCameoTurn(
    agent: 'trump' | 'biden',
    voiceURI: string,
    muted: boolean,
    onFirstAudioStart: () => void
  ): {
    pushSentence: (sentence: string) => void;
    finish: () => void;
    done: Promise<void>;
    abort: () => void;
  } {
    const myStopGen = this.stoppedGeneration;
    const queue: Array<{
      text: string;
      req: { promise: Promise<Blob | null>; abort: () => void } | null;
    }> = [];
    let streamFinished = false;
    let firstStarted = false;
    let wakeWaiter: (() => void) | null = null;

    const notifyWaiter = () => {
      const fn = wakeWaiter;
      wakeWaiter = null;
      fn?.();
    };

    const fireStart = () => {
      if (!firstStarted) {
        firstStarted = true;
        onFirstAudioStart();
      }
    };

    const done = (async () => {
      if (muted) {
        fireStart();
        return;
      }

      while (this.stoppedGeneration === myStopGen) {
        if (queue.length === 0) {
          if (streamFinished) break;
          await new Promise<void>((resolve) => {
            wakeWaiter = resolve;
          });
          continue;
        }

        const item = queue.shift()!;
        const blob = item.req ? await item.req.promise : null;
        if (this.stoppedGeneration !== myStopGen) break;

        fireStart();

        if (blob) {
          const outcome = await this.playCameoBlob(blob, myStopGen);
          if (this.stoppedGeneration !== myStopGen) break;
          if (outcome === 'ok' || outcome === 'blocked') {
            continue;
          }
        }

        // Real TTS or decode failure (not browser autoplay lock): clean browser speech fallback
        await this.fallbackSpeakSentence(item.text, agent, voiceURI, muted, myStopGen);
      }
    })();

    return {
      pushSentence: (rawSentence: string) => {
        if (this.stoppedGeneration !== myStopGen) return;
        const clean = rawSentence.replace(/\s+/g, ' ').trim();
        if (!clean || clean === '...') return;
        if (muted) {
          fireStart();
          return;
        }
        const req = this.prefetchCameoAudio(clean, agent);
        queue.push({ text: clean, req });
        notifyWaiter();
      },
      finish: () => {
        streamFinished = true;
        if (muted || queue.length === 0) {
          fireStart();
        }
        notifyWaiter();
      },
      done,
      abort: () => {
        streamFinished = true;
        for (const item of queue) {
          item.req?.abort();
        }
        queue.length = 0;
        notifyWaiter();
      },
    };
  }

  public async speakCameo(
    text: string,
    agent: 'trump' | 'biden',
    voiceURI: string,
    muted: boolean,
    prefetchedPromise?: Promise<Blob | null>
  ): Promise<void> {
    if (muted || typeof window === 'undefined') return;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || clean === '...') return;
    const myStopGen = this.stoppedGeneration;

    try {
      const blob = prefetchedPromise
        ? await prefetchedPromise
        : await this.prefetchCameoAudio(clean, agent).promise;

      if (this.stoppedGeneration !== myStopGen) return;
      if (!blob || blob.size < 512) {
        throw new Error('Cameo audio unavailable');
      }

      const outcome = await this.playCameoBlob(blob, myStopGen);
      if (outcome === 'error' && this.stoppedGeneration === myStopGen) {
        await this.fallbackSpeakSentence(clean, agent, voiceURI, muted, myStopGen);
      }
    } catch {
      if (this.stoppedGeneration !== myStopGen) return;
      await this.fallbackSpeakSentence(clean, agent, voiceURI, muted, myStopGen);
    }
  }

  public stop(): void {
    this.stoppedGeneration++;
    this.sentenceQueue = [];
    this.activeUtterance = null;
    for (const ctrl of this.cameoAbortControllers) {
      ctrl.abort();
    }
    this.cameoAbortControllers.clear();
    if (this.activeCameoSource) {
      try {
        this.activeCameoSource.stop();
      } catch {
        // ignore
      }
      this.activeCameoSource = null;
    }
    this.cameoAnalyser = null;
    this.cameoAnalyserBins = null;
    if (this.activeCameoAudio) {
      try {
        this.activeCameoAudio.pause();
        this.activeCameoAudio.src = '';
      } catch {
        // ignore
      }
      this.activeCameoAudio = null;
    }
    this.cameoWaiter?.();
    this.cameoWaiter = null;
    this.isSpeaking = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.resolveDrain();
  }

  public getEnergy(isSpeakingNow: boolean): number {
    if (this.cameoAnalyser && this.cameoAnalyserBins) {
      this.cameoAnalyser.getByteFrequencyData(this.cameoAnalyserBins);
      let sum = 0;
      const len = Math.min(36, this.cameoAnalyserBins.length);
      for (let i = 0; i < len; i++) {
        sum += this.cameoAnalyserBins[i];
      }
      const avg = sum / Math.max(1, len * 255);
      return Math.min(1, Math.max(0.12, avg * 2.6));
    }
    if (!isSpeakingNow && !this.isSpeaking) return 0;
    const t = (performance.now() - this.speechStartedAt) * 0.001;
    const syllable = Math.sin(t * 11.5) * 0.35 + Math.sin(t * 17.3) * 0.25 + 0.55;
    const breath = 0.72 + 0.28 * Math.sin(t * 2.9);
    return Math.min(1, Math.max(0.15, syllable * breath));
  }
}

export const dialogueAudio = new DialogueAudioEngine();
