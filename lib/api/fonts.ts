import { request } from "./client";

export interface FontCatalog {
  source: "google" | "curated";
  families: string[];
}

export const getFonts = () => request<FontCatalog>("GET", "/fonts");
