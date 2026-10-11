"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { SettingsProvider } from "./SettingsProvider";
import { SoundProvider } from "./SoundProvider";
import { ToastProvider } from "./ToastProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <SettingsProvider>
          <SoundProvider>{children}</SoundProvider>
        </SettingsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
