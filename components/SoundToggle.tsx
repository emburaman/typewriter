"use client";

import { Icon } from "./Icon";
import { useSound } from "./SoundProvider";

export function SoundToggle() {
  const { enabled, setEnabled } = useSound();
  const label = enabled ? "Typewriter sound: on" : "Typewriter sound: off";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={enabled}
      aria-label="Typewriter sound"
      title={`${label} (click to turn ${enabled ? "off" : "on"})`}
      onClick={() => setEnabled(!enabled)}
    >
      <Icon name={enabled ? "volume" : "volumeOff"} />
    </button>
  );
}
