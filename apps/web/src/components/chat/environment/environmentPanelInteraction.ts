// FILE: environmentPanelInteraction.ts
// Purpose: Shared interaction decisions for the Environment panel and its header toggle.
// Layer: Environment panel behavior

export function shouldCloseEnvironmentPanelOnEscape(input: {
  defaultPrevented: boolean;
  key: string;
  open: boolean;
}): boolean {
  return input.open && input.key === "Escape" && !input.defaultPrevented;
}
