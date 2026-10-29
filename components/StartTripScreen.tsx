"use client";

import { NAV_LANGUAGES } from "@/lib/navLanguage";
import type { NavLanguage } from "@/lib/navLanguage";

interface StartTripScreenProps {
  language: NavLanguage;
  onLanguageChange: (value: NavLanguage) => void;
  voiceEnabled: boolean;
  onToggleVoice: (value: boolean) => void;
  onStart: () => void;
}

// Shown on every page load: the tap on "Start driving" is what lets the browser play
// voice and warning sounds through the car speakers.
export function StartTripScreen({
  language,
  onLanguageChange,
  voiceEnabled,
  onToggleVoice,
  onStart,
}: StartTripScreenProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-8 px-6">
        <button
          onClick={onStart}
          className="flex h-40 w-[min(520px,90vw)] items-center justify-center gap-4 rounded-3xl bg-blue-600 text-4xl font-bold text-white shadow-2xl transition-transform active:scale-95"
        >
          <span aria-hidden>▶</span>
          Start driving
        </button>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {NAV_LANGUAGES.map((option) => (
            <button
              key={option.code}
              onClick={() => onLanguageChange(option.code)}
              className={`
                h-16 min-w-[120px] rounded-2xl px-5 text-xl font-semibold transition-colors
                ${language === option.code ? "bg-white text-black" : "bg-white/15 text-white"}
              `}
            >
              {option.label}
            </button>
          ))}
          <button
            onClick={() => onToggleVoice(!voiceEnabled)}
            className={`
              h-16 rounded-2xl px-5 text-xl font-semibold transition-colors
              ${voiceEnabled ? "bg-white text-black" : "bg-white/15 text-white"}
            `}
            aria-pressed={voiceEnabled}
          >
            {voiceEnabled ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
        </div>

        <p className="max-w-md text-center text-base text-white/70">
          Tap once so the browser can play voice guidance and camera warnings through the car speakers.
        </p>
      </div>
    </div>
  );
}
