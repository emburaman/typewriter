"use client";

import { THEMES, type Settings } from "@/lib/shared/schemas";
import { useSettings } from "./SettingsProvider";
import { useToast } from "./ToastProvider";
import { Icon } from "./Icon";

const LABEL: Record<Settings["theme"], string> = { light: "Light", dark: "Dark", system: "System" };

/** Cycles light → dark → system. */
export function ThemeToggle() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const next = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] ?? "system";

  return (
    <button
      type="button"
      className="icon-btn"
      title={`Theme: ${LABEL[settings.theme]} (switch to ${LABEL[next]})`}
      aria-label={`Theme: ${LABEL[settings.theme]}. Switch to ${LABEL[next]}`}
      onClick={() => {
        update({ theme: next }).catch((err: unknown) =>
          toast(`Could not save theme: ${err instanceof Error ? err.message : String(err)}`, "error"),
        );
      }}
    >
      <Icon name={settings.theme === "light" ? "sun" : settings.theme === "dark" ? "moon" : "monitor"} />
    </button>
  );
}
