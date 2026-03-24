'use client';

/**
 * AudioWaveform
 *
 * Real-time audio waveform visualizer using Web Audio API's AnalyserNode.
 * Shows a live bar chart of audio frequency data so the user can confirm
 * their microphone is picking up sound.
 */
import { useEffect, useRef, useState } from 'react';

interface AudioWaveformProps {
  /** MediaStream from getUserMedia to visualize. */
  stream: MediaStream | null;
  /** Width of the canvas. */
  width?: number;
  /** Height of the canvas. */
  height?: number;
  /** Bar color when audio detected. */
  activeColor?: string;
  /** Bar color when silent. */
  idleColor?: string;
}

export default function AudioWaveform({
  stream,
  width = 200,
  height = 32,
  activeColor = '#ef4444',
  idleColor = '#52525b',
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const barCount = 24;
    const barWidth = Math.floor(width / barCount) - 1;

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average level for the indicator
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      setLevel(avg);

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Draw bars
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * bufferLength);
        const value = dataArray[dataIndex] / 255;
        const barHeight = Math.max(2, value * height);

        const isActive = value > 0.05;
        ctx.fillStyle = isActive ? activeColor : idleColor;

        const x = i * (barWidth + 1);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      source.disconnect();
      audioCtx.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [stream, width, height, activeColor, idleColor]);

  if (!stream) return null;

  return (
    <div className="flex items-center gap-2">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded"
      />
    </div>
  );
}
