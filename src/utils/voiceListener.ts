export type WakeListenState = 'off' | 'arming' | 'capturing';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface WakeListenerCallbacks {
  onStateChange: (state: WakeListenState) => void;
  onWakeDetected: () => void;
  onInterimQuestion: (text: string) => void;
  onQuestionCommitted: (question: string) => void;
  onError: (message: string) => void;
}

const WAKE_WORD_REGEX = /\b(?:socrates|socratis|socrate|socratese|so\s+crates)\b/i;

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export class SocratesWakeListener {
  private recognition: SpeechRecognitionLike | null = null;
  private mediaStream: MediaStream | null = null;
  private active = false;
  private phase: WakeListenState = 'off';
  private callbacks: WakeListenerCallbacks | null = null;
  private silenceTimer: number | null = null;
  private maxCaptureTimer: number | null = null;
  private capturedText = '';
  private wakeResultFloor = 0;
  private wakeStartIndex = 0;
  private lastResultLength = 0;

  public isSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  public async start(callbacks: WakeListenerCallbacks): Promise<boolean> {
    this.callbacks = callbacks;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      callbacks.onError('Speech recognition is not supported in this browser (try Chrome or Edge).');
      return false;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      callbacks.onError('Microphone permission denied.');
      return false;
    }

    this.active = true;
    this.setPhase('arming');
    this.bootRecognition(Ctor);
    return true;
  }

  private setPhase(next: WakeListenState): void {
    this.phase = next;
    this.callbacks?.onStateChange(next);
  }

  private clearTimers(): void {
    if (this.silenceTimer !== null) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxCaptureTimer !== null) {
      window.clearTimeout(this.maxCaptureTimer);
      this.maxCaptureTimer = null;
    }
  }

  private bootRecognition(Ctor: new () => SpeechRecognitionLike): void {
    if (!this.active) return;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      if (!this.active) return;
      this.lastResultLength = event.results.length;

      if (this.phase === 'arming') {
        const startIdx = Math.max(this.wakeResultFloor, event.resultIndex);
        for (let i = startIdx; i < event.results.length; i++) {
          const transcript = event.results[i][0]?.transcript || '';
          const match = WAKE_WORD_REGEX.exec(transcript);
          if (match) {
            const afterWake = transcript
              .slice(match.index + match[0].length)
              .replace(/^[\s,.:;!?-]+/, '')
              .trim();

            this.wakeStartIndex = i;
            this.wakeResultFloor = event.results.length;
            this.capturedText = afterWake;
            this.setPhase('capturing');
            this.callbacks?.onWakeDetected();
            this.callbacks?.onInterimQuestion(afterWake);
            this.scheduleCaptureTimers(afterWake.length > 0);
            return;
          }
        }
        return;
      }

      if (this.phase === 'capturing') {
        const segments: string[] = [];
        for (let i = this.wakeStartIndex; i < event.results.length; i++) {
          const raw = event.results[i][0]?.transcript || '';
          let cleaned = raw;
          if (i === this.wakeStartIndex) {
            const wakeMatch = WAKE_WORD_REGEX.exec(raw);
            cleaned = wakeMatch
              ? raw.slice(wakeMatch.index + wakeMatch[0].length).replace(/^[\s,.:;!?-]+/, '')
              : raw;
          }
          if (cleaned.trim()) {
            segments.push(cleaned.trim());
          }
        }

        const joined = segments.join(' ').replace(/\s+/g, ' ').trim();
        if (joined) {
          this.capturedText = joined;
          this.callbacks?.onInterimQuestion(joined);
          this.scheduleCaptureTimers(true);
        }
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (!this.active) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.callbacks?.onError('Microphone access blocked.');
        this.stop();
      }
    };

    rec.onend = () => {
      if (!this.active) return;
      if (this.phase === 'capturing' && this.capturedText.trim().length >= 3) {
        this.commitCapture();
      }
      this.wakeResultFloor = 0;
      this.wakeStartIndex = 0;
      this.lastResultLength = 0;
      window.setTimeout(() => {
        if (this.active) {
          const NextCtor = getSpeechRecognitionCtor();
          if (NextCtor) this.bootRecognition(NextCtor);
        }
      }, 180);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // Ignore if already started
    }
  }

  private scheduleCaptureTimers(hasWords: boolean): void {
    if (this.silenceTimer !== null) {
      window.clearTimeout(this.silenceTimer);
    }
    const waitMs = hasWords ? 1600 : 7000;
    this.silenceTimer = window.setTimeout(() => {
      this.commitCapture();
    }, waitMs);

    if (this.maxCaptureTimer === null) {
      this.maxCaptureTimer = window.setTimeout(() => {
        this.commitCapture();
      }, 13000);
    }
  }

  private commitCapture(): void {
    this.clearTimers();
    const question = this.capturedText.replace(/^[\s,.:;!?-]+/, '').trim();
    this.capturedText = '';
    this.wakeResultFloor = this.lastResultLength;
    this.wakeStartIndex = this.lastResultLength;
    this.setPhase('arming');

    if (question.length >= 3) {
      this.callbacks?.onQuestionCommitted(question);
    } else {
      this.callbacks?.onInterimQuestion('');
    }
  }

  public stop(): void {
    this.active = false;
    this.clearTimers();
    this.capturedText = '';
    this.wakeResultFloor = 0;

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    this.setPhase('off');
  }
}
