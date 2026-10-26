import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  documentIdSchema,
  documentWriteSchema,
  settingsSchema,
  settingsUpdateSchema,
} from "../../lib/shared/schemas";

describe("settings schema", () => {
  it("accepts the defaults", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("allows at most 5 toolbar colors", () => {
    const six = ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"];
    expect(settingsUpdateSchema.safeParse({ toolbarColors: six }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ toolbarColors: six.slice(0, 5) }).success).toBe(true);
  });

  it("requires at least one toolbar color", () => {
    expect(settingsUpdateSchema.safeParse({ toolbarColors: [] }).success).toBe(false);
  });

  it("caps highlight colors at 5, like toolbar colors", () => {
    const six = ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"];
    expect(settingsUpdateSchema.safeParse({ highlightColors: six }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ highlightColors: six.slice(0, 5) }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ highlightColors: [] }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ highlightColors: ["yellow"] }).success).toBe(false);
  });

  it("rejects non-hex colors", () => {
    expect(settingsUpdateSchema.safeParse({ toolbarColors: ["red"] }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ toolbarColors: ["#fff"] }).success).toBe(false);
  });

  it("only allows safe Google Font family names", () => {
    expect(settingsUpdateSchema.safeParse({ fontFamily: "Source Serif 4" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ fontFamily: "x'); background:url(evil" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ fontFamily: "" }).success).toBe(false);
  });

  it("validates theme and font size bounds", () => {
    expect(settingsUpdateSchema.safeParse({ theme: "sepia" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ fontSize: 11 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ fontSize: 33 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ fontSize: 20 }).success).toBe(true);
  });

  it("rejects unknown keys in strict mode (as the API does)", () => {
    expect(settingsUpdateSchema.strict().safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("document schemas", () => {
  it("requires a ProseMirror doc root", () => {
    const base = { contentHtml: "<p></p>" };
    expect(documentWriteSchema.safeParse({ ...base, contentJson: { type: "doc", content: [] } }).success).toBe(true);
    expect(documentWriteSchema.safeParse({ ...base, contentJson: { type: "paragraph" } }).success).toBe(false);
  });

  it("defaults the title and word count", () => {
    const parsed = documentWriteSchema.parse({ contentJson: { type: "doc" }, contentHtml: "" });
    expect(parsed.title).toBe("Untitled");
    expect(parsed.wordCount).toBe(0);
  });

  it("validates ids as UUIDs", () => {
    expect(documentIdSchema.safeParse("3f2b9c1e-8a4d-4f6b-9c2d-1e2f3a4b5c6d").success).toBe(true);
    expect(documentIdSchema.safeParse("1; DROP TABLE documents").success).toBe(false);
  });
});
