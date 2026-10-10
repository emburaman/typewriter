"use client";

import type { ReactNode } from "react";
import { SettingsProvider } from "./SettingsProvider";
import { SoundProvider } from "./SoundProvider";
import { ToastProvider } from "./ToastProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>
        <SoundProvider>{children}</SoundProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
