"use client";

import type { ReactNode } from "react";
import { SettingsProvider } from "./SettingsProvider";
import { ToastProvider } from "./ToastProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </ToastProvider>
  );
}
