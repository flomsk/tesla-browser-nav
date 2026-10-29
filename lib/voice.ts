"use client";

// Thin wrapper around the browser's speech synthesis (plays through the car speakers in a Tesla).
// Browsers only allow audio after a user gesture, so unlockAudio() must be called from a tap
// (the "Start driving" screen does this).

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return (
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith(prefix))
  );
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, lang: string, { interrupt = false } = {}): void {
  if (!isSpeechSupported() || !text) return;

  const synth = window.speechSynthesis;
  if (interrupt) synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  synth.speak(utterance);
}

let audioContext: AudioContext | null = null;

// Short double beep for camera warnings (distinct from the police alert sound)
export function beep(): void {
  if (!audioContext || audioContext.state !== "running") return;
  const ctx = audioContext;
  [0, 0.22].forEach((offset) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 1046; // C6
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(ctx.currentTime + offset);
    oscillator.stop(ctx.currentTime + offset + 0.2);
  });
}

// Must run inside a user gesture handler
export function unlockAudio(audioElements: (HTMLAudioElement | null)[]): void {
  if (typeof window !== "undefined" && "AudioContext" in window) {
    audioContext ??= new AudioContext();
    audioContext.resume().catch(() => {});
  }

  for (const audio of audioElements) {
    if (!audio) continue;
    const { volume } = audio;
    audio.volume = 0;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = volume;
      })
      .catch(() => {
        audio.volume = volume;
      });
  }

  if (isSpeechSupported()) {
    // Loads voices and satisfies the gesture requirement
    window.speechSynthesis.getVoices();
    const warmup = new SpeechSynthesisUtterance(" ");
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  }
}
