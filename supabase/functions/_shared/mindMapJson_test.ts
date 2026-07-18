import { assertEquals } from "jsr:@std/assert@1";
import { parseMindMapJson } from "./mindMapJson.ts";

Deno.test("parses a complete mind map response without repair", () => {
  const result = parseMindMapJson('{"answer":"完成","mindMap":{"label":"主题","children":[]}}');
  assertEquals(result.repaired, false);
  assertEquals((result.value as { mindMap: { label: string } }).mindMap.label, "主题");
});

Deno.test("repairs a fenced response with trailing text", () => {
  const result = parseMindMapJson('```json\n{"answer":"完成","mindMap":{"label":"主题","children":[]}}\n```');
  assertEquals((result.value as { mindMap: { label: string } }).mindMap.label, "主题");
});

Deno.test("repairs a truncated mind map response", () => {
  const result = parseMindMapJson('{"answer":"完成","mindMap":{"label":"主题","children":[{"label":"分支","children":[]}]');
  assertEquals(result.repaired, true);
  assertEquals((result.value as { mindMap: { children: Array<{ label: string }> } }).mindMap.children[0].label, "分支");
});
