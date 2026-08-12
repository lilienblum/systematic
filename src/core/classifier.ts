export type InputIntent = "conversation" | "outcome" | "continuation";

const ACTION_VERBS =
  "add|build|change|create|debug|delete|design|document|fix|implement|improve|investigate|migrate|move|optimize|redesign|refactor|remove|rename|repair|replace|review|ship|test|update|upgrade|verify|write";

const DIRECT_ACTION = new RegExp(`^(?:please\\s+)?(?:${ACTION_VERBS})\\b`, "i");
const POLITE_ACTION = new RegExp(
  `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:${ACTION_VERBS})\\b`,
  "i",
);
const DESIRED_ACTION = new RegExp(
  `^i\\s+(?:need|want|would\\s+like)\\s+(?:you\\s+)?to\\s+(?:${ACTION_VERBS})\\b`,
  "i",
);
const COLLABORATIVE_ACTION = new RegExp(`^let(?:'s| us)\\s+(?:${ACTION_VERBS})\\b`, "i");
const EXPLANATORY_QUESTION = /^(?:how|what|why|when|where|who|which|is|are|do|does|did|should)\b/i;

export function classifyInput(text: string, hasActiveOutcome: boolean): InputIntent {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized || normalized.startsWith("/") || normalized.startsWith("!")) {
    return "conversation";
  }

  if (hasActiveOutcome) {
    return "continuation";
  }

  if (
    DIRECT_ACTION.test(normalized) ||
    POLITE_ACTION.test(normalized) ||
    DESIRED_ACTION.test(normalized) ||
    COLLABORATIVE_ACTION.test(normalized)
  ) {
    return "outcome";
  }

  if (normalized.endsWith("?") || EXPLANATORY_QUESTION.test(normalized)) {
    return "conversation";
  }

  return "conversation";
}

export function deriveOutcomeTitle(request: string): string {
  const firstLine = request.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ") ?? "Untitled outcome";
  const withoutPreamble = firstLine
    .replace(/^(?:please\s+)/i, "")
    .replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i, "")
    .replace(/^i\s+(?:need|want|would\s+like)\s+(?:you\s+)?to\s+/i, "")
    .replace(/^let(?:'s| us)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

  if (withoutPreamble.length <= 80) return withoutPreamble || "Untitled outcome";
  return `${withoutPreamble.slice(0, 77).trimEnd()}...`;
}
