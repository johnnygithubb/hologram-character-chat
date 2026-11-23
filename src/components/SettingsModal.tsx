import { useState } from 'react';
import { X, RotateCcw, Wifi } from 'lucide-react';
import {
  DEFAULT_SEEKER_PROMPT,
  DEFAULT_SKEPTIC_PROMPT,
  MODEL_PRESETS,
  PHILOSOPHICAL_TOPICS,
  type AiProviderMode,
  type CastMode,
  type DialogueSettings,
  type SessionStats,
} from '../types/dialogue';
import type { VoiceOption } from '../utils/speech';

interface SettingsModalProps {
  open: boolean;
  settings: DialogueSettings;
  stats: SessionStats;
  isConfigured: boolean | null;
  activeProvider: string;
  voices: VoiceOption[];
  onUpdateSettings: (patch: Partial<DialogueSettings>) => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  settings,
  stats,
  isConfigured,
  activeProvider,
  voices,
  onUpdateSettings,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'minds' | 'dialogue' | 'telemetry'>('minds');
  const [pingResult, setPingResult] = useState<{
    state: 'idle' | 'testing' | 'ok' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });

  if (!open) return null;

  const handleTestConnection = async () => {
    setPingResult({ state: 'testing', message: 'Probing OpenRouter...' });
    try {
      const res = await fetch('/api/test-connection', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; latencyMs?: number; error?: string };
      if (res.ok && data.ok) {
        setPingResult({
          state: 'ok',
          message: `Connected (${data.latencyMs ?? 0} ms)`,
        });
      } else {
        setPingResult({
          state: 'error',
          message: data.error || `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setPingResult({
        state: 'error',
        message: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  };

  const isCustomSeeker = !MODEL_PRESETS.some((m) => m.id === settings.seekerModel);
  const isCustomSkeptic = !MODEL_PRESETS.some((m) => m.id === settings.skepticModel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Observation Terminal Settings"
    >
      <div className="relative w-full max-w-2xl max-h-[86vh] bg-black border border-white/15 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="font-display text-sm tracking-[0.28em] uppercase text-white font-light">
            Configuration
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close configuration"
            className="p-2 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-white/10 px-6 gap-6">
          {(
            [
              { id: 'minds', label: 'Minds & Models' },
              { id: 'dialogue', label: 'Pacing & Audio' },
              { id: 'telemetry', label: 'Provider & Stats' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 text-xs tracking-[0.16em] uppercase border-b transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="void-scroll flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {activeTab === 'minds' && (
            <>
              {/* Cast Mode Selector */}
              <div className="space-y-2 pb-5 border-b border-white/10">
                <label className="block font-display text-xs tracking-[0.22em] uppercase text-neutral-200">
                  Hologram Cast
                </label>
                <select
                  value={settings.castMode}
                  onChange={(e) =>
                    onUpdateSettings({ castMode: e.target.value as CastMode })
                  }
                  className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                >
                  <option value="duo">
                    Zorblax &amp; Socrates (with 5-min Trump &amp; Biden Call-Ins)
                  </option>
                  <option value="trump-biden">
                    Trump &amp; Biden Only Debate
                  </option>
                  <option value="trump-only">
                    Trump Solo (Headlines, Stories &amp; Bragging)
                  </option>
                </select>
                <p className="text-[11px] text-neutral-500">
                  Switch anytime from here or press V on your keyboard to cycle between Zorblax &amp; Socrates, Trump &amp; Biden Debate, and Trump Solo.
                </p>
              </div>

              {/* Provider Routing Mode */}
              <div className="space-y-2 pb-5 border-b border-white/10">
                <label className="block font-display text-xs tracking-[0.22em] uppercase text-neutral-200">
                  AI Inference Source
                </label>
                <select
                  value={settings.aiProvider}
                  onChange={(e) =>
                    onUpdateSettings({ aiProvider: e.target.value as AiProviderMode })
                  }
                  className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                >
                  <option value="auto">
                    Auto (OpenRouter first, seamless Unlimited Free Relay failover)
                  </option>
                  <option value="free-relay">
                    Unlimited Free Relay Only (No API key or credits needed)
                  </option>
                  <option value="openrouter">OpenRouter Only (Requires quota/credits)</option>
                </select>
                <p className="text-[11px] text-neutral-500">
                  In Auto mode, if OpenRouter reaches its daily free request cap, the terminal continues autonomously via the free relay without interrupting the dialogue.
                </p>
              </div>

              {/* Seeker Config */}
              <div className="space-y-3 pb-6 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <label className="font-display text-xs tracking-[0.25em] uppercase text-neutral-200">
                    AI 01 — The Seeker (Alien)
                  </label>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ seekerPrompt: DEFAULT_SEEKER_PROMPT })}
                    className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Persona</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block text-[11px] text-neutral-500 mb-1.5">
                      OpenRouter Preset
                    </span>
                    <select
                      value={isCustomSeeker ? '__custom__' : settings.seekerModel}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          onUpdateSettings({ seekerModel: e.target.value });
                        }
                      }}
                      className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                    >
                      {MODEL_PRESETS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {isCustomSeeker && <option value="__custom__">Custom Model ID</option>}
                    </select>
                  </div>
                  <div>
                    <span className="block text-[11px] text-neutral-500 mb-1.5">
                      OpenRouter Model ID
                    </span>
                    <input
                      type="text"
                      value={settings.seekerModel}
                      onChange={(e) => onUpdateSettings({ seekerModel: e.target.value })}
                      placeholder="provider/model-name"
                      className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs font-mono-tabular text-neutral-200 focus:outline-none focus:border-white/50"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-neutral-500 mb-1.5">System Prompt</span>
                  <textarea
                    rows={4}
                    value={settings.seekerPrompt}
                    onChange={(e) => onUpdateSettings({ seekerPrompt: e.target.value })}
                    className="void-scroll w-full bg-neutral-950 border border-white/15 p-3 text-xs leading-relaxed text-neutral-300 focus:outline-none focus:border-white/50 resize-y"
                  />
                </div>
              </div>

              {/* Skeptic Config */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-display text-xs tracking-[0.25em] uppercase text-neutral-200">
                    AI 02 — The Skeptic (Socrates)
                  </label>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ skepticPrompt: DEFAULT_SKEPTIC_PROMPT })}
                    className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Persona</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block text-[11px] text-neutral-500 mb-1.5">
                      OpenRouter Preset
                    </span>
                    <select
                      value={isCustomSkeptic ? '__custom__' : settings.skepticModel}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          onUpdateSettings({ skepticModel: e.target.value });
                        }
                      }}
                      className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                    >
                      {MODEL_PRESETS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {isCustomSkeptic && <option value="__custom__">Custom Model ID</option>}
                    </select>
                  </div>
                  <div>
                    <span className="block text-[11px] text-neutral-500 mb-1.5">
                      OpenRouter Model ID
                    </span>
                    <input
                      type="text"
                      value={settings.skepticModel}
                      onChange={(e) => onUpdateSettings({ skepticModel: e.target.value })}
                      placeholder="provider/model-name"
                      className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs font-mono-tabular text-neutral-200 focus:outline-none focus:border-white/50"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-neutral-500 mb-1.5">System Prompt</span>
                  <textarea
                    rows={4}
                    value={settings.skepticPrompt}
                    onChange={(e) => onUpdateSettings({ skepticPrompt: e.target.value })}
                    className="void-scroll w-full bg-neutral-950 border border-white/15 p-3 text-xs leading-relaxed text-neutral-300 focus:outline-none focus:border-white/50 resize-y"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'dialogue' && (
            <>
              <div className="space-y-3 pb-6 border-b border-white/10">
                <label className="block font-display text-xs tracking-[0.22em] uppercase text-neutral-200">
                  Philosophical Inquiry
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="block text-[11px] text-neutral-500 mb-1.5">Topic Mode</span>
                    <select
                      value={settings.topicMode}
                      onChange={(e) => onUpdateSettings({ topicMode: e.target.value })}
                      className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                    >
                      <option value="autonomous">Autonomous Evolution</option>
                      {PHILOSOPHICAL_TOPICS.filter((t) => t !== 'Autonomous Evolution').map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                      <option value="custom">Custom Topic Seed</option>
                    </select>
                  </div>
                  {settings.topicMode === 'custom' && (
                    <div>
                      <span className="block text-[11px] text-neutral-500 mb-1.5">
                        Custom Inquiry Focus
                      </span>
                      <input
                        type="text"
                        value={settings.customTopic}
                        onChange={(e) => onUpdateSettings({ customTopic: e.target.value })}
                        placeholder="e.g. Whether silence precedes thought"
                        className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5 pb-6 border-b border-white/10">
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-neutral-300">Temperature</span>
                    <span className="font-mono-tabular text-neutral-400">
                      {settings.temperature.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.4}
                    step={0.05}
                    value={settings.temperature}
                    onChange={(e) =>
                      onUpdateSettings({ temperature: parseFloat(e.target.value) })
                    }
                    className="w-full accent-white cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-neutral-300">Reading Hold Between Turns</span>
                    <span className="font-mono-tabular text-neutral-400">
                      {settings.turnDelaySeconds}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={settings.turnDelaySeconds}
                    onChange={(e) =>
                      onUpdateSettings({ turnDelaySeconds: parseFloat(e.target.value) })
                    }
                    className="w-full accent-white cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-neutral-300">Max Tokens Per Turn</span>
                    <span className="font-mono-tabular text-neutral-400">
                      {settings.maxTokens}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={80}
                    max={320}
                    step={10}
                    value={settings.maxTokens}
                    onChange={(e) =>
                      onUpdateSettings({ maxTokens: parseInt(e.target.value, 10) })
                    }
                    className="w-full accent-white cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-xs text-neutral-200">
                      Transmission Chime
                    </span>
                    <span className="block text-[11px] text-neutral-500">
                      Subtle harmonic tone when speaker switches
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ codecChimes: !settings.codecChimes })}
                    className={`px-3 py-1.5 text-xs border transition-colors cursor-pointer ${
                      settings.codecChimes
                        ? 'border-white/50 text-white bg-white/10'
                        : 'border-white/15 text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {settings.codecChimes ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {voices.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <span className="block text-[11px] text-neutral-500 mb-1.5">
                        Seeker Speech Voice
                      </span>
                      <select
                        value={settings.seekerVoiceURI}
                        onChange={(e) => onUpdateSettings({ seekerVoiceURI: e.target.value })}
                        className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                      >
                        <option value="">Default System Voice</option>
                        {voices.map((v) => (
                          <option key={v.uri} value={v.uri}>
                            {v.name} ({v.lang})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className="block text-[11px] text-neutral-500 mb-1.5">
                        Skeptic Speech Voice
                      </span>
                      <select
                        value={settings.skepticVoiceURI}
                        onChange={(e) => onUpdateSettings({ skepticVoiceURI: e.target.value })}
                        className="w-full bg-neutral-950 border border-white/15 px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-white/50"
                      >
                        <option value="">Default System Voice</option>
                        {voices.map((v) => (
                          <option key={v.uri} value={v.uri}>
                            {v.name} ({v.lang})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'telemetry' && (
            <>
              <div className="pb-6 border-b border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-neutral-200">
                      Active Provider: <span className="text-white">{activeProvider}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      {isConfigured
                        ? 'OpenRouter key configured; Free Unlimited Relay available as automatic fallback.'
                        : 'Running via Unlimited Free Relay (no OpenRouter key required).'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={pingResult.state === 'testing'}
                    className="inline-flex items-center gap-2 px-3.5 py-2 border border-white/20 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>
                      {pingResult.state === 'testing' ? 'Testing...' : 'Test OpenRouter'}
                    </span>
                  </button>
                </div>

                {pingResult.state !== 'idle' && (
                  <div className="text-xs font-mono-tabular text-neutral-300 pt-1">
                    {pingResult.message}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Total Turns
                  </div>
                  <div className="font-mono-tabular text-lg text-white mt-1">
                    {stats.totalTurns}
                  </div>
                </div>
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Total Tokens
                  </div>
                  <div className="font-mono-tabular text-lg text-white mt-1">
                    {stats.totalTokens.toLocaleString()}
                  </div>
                </div>
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Memory Digests
                  </div>
                  <div className="font-mono-tabular text-lg text-white mt-1">
                    {stats.summariesGenerated}
                  </div>
                </div>
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Prompt Tokens
                  </div>
                  <div className="font-mono-tabular text-sm text-neutral-300 mt-1">
                    {stats.promptTokens.toLocaleString()}
                  </div>
                </div>
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Completion Tokens
                  </div>
                  <div className="font-mono-tabular text-sm text-neutral-300 mt-1">
                    {stats.completionTokens.toLocaleString()}
                  </div>
                </div>
                <div className="border border-white/10 p-3.5">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider">
                    Session Uptime
                  </div>
                  <div className="font-mono-tabular text-sm text-neutral-300 mt-1">
                    {stats.startedAt
                      ? `${Math.max(0, Math.floor((Date.now() - stats.startedAt) / 60000))}m`
                      : '—'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
