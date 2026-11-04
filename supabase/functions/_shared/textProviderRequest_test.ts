import { assertEquals } from "jsr:@std/assert@1";
import { textProviderHeaders, textProviderParameters, type TextProvider } from "./textProviderRequest.ts";

const providers: TextProvider[] = ["deepseek", "mimo", "siliconflow", "tju"];

Deno.test("text authentication preserves bearer and MiMo API-key headers", () => {
  for (const provider of providers) {
    assertEquals(textProviderHeaders(provider, "test-key"), {
      "content-type": "application/json",
      authorization: "Bearer test-key",
      ...(provider === "mimo" ? { "api-key": "test-key" } : {})
    });
  }
});

Deno.test("text parameters preserve each provider's token and thinking fields", () => {
  for (const provider of providers) {
    for (const { temperature, maxTokens } of [
      { temperature: 0.1, maxTokens: 6000 }, // translation
      { temperature: 0.2, maxTokens: 2600 }, // translation summary
      { temperature: 0.2, maxTokens: 1400 }, // assistant
      { temperature: 0.3, maxTokens: 6000 }, // standard mind map
      { temperature: 0.1, maxTokens: 2500 }, // document extraction/summary
      { temperature: 0.45, maxTokens: 1800 } // mind map follow-up
    ]) {
      assertEquals(textProviderParameters(provider, { temperature, maxTokens }), {
        ...(provider === "deepseek" || provider === "mimo" ? { thinking: { type: "disabled" } } : {}),
        temperature,
        ...(provider === "mimo" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        stream: false
      });
    }
  }
});

Deno.test("audio summary and follow-up retain their existing max_tokens contract", () => {
  for (const provider of providers) {
    for (const maxTokens of [1200, 1400]) {
      assertEquals(textProviderParameters(provider, { temperature: 0.2, maxTokens, tokenField: "max_tokens" }), {
        ...(provider === "deepseek" || provider === "mimo" ? { thinking: { type: "disabled" } } : {}),
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false
      });
    }
  }
});

Deno.test("JSON output is opt-in and remains controlled by the calling feature", () => {
  for (const provider of providers) {
    const options = { temperature: 0.2, maxTokens: 1400 };
    const plain = textProviderParameters(provider, options);
    assertEquals(textProviderParameters(provider, { ...options, jsonObject: false }), plain);
    assertEquals(textProviderParameters(provider, { ...options, jsonObject: true }), {
      ...plain,
      response_format: { type: "json_object" }
    });
  }
});
