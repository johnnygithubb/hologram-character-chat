import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  FileText,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  PhoneCall,
  Users,
} from 'lucide-react';
import { HologramStage } from './components/HologramStage';
import { TranscriptDrawer } from './components/TranscriptDrawer';
import { SettingsModal } from './components/SettingsModal';
import { HeadlinePickerModal } from './components/HeadlinePickerModal';
import {
  DEFAULT_BIDEN_DEBATE_PROMPT,
  DEFAULT_BIDEN_PROMPT,
  DEFAULT_SEEKER_PROMPT,
  DEFAULT_SKEPTIC_PROMPT,
  DEFAULT_TRUMP_DEBATE_PROMPT,
  DEFAULT_TRUMP_PROMPT,
  DEFAULT_TRUMP_SOLO_PROMPT,
  PHILOSOPHICAL_TOPICS,
  pickChaosEvent,
  type AgentId,
  type CameoAgentId,
  type CastMode,
  type DialogueMessage,
  type DialogueSettings,
  type ServerStatus,
  type SessionStats,
} from './types/dialogue';
import { dialogueAudio, type VoiceOption } from './utils/speech';
import { SocratesWakeListener, type WakeListenState } from './utils/voiceListener';
import { Newspaper } from 'lucide-react';

const CAMEO_INTERVAL_MS = 5 * 60 * 1000;

const INITIAL_SETTINGS: DialogueSettings = {
  aiProvider: 'auto',
  castMode: 'duo',
  seekerModel: 'google/gemini-2.5-flash-lite',
  skepticModel: 'openai/gpt-4o-mini',
  seekerPrompt: DEFAULT_SEEKER_PROMPT,
  skepticPrompt: DEFAULT_SKEPTIC_PROMPT,
  temperature: 0.85,
  turnDelaySeconds: 0.5,
  maxTokens: 110,
  topicMode: 'autonomous',
  customTopic: '',
  codecChimes: true,
  seekerVoiceURI: '',
  skepticVoiceURI: '',
  chaosMode: true,
};

const INITIAL_STATS: SessionStats = {
  totalTurns: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  summariesGenerated: 0,
  startedAt: null,
};

const AUTONOMOUS_SEEDS = PHILOSOPHICAL_TOPICS.filter((t) => t !== 'Autonomous Evolution');

function sleepInterruptible(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

export default function App() {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [canStart, setCanStart] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showDialogue, setShowDialogue] = useState<boolean>(true);
  const [transcriptOpen, setTranscriptOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [headlinePickerOpen, setHeadlinePickerOpen] = useState<boolean>(false);

  const [wakeState, setWakeState] = useState<WakeListenState>('off');
  const [wakePromptText, setWakePromptText] = useState<string | null>(null);

  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [archivalSummary, setArchivalSummary] = useState<string>('');
  const [activeSpeaker, setActiveSpeaker] = useState<AgentId>('seeker');
  const [activeCameo, setActiveCameo] = useState<CameoAgentId | null>(null);
  const [seekerDisplay, setSeekerDisplay] = useState<string>('');
  const [skepticDisplay, setSkepticDisplay] = useState<string>('');
  const [cameoDisplay, setCameoDisplay] = useState<string>('');
  const [activeProvider, setActiveProvider] = useState<string>('Auto');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [currentTopic, setCurrentTopic] = useState<string>('Consciousness');

  const [settings, setSettings] = useState<DialogueSettings>(INITIAL_SETTINGS);
  const [stats, setStats] = useState<SessionStats>(INITIAL_STATS);
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  const settingsRef = useRef(settings);
  const messagesRef = useRef(messages);
  const summaryRef = useRef(archivalSummary);
  const mutedRef = useRef(isMuted);
  const topicRef = useRef(currentTopic);
  const observerQuestionRef = useRef<{
    text: string;
    stage: 'alien_first' | 'skeptic_second';
  } | null>(null);
  const forceSpeakerRef = useRef<AgentId | null>(null);
  const lastCoreAgentRef = useRef<'seeker' | 'skeptic'>('skeptic');
  const lastCameoAgentRef = useRef<'trump' | 'biden'>('biden');
  const cameoRemainingRef = useRef<number>(0);
  const lastCameoAtRef = useRef<number>(Date.now());
  const lastChaosTurnRef = useRef<number>(0);
  const loopAbortRef = useRef<AbortController | null>(null);
  const sessionGenerationRef = useRef<number>(0);
  const wakeListenerRef = useRef<SocratesWakeListener | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    summaryRef.current = archivalSummary;
  }, [archivalSummary]);

  useEffect(() => {
    mutedRef.current = isMuted;
    if (isMuted) {
      dialogueAudio.stop();
    }
  }, [isMuted]);

  useEffect(() => {
    topicRef.current = currentTopic;
  }, [currentTopic]);

  const checkServerStatus = useCallback(async (autoStart: boolean) => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Unable to reach server');
      const data = (await res.json()) as ServerStatus;
      setIsConfigured(data.configured);
      const ready = data.configured || data.freeRelayAvailable;
      setCanStart(ready);
      setSettings((prev) => ({
        ...prev,
        seekerModel:
          data.defaultSeekerModel && !data.defaultSeekerModel.endsWith(':free')
            ? data.defaultSeekerModel
            : prev.seekerModel,
        skepticModel:
          data.defaultSkepticModel && !data.defaultSkepticModel.endsWith(':free')
            ? data.defaultSkepticModel
            : prev.skepticModel,
      }));
      if (ready && autoStart) {
        setStats((s) => ({ ...s, startedAt: s.startedAt ?? Date.now() }));
        setIsRunning(true);
      }
    } catch {
      setIsConfigured(false);
      setCanStart(false);
    }
  }, []);

  useEffect(() => {
    void checkServerStatus(true);

    const syncVoices = () => {
      const available = dialogueAudio.getVoices();
      setVoices(available);
      if (available.length > 0) {
        const picked = dialogueAudio.pickDefaultVoices();
        setSettings((prev) => ({
          ...prev,
          seekerVoiceURI: prev.seekerVoiceURI || picked.seeker,
          skepticVoiceURI: prev.skepticVoiceURI || picked.skeptic,
        }));
      }
    };

    syncVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
      };
    }
  }, [checkServerStatus]);

  useEffect(() => {
    return () => {
      wakeListenerRef.current?.stop();
    };
  }, []);

  const handleToggleMic = useCallback(async () => {
    dialogueAudio.unlock();
    if (wakeState !== 'off') {
      wakeListenerRef.current?.stop();
      setWakePromptText(null);
      return;
    }

    if (!wakeListenerRef.current) {
      wakeListenerRef.current = new SocratesWakeListener();
    }

    setStatusNote(null);
    await wakeListenerRef.current.start({
      onStateChange: (nextState) => {
        setWakeState(nextState);
      },
      onWakeDetected: () => {
        dialogueAudio.stop();
        dialogueAudio.playWakeAck();
        loopAbortRef.current?.abort();
        sessionGenerationRef.current++;
        setIsRunning(false);
        setIsSpeaking(false);
        setActiveCameo(null);
        setSeekerDisplay('');
        setSkepticDisplay('');
        setCameoDisplay('');
        setWakePromptText('');
        setStatusNote('Listening...');
      },
      onInterimQuestion: (text) => {
        setWakePromptText(text);
      },
      onQuestionCommitted: (question) => {
        dialogueAudio.stop();
        loopAbortRef.current?.abort();
        setWakePromptText(question);
        setStatusNote(null);
        setCurrentTopic(question);
        cameoRemainingRef.current = 0;
        setActiveCameo(null);
        setSeekerDisplay('');
        setSkepticDisplay('');
        setCameoDisplay('');
        const firstSpeaker: AgentId =
          settingsRef.current.castMode === 'duo' ? 'seeker' : 'trump';
        setActiveSpeaker(firstSpeaker);
        forceSpeakerRef.current = firstSpeaker;
        observerQuestionRef.current = { text: question, stage: 'alien_first' };
        setSettings((prev) => ({
          ...prev,
          topicMode: 'custom',
          customTopic: question,
        }));

        // Clear the spoken question banner gently after minds engage
        window.setTimeout(() => {
          setWakePromptText((cur) => (cur === question ? null : cur));
        }, 10000);

        // Immediately interrupt and launch response
        sessionGenerationRef.current++;
        setIsRunning(false);
        window.setTimeout(() => setIsRunning(true), 40);
      },
      onError: (msg) => {
        setStatusNote(msg);
      },
    });
  }, [wakeState]);

  const resetForCastMode = useCallback(
    (nextMode: CastMode) => {
      dialogueAudio.unlock();
      dialogueAudio.stop();
      loopAbortRef.current?.abort();
      messagesRef.current = [];
      summaryRef.current = '';
      observerQuestionRef.current = null;
      forceSpeakerRef.current = null;
      cameoRemainingRef.current = 0;
      lastCameoAtRef.current = Date.now();
      lastCoreAgentRef.current = 'skeptic';
      lastCameoAgentRef.current = 'biden';
      lastChaosTurnRef.current = 0;
      setMessages([]);
      setArchivalSummary('');
      setActiveCameo(nextMode === 'trump-only' ? 'trump' : null);
      setSeekerDisplay('');
      setSkepticDisplay('');
      setCameoDisplay('');
      setActiveSpeaker(nextMode === 'duo' ? 'seeker' : 'trump');
      setStatusNote(
        nextMode === 'trump-only'
          ? 'Trump Solo'
          : nextMode === 'trump-biden'
            ? 'Trump & Biden'
            : 'Zorblax & Socrates'
      );
      sessionGenerationRef.current++;
      if (canStart) {
        setIsRunning(false);
        window.setTimeout(() => setIsRunning(true), 40);
      }
    },
    [canStart]
  );

  const handleToggleCastMode = useCallback(() => {
    const cur = settingsRef.current.castMode;
    const nextMode: CastMode =
      cur === 'duo' ? 'trump-biden' : cur === 'trump-biden' ? 'trump-only' : 'duo';
    setSettings((prev) => ({ ...prev, castMode: nextMode }));
    resetForCastMode(nextMode);
  }, [resetForCastMode]);

  const handleTriggerCameo = useCallback(() => {
    if (!canStart) return;
    dialogueAudio.unlock();
    dialogueAudio.stop();
    loopAbortRef.current?.abort();
    observerQuestionRef.current = null;
    forceSpeakerRef.current = null;
    lastCameoAtRef.current = Date.now();
    cameoRemainingRef.current = 3;
    setSeekerDisplay('');
    setSkepticDisplay('');
    setCameoDisplay('');
    setStatusNote(null);
    sessionGenerationRef.current++;
    setIsRunning(false);
    window.setTimeout(() => setIsRunning(true), 50);
  }, [canStart]);

  const handleSelectHeadline = useCallback((headline: string) => {
    dialogueAudio.stop();
    loopAbortRef.current?.abort();
    setCurrentTopic(headline);
    cameoRemainingRef.current = 0;
    setActiveCameo(null);
    setSeekerDisplay('');
    setSkepticDisplay('');
    setCameoDisplay('');
    const firstSpeaker: AgentId =
      settingsRef.current.castMode === 'duo' ? 'seeker' : 'trump';
    setActiveSpeaker(firstSpeaker);
    forceSpeakerRef.current = firstSpeaker;
    observerQuestionRef.current = { text: `Discuss headline: ${headline}`, stage: 'alien_first' };
    setSettings((prev) => ({
      ...prev,
      topicMode: 'custom',
      customTopic: headline,
    }));
    sessionGenerationRef.current++;
    setIsRunning(false);
    window.setTimeout(() => setIsRunning(true), 40);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (canStart) setIsRunning((r) => !r);
      } else if (e.key === 'h' || e.key === 'H') {
        setShowDialogue((v) => !v);
      } else if (e.key === 't' || e.key === 'T') {
        setTranscriptOpen((v) => !v);
      } else if (e.key === 'm' || e.key === 'M') {
        setIsMuted((m) => !m);
      } else if (e.key === 'c' || e.key === 'C') {
        handleTriggerCameo();
      } else if (e.key === 'v' || e.key === 'V') {
        handleToggleCastMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStart, handleTriggerCameo, handleToggleCastMode]);

  const summarizeIfNeeded = useCallback(
    async (
      currentHistory: DialogueMessage[],
      currentSummary: string,
      signal: AbortSignal
    ): Promise<{ trimmedHistory: DialogueMessage[]; updatedSummary: string }> => {
      if (currentHistory.length <= 14) {
        return { trimmedHistory: currentHistory, updatedSummary: currentSummary };
      }

      const toSummarize = currentHistory.slice(0, 6);
      const remaining = currentHistory.slice(6);

      try {
        const res = await fetch('/api/dialogue/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiProvider: settingsRef.current.aiProvider,
            model: settingsRef.current.skepticModel,
            previousSummary: currentSummary,
            turns: toSummarize.map((m) => ({ agent: m.agent, content: m.content })),
          }),
          signal,
        });

        if (res.ok) {
          const data = (await res.json()) as {
            summary?: string;
            usage?: { prompt: number; completion: number; total: number };
          };
          const nextSummary = data.summary || currentSummary;
          if (nextSummary !== currentSummary) {
            setArchivalSummary(nextSummary);
            setStats((prev) => ({
              ...prev,
              summariesGenerated: prev.summariesGenerated + 1,
              promptTokens: prev.promptTokens + (data.usage?.prompt ?? 0),
              completionTokens: prev.completionTokens + (data.usage?.completion ?? 0),
              totalTokens: prev.totalTokens + (data.usage?.total ?? 0),
            }));
          }
          setMessages(remaining);
          return { trimmedHistory: remaining, updatedSummary: nextSummary };
        }
      } catch {
        // Retain recent window gracefully
      }

      return { trimmedHistory: currentHistory.slice(-12), updatedSummary: currentSummary };
    },
    []
  );

  // Core autonomous conversation loop with slow reading-speed reveal
  useEffect(() => {
    if (!isRunning || !canStart) {
      loopAbortRef.current?.abort();
      setIsSpeaking(false);
      return;
    }

    const generation = ++sessionGenerationRef.current;
    const controller = new AbortController();
    loopAbortRef.current = controller;

    const run = async () => {
      let retryCount = 0;

      while (!controller.signal.aborted && sessionGenerationRef.current === generation) {
        const cfg = settingsRef.current;
        const isTrumpOnlyMode = cfg.castMode === 'trump-only';
        const isTrumpBidenMode = cfg.castMode === 'trump-biden';
        const currentMsgs = messagesRef.current;
        const forcedSpeaker = forceSpeakerRef.current;
        forceSpeakerRef.current = null;

        const cameoDue =
          cfg.castMode === 'duo' &&
          !forcedSpeaker &&
          !observerQuestionRef.current &&
          cameoRemainingRef.current === 0 &&
          currentMsgs.length >= 2 &&
          Date.now() - lastCameoAtRef.current >= CAMEO_INTERVAL_MS;

        let nextSpeaker: AgentId;
        if (forcedSpeaker) {
          nextSpeaker = forcedSpeaker;
          if (nextSpeaker === 'trump' || nextSpeaker === 'biden') {
            lastCameoAgentRef.current = nextSpeaker;
          }
        } else if (isTrumpOnlyMode) {
          nextSpeaker = 'trump';
        } else if (isTrumpBidenMode) {
          nextSpeaker = lastCameoAgentRef.current === 'trump' ? 'biden' : 'trump';
          lastCameoAgentRef.current = nextSpeaker;
        } else if (cameoDue || cameoRemainingRef.current > 0) {
          if (cameoDue) {
            cameoRemainingRef.current = 3;
            lastCameoAtRef.current = Date.now();
          }
          cameoRemainingRef.current = Math.max(0, cameoRemainingRef.current - 1);
          nextSpeaker = lastCameoAgentRef.current === 'trump' ? 'biden' : 'trump';
          lastCameoAgentRef.current = nextSpeaker;
        } else if (currentMsgs.length === 0) {
          nextSpeaker = 'seeker';
        } else {
          nextSpeaker = lastCoreAgentRef.current === 'seeker' ? 'skeptic' : 'seeker';
        }

        if (nextSpeaker === 'seeker' || nextSpeaker === 'skeptic') {
          lastCoreAgentRef.current = nextSpeaker;
        }

        const nextTurnNum = (currentMsgs[currentMsgs.length - 1]?.turn ?? 0) + 1;

        const effectiveTopic =
          cfg.topicMode === 'autonomous'
            ? topicRef.current
            : cfg.topicMode === 'custom'
              ? cfg.customTopic.trim() || 'Existence'
              : cfg.topicMode;

        if (cfg.topicMode === 'autonomous' && nextTurnNum > 1 && nextTurnNum % 8 === 0) {
          const nextSeed =
            AUTONOMOUS_SEEDS[Math.floor(Math.random() * AUTONOMOUS_SEEDS.length)];
          setCurrentTopic(nextSeed);
        }

        let chaosDirective = '';
        if (cfg.chaosMode && !observerQuestionRef.current && nextSpeaker !== 'trump' && nextSpeaker !== 'biden') {
          const event = pickChaosEvent(nextTurnNum, lastChaosTurnRef.current);
          if (event) {
            lastChaosTurnRef.current = nextTurnNum;
            chaosDirective = event;
          }
        }

        const { trimmedHistory, updatedSummary } = await summarizeIfNeeded(
          currentMsgs,
          summaryRef.current,
          controller.signal
        );

        if (controller.signal.aborted) break;

        setActiveSpeaker(nextSpeaker);
        setActiveCameo(
          isTrumpOnlyMode
            ? 'trump'
            : !isTrumpBidenMode && (nextSpeaker === 'trump' || nextSpeaker === 'biden')
              ? nextSpeaker
              : null
        );
        setStatusNote(null);

        const activeObserver = observerQuestionRef.current;
        let observerQuestion = '';
        let observerStage: 'alien_first' | 'skeptic_second' | undefined;
        if (activeObserver) {
          if (isTrumpOnlyMode) {
            observerQuestion = activeObserver.text;
            observerStage = 'alien_first';
            observerQuestionRef.current = null;
          } else if (
            activeObserver.stage === 'alien_first' &&
            (nextSpeaker === 'seeker' || (isTrumpBidenMode && nextSpeaker === 'trump'))
          ) {
            observerQuestion = activeObserver.text;
            observerStage = 'alien_first';
            observerQuestionRef.current = {
              text: activeObserver.text,
              stage: 'skeptic_second',
            };
          } else if (
            activeObserver.stage === 'skeptic_second' &&
            (nextSpeaker === 'skeptic' || (isTrumpBidenMode && nextSpeaker === 'biden'))
          ) {
            observerQuestion = activeObserver.text;
            observerStage = 'skeptic_second';
            observerQuestionRef.current = null;
          }
        }

        const cameoAgent: CameoAgentId | null =
          nextSpeaker === 'trump' || nextSpeaker === 'biden' ? nextSpeaker : null;
        const displaySlot: 'left' | 'right' | 'center' =
          isTrumpOnlyMode
            ? 'center'
            : nextSpeaker === 'seeker' || (isTrumpBidenMode && nextSpeaker === 'trump')
              ? 'left'
              : nextSpeaker === 'skeptic' || (isTrumpBidenMode && nextSpeaker === 'biden')
                ? 'right'
                : 'center';

        const model =
          nextSpeaker === 'seeker' || nextSpeaker === 'trump' ? cfg.seekerModel : cfg.skepticModel;
        const systemPrompt =
          nextSpeaker === 'seeker'
            ? cfg.seekerPrompt
            : nextSpeaker === 'skeptic'
              ? cfg.skepticPrompt
              : nextSpeaker === 'trump'
                ? isTrumpOnlyMode
                  ? DEFAULT_TRUMP_SOLO_PROMPT
                  : isTrumpBidenMode
                    ? DEFAULT_TRUMP_DEBATE_PROMPT
                    : DEFAULT_TRUMP_PROMPT
                : isTrumpBidenMode
                  ? DEFAULT_BIDEN_DEBATE_PROMPT
                  : DEFAULT_BIDEN_PROMPT;
        const voiceURI =
          nextSpeaker === 'seeker'
            ? cfg.seekerVoiceURI
            : nextSpeaker === 'skeptic'
              ? cfg.skepticVoiceURI
              : '';

        let targetFullText = '';
        let streamDone = false;
        let revealArmed = !cameoAgent;
        let revealedCursor = 0;
        let spokenCursor = 0;
        let turnUsage: { prompt: number; completion: number; total: number } | undefined;
        let streamError: { message: string; status?: number } | null = null;
        let cooldownSeconds: number | null = null;
        let recommendedDelayMs = 0;

        setSeekerDisplay('');
        setSkepticDisplay('');
        setCameoDisplay('');

        if (!mutedRef.current) {
          dialogueAudio.playCodecChime(nextSpeaker, cfg.codecChimes);
        }

        if (!cameoAgent) {
          setIsSpeaking(true);
        } else {
          setIsSpeaking(false);
        }

        const cameoStream = cameoAgent
          ? dialogueAudio.startCameoTurn(cameoAgent, voiceURI, mutedRef.current, () => {
              revealArmed = true;
              setIsSpeaking(true);
            })
          : null;

        const flushReadySentences = () => {
          while (true) {
            const unspoken = targetFullText.slice(spokenCursor);
            const match = unspoken.match(/^(.*?[.!?…]+)(?:\s+|$)/);
            if (!match) break;
            const sentence = match[1].trim();
            spokenCursor += match[0].length;
            if (cameoStream) {
              cameoStream.pushSentence(sentence);
            } else {
              dialogueAudio.enqueueSentence(
                sentence,
                nextSpeaker,
                voiceURI,
                mutedRef.current
              );
            }
          }
        };

        const revealPromise = new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            if (controller.signal.aborted || sessionGenerationRef.current !== generation) {
              clearInterval(timer);
              resolve();
              return;
            }

            if (revealArmed && revealedCursor < targetFullText.length) {
              revealedCursor = Math.min(targetFullText.length, revealedCursor + 3);
              const slice = targetFullText.slice(0, revealedCursor);
              if (displaySlot === 'left') {
                setSeekerDisplay(slice);
              } else if (displaySlot === 'right') {
                setSkepticDisplay(slice);
              } else {
                setCameoDisplay(slice);
              }
            } else if (streamDone && revealArmed) {
              clearInterval(timer);
              resolve();
            }
          }, 18);
        });

        const turnStartedAt = Date.now();

        try {
          const response = await fetch('/api/dialogue/turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent: nextSpeaker,
              castMode: cfg.castMode,
              aiProvider: cfg.aiProvider,
              model,
              systemPrompt,
              summary: updatedSummary,
              history: trimmedHistory.map((m) => ({
                agent: m.agent,
                content: m.content,
              })),
              temperature: cfg.temperature,
              maxTokens: cfg.maxTokens,
              topic: effectiveTopic,
              observerQuestion,
              observerStage,
              chaosDirective,
              autonomousEvolution: cfg.topicMode === 'autonomous',
              turnNumber: nextTurnNum,
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            let errText = `HTTP ${response.status}`;
            try {
              const errJson = (await response.json()) as { error?: string };
              if (errJson.error) errText = errJson.error;
            } catch {
              // ignore
            }
            streamError = { message: errText, status: response.status };
          } else {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = '';

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (controller.signal.aborted) break;

              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split('\n');
              sseBuffer = lines.pop() ?? '';

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('data:')) continue;
                const jsonStr = line.slice(5).trim();
                if (!jsonStr) continue;

                try {
                  const evt = JSON.parse(jsonStr) as {
                    type: string;
                    content?: string;
                    provider?: string;
                    recommendedDelayMs?: number;
                    seconds?: number;
                    usage?: { prompt: number; completion: number; total: number };
                    message?: string;
                    status?: number;
                  };

                  if (evt.type === 'provider') {
                    setActiveProvider(
                      evt.provider === 'free-relay' ? 'Free Unlimited Relay' : 'OpenRouter'
                    );
                    if (typeof evt.recommendedDelayMs === 'number') {
                      recommendedDelayMs = evt.recommendedDelayMs;
                    }
                  } else if (evt.type === 'delta' && evt.content) {
                    const maxS = 4;
                    targetFullText = clampToMaxSentences(targetFullText + evt.content, maxS);
                    spokenCursor = Math.min(spokenCursor, targetFullText.length);
                    flushReadySentences();
                  } else if (evt.type === 'usage' && evt.usage) {
                    turnUsage = evt.usage;
                  } else if (evt.type === 'cooldown' && typeof evt.seconds === 'number') {
                    cooldownSeconds = evt.seconds;
                    setActiveProvider('Free Unlimited Relay');
                  } else if (evt.type === 'error') {
                    streamError = {
                      message: evt.message || 'AI stream error',
                      status: evt.status,
                    };
                  }
                } catch {
                  // ignore malformed SSE lines
                }
              }
            }
          }
        } catch (err) {
          if (controller.signal.aborted) break;
          streamError = {
            message: err instanceof Error ? err.message : 'Network error',
          };
        } finally {
          streamDone = true;
          if (!cameoAgent) {
            revealArmed = true;
          }
        }

        if (cooldownSeconds !== null && !controller.signal.aborted) {
          cameoStream?.abort();
          setIsSpeaking(false);
          let remaining = cooldownSeconds;
          while (remaining > 0 && !controller.signal.aborted) {
            setStatusNote(`Resuming in ${remaining}s`);
            const ok = await sleepInterruptible(1000, controller.signal);
            if (!ok) break;
            remaining--;
          }
          setStatusNote(null);
          continue;
        }

        if (streamError) {
          cameoStream?.abort();
          revealArmed = true;
          await revealPromise;
          if (controller.signal.aborted || sessionGenerationRef.current !== generation) {
            break;
          }
          dialogueAudio.stop();
          setIsSpeaking(false);
          const isFatal =
            streamError.status === 401 ||
            streamError.status === 403 ||
            streamError.status === 400;

          if (!isFatal && retryCount < 3) {
            retryCount++;
            const backoffMs = 2000 * Math.pow(2, retryCount - 1);
            setStatusNote(`Reconnecting in ${backoffMs / 1000}s`);
            const ok = await sleepInterruptible(backoffMs, controller.signal);
            if (!ok) break;
            setStatusNote(null);
            continue;
          }

          setStatusNote(streamError.message);
          setIsRunning(false);
          break;
        }

        const maxS = 4;
        const cleanContent = clampToMaxSentences(targetFullText, maxS);

        flushReadySentences();
        const remainder = targetFullText.slice(spokenCursor).trim();
        if (remainder) {
          spokenCursor = targetFullText.length;
          if (cameoStream) {
            cameoStream.pushSentence(remainder);
          } else {
            dialogueAudio.enqueueSentence(
              remainder,
              nextSpeaker,
              voiceURI,
              mutedRef.current
            );
          }
        }

        if (cameoStream) {
          cameoStream.finish();
          await Promise.all([revealPromise, cameoStream.done]);
          if (dialogueAudio.isAutoplayBlocked() && !mutedRef.current) {
            setStatusNote('Tap anywhere for sound');
          }
        } else {
          await revealPromise;
        }

        if (controller.signal.aborted || sessionGenerationRef.current !== generation) {
          break;
        }

        if (cleanContent) {
          const completedMsg: DialogueMessage = {
            id: `${Date.now()}-${nextTurnNum}`,
            turn: nextTurnNum,
            agent: nextSpeaker,
            content: cleanContent,
            model,
            topic: effectiveTopic,
            timestamp: Date.now(),
            tokens: turnUsage,
          };

          const updatedMsgs = [...trimmedHistory, completedMsg];
          messagesRef.current = updatedMsgs;
          setMessages(updatedMsgs);
          setStats((prev) => ({
            ...prev,
            totalTurns: prev.totalTurns + 1,
            promptTokens: prev.promptTokens + (turnUsage?.prompt ?? 0),
            completionTokens: prev.completionTokens + (turnUsage?.completion ?? 0),
            totalTokens: prev.totalTokens + (turnUsage?.total ?? 0),
            startedAt: prev.startedAt ?? Date.now(),
          }));
          retryCount = 0;
        }

        if (!mutedRef.current) {
          await dialogueAudio.waitForQueueDrain();
        }

        setIsSpeaking(false);

        if (controller.signal.aborted || sessionGenerationRef.current !== generation) {
          break;
        }

        const totalPauseMs = settingsRef.current.turnDelaySeconds * 1000;
        const elapsedSinceTurnStart = Date.now() - turnStartedAt;
        const relayFloorMs = Math.max(0, recommendedDelayMs - elapsedSinceTurnStart);
        const waitMs = Math.max(totalPauseMs, relayFloorMs);

        // Keep the finished speaker's text visible briefly after talking, then disappear
        const lingerMs = Math.min(650, waitMs);
        const lingered = await sleepInterruptible(lingerMs, controller.signal);
        if (!lingered) break;

        if (displaySlot === 'left') {
          setSeekerDisplay('');
        } else if (displaySlot === 'right') {
          setSkepticDisplay('');
        } else {
          setCameoDisplay('');
          if (!isTrumpOnlyMode && cameoRemainingRef.current === 0) {
            setActiveCameo(null);
          }
        }

        const remainingPauseMs = Math.max(0, waitMs - lingerMs);
        if (remainingPauseMs > 0) {
          const slept = await sleepInterruptible(remainingPauseMs, controller.signal);
          if (!slept) break;
        }
      }
    };

    void run();

    return () => {
      controller.abort();
      setIsSpeaking(false);
    };
  }, [isRunning, canStart, summarizeIfNeeded]);

  const handleToggleRun = () => {
    if (!canStart) return;
    dialogueAudio.unlock();
    setStatusNote(null);
    if (isRunning) {
      dialogueAudio.stop();
      setIsRunning(false);
    } else {
      setStats((s) => ({ ...s, startedAt: s.startedAt ?? Date.now() }));
      setIsRunning(true);
    }
  };

  const handleRestart = () => {
    loopAbortRef.current?.abort();
    dialogueAudio.stop();
    sessionGenerationRef.current++;
    messagesRef.current = [];
    summaryRef.current = '';
    observerQuestionRef.current = null;
    forceSpeakerRef.current = null;
    lastCoreAgentRef.current = 'skeptic';
    lastCameoAgentRef.current = 'biden';
    cameoRemainingRef.current = 0;
    lastCameoAtRef.current = Date.now();
    lastChaosTurnRef.current = 0;
    setMessages([]);
    setArchivalSummary('');
    setSeekerDisplay('');
    setSkepticDisplay('');
    setCameoDisplay('');
    setActiveCameo(settingsRef.current.castMode === 'trump-only' ? 'trump' : null);
    setWakePromptText(null);
    setStatusNote(null);
    setActiveSpeaker(settingsRef.current.castMode === 'duo' ? 'seeker' : 'trump');
    const nextTopic =
      settings.topicMode === 'autonomous'
        ? AUTONOMOUS_SEEDS[Math.floor(Math.random() * AUTONOMOUS_SEEDS.length)]
        : settings.topicMode === 'custom'
          ? settings.customTopic.trim() || 'Existence'
          : settings.topicMode;
    setCurrentTopic(nextTopic);
    setStats({
      ...INITIAL_STATS,
      startedAt: Date.now(),
    });
    if (canStart) {
      setIsRunning(false);
      window.setTimeout(() => setIsRunning(true), 60);
    }
  };

  const handleUpdateSettings = (patch: Partial<DialogueSettings>) => {
    const castChanged =
      patch.castMode !== undefined && patch.castMode !== settingsRef.current.castMode;

    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.topicMode && patch.topicMode !== 'autonomous' && patch.topicMode !== 'custom') {
        setCurrentTopic(patch.topicMode);
      } else if (patch.topicMode === 'custom' || patch.customTopic !== undefined) {
        const label = (patch.customTopic ?? next.customTopic).trim();
        if (next.topicMode === 'custom' && label) {
          setCurrentTopic(label);
        }
      }
      return next;
    });

    if (castChanged && patch.castMode) {
      resetForCastMode(patch.castMode);
    }
  };

  const currentStreamingText =
    settings.castMode === 'trump-only'
      ? cameoDisplay
      : activeSpeaker === 'seeker' || (settings.castMode === 'trump-biden' && activeSpeaker === 'trump')
        ? seekerDisplay
        : activeSpeaker === 'skeptic' || (settings.castMode === 'trump-biden' && activeSpeaker === 'biden')
          ? skepticDisplay
          : cameoDisplay;

  return (
    <div className="relative w-screen h-screen bg-black text-neutral-200 overflow-hidden select-none">
      {/* Ultra-minimal, dimmed & elevated Header Controls for Hologram Mesh */}
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-3 md:px-5 py-1.5 opacity-20 hover:opacity-85 focus-within:opacity-85 transition-opacity duration-300 pointer-events-none">
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <h1 className="font-display text-[10px] md:text-[11px] font-light tracking-[0.26em] uppercase text-neutral-500 whitespace-nowrap">
            The Eternal Dialogue
          </h1>
          {statusNote ? (
            <span className="font-mono-tabular text-[10px] tracking-[0.14em] uppercase text-neutral-500 whitespace-nowrap">
              · {statusNote}
            </span>
          ) : wakeState === 'arming' ? (
            <span className="hidden sm:inline font-mono-tabular text-[10px] tracking-[0.14em] uppercase text-neutral-600 whitespace-nowrap">
              · Say “Socrates”
            </span>
          ) : null}
        </div>

        <nav
          aria-label="Terminal Controls"
          className="flex items-center gap-0.5 pointer-events-auto"
        >
          <button
            type="button"
            onClick={() => void handleToggleMic()}
            title={
              wakeState === 'off'
                ? 'Enable Microphone (Say "Socrates" to ask a question)'
                : 'Disable Microphone'
            }
            aria-label={wakeState === 'off' ? 'Enable microphone' : 'Disable microphone'}
            className={`p-1.5 transition-colors cursor-pointer ${
              wakeState === 'capturing'
                ? 'text-neutral-200'
                : wakeState === 'arming'
                  ? 'text-neutral-400'
                  : 'text-neutral-600 hover:text-neutral-200'
            }`}
          >
            {wakeState === 'off' ? (
              <MicOff className="w-3 h-3" />
            ) : (
              <Mic className="w-3 h-3" />
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleRun}
            disabled={!canStart}
            title={isRunning ? 'Pause Dialogue (Space)' : 'Start Dialogue (Space)'}
            aria-label={isRunning ? 'Pause dialogue' : 'Start dialogue'}
            className="p-1.5 text-neutral-600 hover:text-neutral-200 disabled:opacity-30 transition-colors cursor-pointer"
          >
            {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            title="Restart Dialogue"
            aria-label="Restart dialogue"
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            title={isMuted ? 'Unmute Speech (M)' : 'Mute Speech (M)'}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={() => setShowDialogue((v) => !v)}
            title={showDialogue ? 'Hide Holographic Text (H)' : 'Show Holographic Text (H)'}
            aria-label={showDialogue ? 'Hide holographic text' : 'Show holographic text'}
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            {showDialogue ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={handleToggleCastMode}
            title={
              settings.castMode === 'duo'
                ? 'Switch to Trump & Biden Debate (V)'
                : settings.castMode === 'trump-biden'
                  ? 'Switch to Trump Solo (V)'
                  : 'Switch to Zorblax & Socrates (V)'
            }
            aria-label="Cycle hologram cast"
            className={`p-1.5 transition-colors cursor-pointer ${
              settings.castMode !== 'duo'
                ? 'text-neutral-200'
                : 'text-neutral-600 hover:text-neutral-200'
            }`}
          >
            <Users className="w-3 h-3" />
          </button>

          {settings.castMode === 'duo' && (
            <button
              type="button"
              onClick={handleTriggerCameo}
              disabled={!canStart}
              title="Trump & Biden Call-In (C)"
              aria-label="Trigger Trump and Biden call-in"
              className="p-1.5 text-neutral-600 hover:text-neutral-200 disabled:opacity-30 transition-colors cursor-pointer"
            >
              <PhoneCall className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setHeadlinePickerOpen(true)}
            title="Visual Headline Picker & Microphone"
            aria-label="Open headline selector"
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            <Newspaper className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            title="Transcript Archive (T)"
            aria-label="Open transcript archive"
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            <FileText className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Configuration"
            aria-label="Open settings"
            className="p-1.5 text-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>
        </nav>
      </header>

      {/* Full-Bleed Three.js Holographic Stage + Floating Bold 80s Computer Holographic Letters */}
      <main className="w-full h-full">
        <HologramStage
          castMode={settings.castMode}
          activeSpeaker={activeSpeaker}
          activeCameo={activeCameo}
          isSpeaking={isSpeaking}
          isRunning={isRunning}
          seekerText={seekerDisplay}
          skepticText={skepticDisplay}
          cameoText={cameoDisplay}
          showDialogue={showDialogue}
          wakePromptText={wakePromptText}
          isCapturingVoice={wakeState === 'capturing'}
        />
      </main>

      {/* Transcript Archive Modal */}
      <TranscriptDrawer
        open={transcriptOpen}
        messages={messages}
        activeSpeaker={activeSpeaker}
        activeText={currentStreamingText}
        isStreaming={isSpeaking}
        archivalSummary={archivalSummary}
        onClose={() => setTranscriptOpen(false)}
      />

      {/* Settings & Session Statistics Modal */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        stats={stats}
        isConfigured={isConfigured}
        activeProvider={activeProvider}
        voices={voices}
        onUpdateSettings={handleUpdateSettings}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Visual Headline Picker Modal */}
      <HeadlinePickerModal
        open={headlinePickerOpen}
        onSelectHeadline={handleSelectHeadline}
        onClose={() => setHeadlinePickerOpen(false)}
      />
    </div>
  );
}
