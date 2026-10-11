import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Olive Writer",
  description: "A distraction-free place to write.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffbdb" },
    { media: "(prefers-color-scheme: dark)", color: "#30362f" },
  ],
};

/**
 * Applies the saved theme and font before first paint (avoids a light→dark flash).
 * Mirrors the logic in SettingsProvider, reading the localStorage settings mirror.
 */
const bootScript = `(function(){var d=document.documentElement,t='system',s=null;
try{var u=localStorage.getItem('typewriter:last-user');s=u?JSON.parse(localStorage.getItem('typewriter:'+u+':settings')||'null'):null;}catch(e){s=null;}
if(s&&s.theme)t=s.theme;
if(t==='system')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
d.dataset.theme=t;d.style.colorScheme=t;
if(s&&typeof s.fontFamily==='string'&&/^[A-Za-z0-9 ]+$/.test(s.fontFamily))d.style.setProperty('--editor-font','"'+s.fontFamily+'"');
if(s&&typeof s.fontSize==='number')d.style.setProperty('--editor-size',s.fontSize+'px');})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
