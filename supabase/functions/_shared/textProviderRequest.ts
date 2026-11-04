export type TextProvider = "deepseek" | "mimo" | "siliconflow" | "tju";

interface TextProviderParameters {
  temperature: number;
  maxTokens: number;
  jsonObject?: boolean;
  // Audio summary/follow-up currently use this field even for MiMo.
  tokenField?: "max_tokens";
}

/** Transport-only defaults; callers retain prompts, routing, retries and errors. */
export function textProviderHeaders(provider: TextProvider, apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(provider === "mimo" ? { "api-key": apiKey } : {})
  };
}

export function textProviderParameters(provider: TextProvider, options: TextProviderParameters) {
  return {
    ...(provider === "deepseek" || provider === "mimo" ? { thinking: { type: "disabled" } } : {}),
    temperature: options.temperature,
    ...(provider === "mimo" && options.tokenField !== "max_tokens"
      ? { max_completion_tokens: options.maxTokens }
      : { max_tokens: options.maxTokens }),
    ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
    stream: false
  };
}
