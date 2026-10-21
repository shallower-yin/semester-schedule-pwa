import { assertEquals } from "jsr:@std/assert@1";
import { MIMO_CHAT_MODELS, mimoModelSupportsAttachments, normalizeMimoModel } from "./mimoModels.ts";

Deno.test("retired MiMo model IDs resolve to their official replacements", () => {
  assertEquals(normalizeMimoModel("mimo-v2.5"), "mimo-v2.6-flash");
  assertEquals(normalizeMimoModel("mimo-v2.5-pro"), "mimo-v2.6-pro");
  assertEquals(MIMO_CHAT_MODELS.includes("mimo-v2.6-flash"), true);
  assertEquals(MIMO_CHAT_MODELS.includes("mimo-v2.6-pro"), true);
});

Deno.test("normalization preserves unrelated models and the independent ASR model", () => {
  for (const model of ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.5-pro-ultraspeed", "mimo-v2.5-asr", "custom-model", ""]) {
    assertEquals(normalizeMimoModel(model), model);
  }
});

Deno.test("both V2.6 models and legacy client aliases retain attachment support", () => {
  for (const model of ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.5", "mimo-v2.5-pro"]) {
    assertEquals(mimoModelSupportsAttachments(model), true);
  }
  for (const model of ["mimo-v2.5-pro-ultraspeed", "mimo-v2.5-asr", "custom-model"]) {
    assertEquals(mimoModelSupportsAttachments(model), false);
  }
});
