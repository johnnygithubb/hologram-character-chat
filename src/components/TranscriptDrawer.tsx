import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
import type { AgentId, DialogueMessage } from '../types/dialogue';

interface TranscriptDrawerProps {
  open: boolean;
  messages: DialogueMessage[];
  activeSpeaker: AgentId;
  activeText: string;
  isStreaming: boolean;
  archivalSummary: string;
  onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function agentLabel(agent: AgentId): string {
  if (agent === 'seeker') return 'Zorblax (Alien)';
  if (agent === 'skeptic') return 'Socrates';
  if (agent === 'trump') return 'Donald Trump';
  return 'Joe Biden';
}

export function TranscriptDrawer({
  open,
  messages,
  activeSpeaker,
  activeText,
  isStreaming,
  archivalSummary,
  onClose,
}: TranscriptDrawerProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages.length, activeText]);

  if (!open) return null;

  const handleExport = () => {
    const lines: string[] = [
      '# THE ETERNAL DIALOGUE — TRANSCRIPT',
      `Exported: ${new Date().toISOString()}`,
      '',
    ];

    if (archivalSummary.trim()) {
      lines.push('## Archival Memory', archivalSummary.trim(), '');
    }

    lines.push('## Exchanges', '');
    for (const m of messages) {
      lines.push(
        `### Turn ${String(m.turn).padStart(2, '0')} · ${agentLabel(m.agent).toUpperCase()} (${m.model}) · ${formatTime(m.timestamp)}`,
        m.content,
        ''
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eternal-dialogue-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Dialogue Transcript Archive"
    >
      <div className="relative w-full max-w-3xl h-[82vh] bg-black border border-white/15 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-sm tracking-[0.28em] uppercase text-white font-light">
              Dialogue Archive
            </h2>
            <span className="font-mono-tabular text-xs text-neutral-500">
              {messages.length} {messages.length === 1 ? 'exchange' : 'exchanges'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 border border-white/15 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transcript"
              className="p-2 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="void-scroll flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {archivalSummary.trim() && (
            <div className="pb-5 border-b border-white/10">
              <div className="font-mono-tabular text-[11px] tracking-[0.2em] uppercase text-neutral-500 mb-2">
                Distilled Memory
              </div>
              <p className="text-sm leading-relaxed text-neutral-400 font-light">
                {archivalSummary}
              </p>
            </div>
          )}

          {messages.length === 0 && !activeText ? (
            <p className="text-sm text-neutral-500 font-light py-12 text-center">
              No exchanges recorded in this session yet.
            </p>
          ) : (
            messages.map((msg) => (
              <article
                key={msg.id}
                className="pb-5 border-b border-white/[0.06] last:border-b-0"
              >
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-xs tracking-[0.25em] uppercase text-neutral-100">
                      {agentLabel(msg.agent)}
                    </span>
                    <span className="font-mono-tabular text-[11px] text-neutral-600">
                      {msg.model.split('/').pop()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono-tabular text-[11px] text-neutral-500">
                    <span>TURN {String(msg.turn).padStart(2, '0')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTime(msg.timestamp)}</span>
                  </div>
                </div>
                <p className="text-[15px] leading-[1.7] text-neutral-300 font-light">
                  {msg.content}
                </p>
              </article>
            ))
          )}

          {isStreaming && activeText && (
            <article className="pt-2">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-display text-xs tracking-[0.25em] uppercase text-white">
                  {agentLabel(activeSpeaker)}
                </span>
                <span className="font-mono-tabular text-[11px] text-neutral-400">
                  Transmitting...
                </span>
              </div>
              <p className="text-[15px] leading-[1.7] text-neutral-100 font-light">
                {activeText}
              </p>
            </article>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
