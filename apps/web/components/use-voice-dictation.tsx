"use client";

import * as React from "react";
import { toast } from "sonner";

type SpeechResult = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
type SpeechError = { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechError) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
type VoiceState = "idle" | "starting" | "listening" | "pausing";

export function useVoiceDictation(setInput: React.Dispatch<React.SetStateAction<string>>) {
  const [voiceState, setVoiceState] = React.useState<VoiceState>("idle");
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null);
  const active = React.useRef(false);
  const mounted = React.useRef(true);
  const recognition = React.useRef<Recognition | null>(null);
  const microphone = React.useRef<MediaStream | null>(null);
  const audioContext = React.useRef<AudioContext | null>(null);
  const restartTimer = React.useRef<number | null>(null);
  const shortEnds = React.useRef(0);
  const sessionStartedAt = React.useRef(0);

  const releaseAudio = React.useCallback(() => {
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = null;
    if (audioContext.current) void audioContext.current.close().catch(() => {});
    audioContext.current = null;
    if (mounted.current) setAnalyser(null);
  }, []);

  const finish = React.useCallback((message?: string) => {
    active.current = false;
    if (restartTimer.current !== null) window.clearTimeout(restartTimer.current);
    restartTimer.current = null;
    recognition.current = null;
    releaseAudio();
    if (mounted.current) {
      setVoiceState("idle");
      if (message) toast.error(message);
    }
  }, [releaseAudio]);

  const startRecognition = React.useCallback(function runRecognition(Constructor: RecognitionConstructor) {
    if (!active.current) return;
    const session = new Constructor();
    const accepted = new Set<number>();
    session.lang = "es-419";
    session.continuous = true;
    session.interimResults = false;
    session.onresult = (event) => {
      const segments: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result?.isFinal && !accepted.has(index)) {
          accepted.add(index);
          const text = result[0]?.transcript.trim();
          if (text) segments.push(text);
        }
      }
      if (segments.length && mounted.current) {
        shortEnds.current = 0;
        setInput((current) => `${current}${current.trim() ? " " : ""}${segments.join(" ")}`);
      }
    };
    session.onerror = (event) => {
      if (recognition.current !== session && !active.current) return;
      if (event.error === "no-speech" || (!active.current && event.error === "aborted")) return;
      finish(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Permite el micrófono para dictar. El texto escrito se conserva."
        : "Se interrumpió el dictado. Puedes continuar escribiendo o volver a activarlo.");
    };
    session.onend = () => {
      if (recognition.current === session) recognition.current = null;
      if (!active.current) { finish(); return; }
      shortEnds.current = Date.now() - sessionStartedAt.current < 1500 ? shortEnds.current + 1 : 0;
      if (shortEnds.current >= 5) { finish("El navegador detuvo repetidamente el dictado. Puedes volver a intentarlo."); return; }
      restartTimer.current = window.setTimeout(() => { restartTimer.current = null; runRecognition(Constructor); }, 250);
    };
    try {
      sessionStartedAt.current = Date.now();
      recognition.current = session;
      session.start();
      if (mounted.current) setVoiceState("listening");
    } catch {
      finish("No se pudo iniciar el dictado. Revisa el permiso del micrófono.");
    }
  }, [finish, setInput]);

  const pause = React.useCallback(() => {
    if (!active.current) return;
    active.current = false;
    if (restartTimer.current !== null) window.clearTimeout(restartTimer.current);
    restartTimer.current = null;
    if (!recognition.current) { finish(); return; }
    setVoiceState("pausing");
    try {
      recognition.current.stop();
      restartTimer.current = window.setTimeout(() => finish(), 2500);
    } catch { finish(); }
  }, [finish]);

  const start = React.useCallback(async () => {
    if (active.current || voiceState !== "idle") return;
    const browser = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      toast.error("Tu navegador no ofrece dictado y visualización de audio. Puedes escribir el mensaje.");
      return;
    }
    active.current = true;
    shortEnds.current = 0;
    setVoiceState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current || !mounted.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      microphone.current = stream;
      const context = new AudioContext();
      audioContext.current = context;
      const source = context.createMediaStreamSource(stream);
      const meter = context.createAnalyser();
      meter.fftSize = 1024;
      source.connect(meter);
      await context.resume();
      if (!active.current || !mounted.current) { finish(); return; }
      setAnalyser(meter);
      startRecognition(Constructor);
    } catch {
      if (active.current) finish("No se pudo acceder al micrófono. Revisa el permiso del navegador.");
      else releaseAudio();
    }
  }, [finish, releaseAudio, startRecognition, voiceState]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = false;
      if (restartTimer.current !== null) window.clearTimeout(restartTimer.current);
      recognition.current?.abort();
      releaseAudio();
    };
  }, [releaseAudio]);

  return { voiceState, analyser, start, pause };
}

const barIndexes = Array.from({ length: 11 }, (_, index) => index);

export function waveformHeight(samples: Uint8Array, start: number, end: number) {
  let energy = 0;
  for (let offset = start; offset < end; offset++) {
    const amplitude = (samples[offset] - 128) / 128;
    energy += amplitude * amplitude;
  }
  return Math.min(1, 0.18 + Math.sqrt(energy / Math.max(1, end - start)) * 7);
}

export function AudioWaveform({ analyser }: { analyser: AnalyserNode | null }) {
  const bars = React.useRef<Array<HTMLSpanElement | null>>([]);

  React.useEffect(() => {
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    const levels = new Array<number>(barIndexes.length).fill(0.2);
    let frame = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      const segment = Math.floor(samples.length / barIndexes.length);
      for (const index of barIndexes) {
        const target = waveformHeight(samples, index * segment, (index + 1) * segment);
        levels[index] = levels[index] * 0.6 + target * 0.4;
        if (bars.current[index]) bars.current[index]!.style.transform = `scaleY(${levels[index].toFixed(2)})`;
      }
      frame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(frame);
  }, [analyser]);

  return <span aria-hidden="true" className="flex h-6 items-center gap-0.5">{barIndexes.map((index) => <span key={index} ref={(element) => { bars.current[index] = element; }} className="h-5 w-0.5 rounded-full bg-destructive" style={{ transform: "scaleY(0.2)" }} />)}</span>;
}
