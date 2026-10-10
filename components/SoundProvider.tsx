"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { KeySound } from "@/lib/sound/keySounds";
import { readSoundPreference, writeSoundPreference } from "@/lib/sound/preference";
import { playKeySound } from "@/lib/sound/typewriterAudio";

interface SoundContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Plays `kind` if sound is enabled. Cheap to call on every keystroke. */
  play: (kind: KeySound) => void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const enabledRef = useRef(true);

  useEffect(() => {
    const stored = readSoundPreference();
    enabledRef.current = stored;
    setEnabledState(stored);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    enabledRef.current = next;
    setEnabledState(next);
    writeSoundPreference(next);
    // Audible confirmation; the click is also the user gesture that unlocks audio.
    if (next) playKeySound("key");
  }, []);

  const play = useCallback((kind: KeySound) => {
    if (enabledRef.current) playKeySound(kind);
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled, play }), [enabled, setEnabled, play]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound(): SoundContextValue {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used inside <SoundProvider>");
  return ctx;
}
