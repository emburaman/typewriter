"use client";

import { useEffect } from "react";

/** Builds a Google Fonts css2 URL. `withVariants` also requests bold + italic faces. */
export function googleFontUrl(family: string, withVariants: boolean): string {
  const name = family.trim().replace(/ /g, "+");
  const axes = withVariants ? ":ital,wght@0,400;0,700;1,400;1,700" : "";
  return `https://fonts.googleapis.com/css2?family=${name}${axes}&display=swap`;
}

/**
 * Injects (or updates) a <link> that loads `family` from Google Fonts. Many families
 * don't ship bold/italic faces and Google answers 400 for those variant requests, so
 * the hook retries with the regular face only and lets the browser synthesize the rest.
 */
export function useGoogleFont(family: string | null, linkId = "tw-google-font"): void {
  useEffect(() => {
    if (!family) return;
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    const el = link;
    const fallback = googleFontUrl(family, false);
    const onError = () => {
      if (el.href !== fallback) el.href = fallback;
    };
    el.addEventListener("error", onError);
    el.href = googleFontUrl(family, true);
    return () => el.removeEventListener("error", onError);
  }, [family, linkId]);
}
