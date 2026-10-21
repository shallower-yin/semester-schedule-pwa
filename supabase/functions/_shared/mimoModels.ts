export const MIMO_CHAT_MODELS = ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.5-pro-ultraspeed"] as const;

// Installed clients and existing configurations may still submit the retired IDs.
export function normalizeMimoModel(model: string): string {
  if (model === "mimo-v2.5") return "mimo-v2.6-flash";
  if (model === "mimo-v2.5-pro") return "mimo-v2.6-pro";
  return model;
}

export function mimoModelSupportsAttachments(model: string): boolean {
  const normalized = normalizeMimoModel(model);
  return normalized === "mimo-v2.6-flash" || normalized === "mimo-v2.6-pro";
}
