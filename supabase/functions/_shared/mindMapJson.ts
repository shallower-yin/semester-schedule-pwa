import { jsonrepair } from "npm:jsonrepair@3.13.1";

export function parseMindMapJson(content: string): { value: unknown; repaired: boolean } {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return { value: JSON.parse(cleaned), repaired: false };
  } catch {
    const repaired = jsonrepair(cleaned);
    return { value: JSON.parse(repaired), repaired: repaired !== cleaned };
  }
}
