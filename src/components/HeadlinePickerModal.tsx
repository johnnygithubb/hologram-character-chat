import { useEffect, useState, useCallback } from 'react';
import { X, Mic, MicOff, Newspaper, Sparkles, Check } from 'lucide-react';

interface HeadlinePickerModalProps {
  open: boolean;
  onSelectHeadline: (headline: string) => void;
  onClose: () => void;
}

export function HeadlinePickerModal({
  open,
  onSelectHeadline,
  onClose,
}: HeadlinePickerModalProps) {
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErrorMsg(null);
    fetch('/api/headlines')
      .then((res) => res.json())
      .then((data: { headlines?: string[] }) => {
        if (Array.isArray(data.headlines) && data.headlines.length > 0) {
          setHeadlines(data.headlines);
        } else {
          setHeadlines([
            'Global markets surge following surprise economic report',
            'New AI breakthrough sparks intense debates in Washington',
            'Researchers discover unusual signals from deep space observatory',
          ]);
        }
      })
      .catch(() => {
        setHeadlines([
          'Global markets surge following surprise economic report',
          'New AI breakthrough sparks intense debates in Washington',
          'Researchers discover unusual signals from deep space observatory',
        ]);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleMicPick = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onstart: (() => void) | null;
        onresult: ((event: any) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onstart: (() => void) | null;
        onresult: ((event: any) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setErrorMsg('Speech recognition is not supported in this browser.');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('Listening for your choice...');
        setErrorMsg(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const spoken = (final || interim).trim();
        if (spoken) {
          setTranscript(spoken);
          const match = headlines.find((h) =>
            h.toLowerCase().includes(spoken.toLowerCase()) || spoken.toLowerCase().includes(h.slice(0, 15).toLowerCase())
          );
          if (match) {
            const idx = headlines.indexOf(match);
            setSelectedIdx(idx);
          }
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
        setErrorMsg('Microphone error or speech not recognized.');
      };

      recognition.onend = () => {
        setIsListening(false);
        if (transcript && transcript !== 'Listening for your choice...') {
          onSelectHeadline(transcript);
          onClose();
        }
      };

      recognition.start();
    } catch {
      setIsListening(false);
      setErrorMsg('Unable to start microphone.');
    }
  }, [headlines, transcript, onSelectHeadline, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Select News Headline Visual"
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-black border border-white/20 flex flex-col shadow-[0_0_35px_rgba(255,255,255,0.08)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Newspaper className="w-4 h-4 text-white" />
            <h2 className="font-display text-xs tracking-[0.28em] uppercase text-white font-light">
              Live Headline Selector
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close headline selector"
            className="p-2 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="void-scroll flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div>
              <p className="text-xs text-neutral-300 font-light">
                Choose a story for Trump &amp; Biden to debate, or speak your choice via microphone.
              </p>
            </div>
            <button
              type="button"
              onClick={handleMicPick}
              disabled={isListening}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs border transition-colors cursor-pointer disabled:opacity-50 ${
                isListening
                  ? 'border-[#00ff41] text-[#00ff41] bg-[#00ff41]/10'
                  : 'border-white/20 text-neutral-200 hover:bg-white/10'
              }`}
            >
              {isListening ? <Mic className="w-3.5 h-3.5 animate-pulse" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{isListening ? 'Listening...' : 'Speak Choice'}</span>
            </button>
          </div>

          {transcript && (
            <div className="px-3.5 py-2.5 bg-neutral-950 border border-white/15 text-xs font-mono-tabular text-neutral-300">
              <span className="text-neutral-500 uppercase tracking-wider mr-2">Heard:</span>
              &ldquo;{transcript}&rdquo;
            </div>
          )}

          {errorMsg && (
            <div className="text-xs font-mono-tabular text-amber-400">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs font-mono-tabular text-neutral-500 tracking-widest uppercase">
              Loading current news feeds...
            </div>
          ) : (
            <div className="space-y-2.5">
              {headlines.map((headline, idx) => {
                const isSelected = selectedIdx === idx;
                return (
                  <button
                    key={headline}
                    type="button"
                    onClick={() => {
                      setSelectedIdx(idx);
                      onSelectHeadline(headline);
                      onClose();
                    }}
                    className={`w-full text-left p-3.5 border transition-all cursor-pointer flex items-center justify-between group ${
                      isSelected
                        ? 'border-white bg-white/15 text-white'
                        : 'border-white/10 bg-neutral-950/80 text-neutral-300 hover:border-white/30 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-start gap-3 pr-3">
                      <span className="font-mono-tabular text-xs text-neutral-500 mt-0.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs md:text-sm font-light leading-snug">
                        {headline}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected && <Check className="w-4 h-4 text-white" />}
                      <Sparkles className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-300 transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
