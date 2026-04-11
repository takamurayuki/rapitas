'use client';

/**
 * VoiceInputBar
 *
 * Global floating voice input bar that appears at the bottom of the screen.
 * Works alongside keyboard input — voice results are merged into the active
 * input field or executed as AI commands.
 *
 * Activated via:
 *   - Ctrl+Shift+V shortcut
 *   - Header mic button
 *   - Inline mic buttons in input fields
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic,
  MicOff,
  X,
  Send,
  Wand2,
  Loader2,
  Navigation,
  Plus,
  Search,
} from 'lucide-react';
import AudioWaveform from '../smart-command-bar/AudioWaveform';
import { encodeWav, resamplePcm } from '@/lib/audio/wav-codec';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

/** Voice command from backend. */
interface VoiceCommandResponse {
  type: 'navigate' | 'create_task' | 'search' | 'text';
  path?: string;
  label?: string;
  title?: string;
  query?: string;
  text?: string;
}

/** Where to send the transcribed text. */
export type VoiceTarget =
  | { type: 'input'; element: HTMLInputElement | HTMLTextAreaElement }
  | { type: 'command' }
  | { type: 'callback'; onText: (text: string) => void };

interface VoiceInputBarProps {
  /** Whether the bar is visible. */
  isOpen: boolean;
  /** Close the bar. */
  onClose: () => void;
  /** Where to send the result. Defaults to 'command' mode. */
  target?: VoiceTarget;
}

export default function VoiceInputBar({
  isOpen,
  onClose,
  target,
}: VoiceInputBarProps) {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastCommand, setLastCommand] = useState<VoiceCommandResponse | null>(
    null,
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [transcript, setTranscript] = useState('');
  const [interimInfo, setInterimInfo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscript('');
      setInterimInfo('話してください...');

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      setStream(mediaStream);

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(mediaStream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Silence detection
      const SILENCE_THRESHOLD = 5;
      const SILENCE_MS = 2000;
      const state = { lastSoundTime: 0, hasSpoken: false };
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const timer = setInterval(() => {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        const avg = sum / freqData.length;

        const timeData = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(timeData);
        let rms = 0;
        for (let i = 0; i < timeData.length; i++)
          rms += timeData[i] * timeData[i];
        rms = Math.sqrt(rms / timeData.length);

        const hasSound = avg > SILENCE_THRESHOLD || rms > 0.005;

        if (hasSound) {
          state.lastSoundTime = Date.now();
          if (!state.hasSpoken) state.hasSpoken = true;
        }

        if (state.hasSpoken) {
          const silenceMs = Date.now() - state.lastSoundTime;
          setInterimInfo(`録音中... (${(silenceMs / 1000).toFixed(1)}s)`);

          if (silenceMs > SILENCE_MS) {
            clearInterval(timer);
            recorder.stop();
          }
        } else {
          setInterimInfo(`話してください... (音量: ${avg.toFixed(0)})`);
        }
      }, 100);

      silenceTimerRef.current = timer;

      recorder.onstop = async () => {
        clearInterval(timer);
        silenceTimerRef.current = null;
        mediaStream.getTracks().forEach((t) => t.stop());
        setStream(null);
        audioCtx.close();
        setIsRecording(false);

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 500) {
          setInterimInfo('');
          return;
        }

        await transcribeAndDeliver(blob);
      };

      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'マイクの起動に失敗しました',
      );
    }
  }, []);

  // Stop recording manually
  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Transcribe audio and deliver result
  const transcribeAndDeliver = async (blob: Blob) => {
    setIsTranscribing(true);
    setInterimInfo('文字起こし中...');

    try {
      // Decode webm → PCM → WAV
      const decodeCtx = new AudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
      await decodeCtx.close();

      const pcm = audioBuffer.getChannelData(0);
      const rate = audioBuffer.sampleRate;
      const resampled = rate === 16000 ? pcm : resamplePcm(pcm, rate, 16000);
      const wavBlob = encodeWav(
        resampled instanceof Float32Array
          ? resampled
          : new Float32Array(resampled),
        16000,
      );

      const formData = new FormData();
      formData.append('audio', wavBlob, 'audio.wav');
      formData.append('language', 'ja');

      const response = await fetch(`${BACKEND_URL}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = (await response.json()) as {
          text: string;
          command?: VoiceCommandResponse;
          processingMs?: number;
        };

        if (result.text.trim()) {
          setTranscript(result.text.trim());

          // Auto-execute voice commands
          if (result.command && result.command.type !== 'text') {
            setLastCommand(result.command);
            executeCommand(result.command);
          } else {
            deliverResult(result.text.trim());
          }
        } else {
          setInterimInfo('音声を認識できませんでした');
        }
      } else {
        const data = await response.json().catch(() => ({ error: 'エラー' }));
        setError(
          (data as { error?: string }).error || '文字起こしに失敗しました',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '文字起こしエラー');
    } finally {
      setIsTranscribing(false);
      setInterimInfo('');
    }
  };

  // Execute a parsed voice command
  const executeCommand = useCallback(
    (cmd: VoiceCommandResponse) => {
      switch (cmd.type) {
        case 'navigate':
          if (cmd.path) {
            setInterimInfo(`${cmd.label || cmd.path} に移動します...`);
            setTimeout(() => {
              router.push(cmd.path!);
              onClose();
            }, 500);
          }
          break;

        case 'create_task':
          if (cmd.title) {
            setInterimInfo(`タスク「${cmd.title}」を作成中...`);
            fetch(`${BACKEND_URL}/tasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: cmd.title }),
            })
              .then((res) => {
                if (res.ok) {
                  setInterimInfo(`タスク「${cmd.title}」を作成しました`);
                  setTimeout(() => onClose(), 1500);
                }
              })
              .catch(() => setError('タスク作成に失敗しました'));
          }
          break;

        case 'search':
          if (cmd.query) {
            router.push(`/search?q=${encodeURIComponent(cmd.query)}`);
            onClose();
          }
          break;
      }
    },
    [router, onClose],
  );

  // Deliver transcribed text to target
  const deliverResult = useCallback(
    (text: string) => {
      if (!target || target.type === 'command') {
        // AI command mode — will be handled by parent
        return;
      }

      if (target.type === 'input' && target.element) {
        const el = target.element;
        const currentValue = el.value;
        const start = el.selectionStart ?? currentValue.length;
        const end = el.selectionEnd ?? currentValue.length;
        const newValue =
          currentValue.slice(0, start) + text + currentValue.slice(end);

        // Set value and trigger React change event
        const nativeSetter =
          Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set ??
          Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;

        nativeSetter?.call(el, newValue);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        el.setSelectionRange(start + text.length, start + text.length);
      }

      if (target.type === 'callback') {
        target.onText(text);
      }
    },
    [target],
  );

  // Send transcript as AI command
  const sendAsCommand = useCallback(async () => {
    if (!transcript.trim()) return;

    try {
      const response = await fetch(`${BACKEND_URL}/smart-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: transcript, intent: 'auto' }),
      });

      if (response.ok) {
        onClose();
      }
    } catch {
      setError('コマンド実行に失敗しました');
    }
  }, [transcript, onClose]);

  // Keyboard shortcut to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else if (isOpen) {
          startRecording();
        }
      }
      if (e.key === 'Escape' && isOpen) {
        stopRecording();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRecording, startRecording, stopRecording, onClose]);

  // Auto-start recording when opened
  useEffect(() => {
    if (isOpen && !isRecording && !isTranscribing) {
      startRecording();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
      <div className="max-w-2xl mx-auto pointer-events-auto">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-4 space-y-3">
          {/* Waveform + Status */}
          <div className="flex items-center gap-3">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              className={`p-3 rounded-xl transition-all ${
                isTranscribing
                  ? 'bg-amber-500/20 text-amber-400'
                  : isRecording
                    ? 'bg-red-500/20 text-red-400 animate-pulse'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isRecording ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              {stream && (
                <AudioWaveform stream={stream} width={300} height={32} />
              )}
              {!stream && interimInfo && (
                <span className="text-sm text-zinc-400">{interimInfo}</span>
              )}
              {error && <span className="text-sm text-red-400">{error}</span>}
            </div>

            <button
              onClick={() => {
                stopRecording();
                onClose();
              }}
              className="p-2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Command result indicator */}
          {lastCommand && lastCommand.type !== 'text' && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              {lastCommand.type === 'navigate' && (
                <Navigation className="w-4 h-4 text-indigo-400" />
              )}
              {lastCommand.type === 'create_task' && (
                <Plus className="w-4 h-4 text-green-400" />
              )}
              {lastCommand.type === 'search' && (
                <Search className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-sm text-zinc-300">
                {lastCommand.type === 'navigate' &&
                  `${lastCommand.label} に移動`}
                {lastCommand.type === 'create_task' &&
                  `タスク「${lastCommand.title}」を作成`}
                {lastCommand.type === 'search' &&
                  `「${lastCommand.query}」を検索`}
              </span>
            </div>
          )}

          {/* Transcript + Actions */}
          {transcript && !lastCommand && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="flex-1 bg-zinc-800 text-zinc-100 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-indigo-500 outline-none"
                placeholder="音声テキストを編集..."
              />
              <button
                onClick={sendAsCommand}
                className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                title="AIコマンドとして実行"
              >
                <Wand2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => deliverResult(transcript)}
                className="p-2 bg-zinc-700 text-white rounded-lg hover:bg-zinc-600 transition-colors"
                title="テキストを入力欄に挿入"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Shortcut hint */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-600">
            <span>Ctrl+Shift+V: 録音開始/停止</span>
            <span>Esc: 閉じる</span>
            <span>無音2秒で自動変換</span>
          </div>
        </div>
      </div>
    </div>
  );
}
