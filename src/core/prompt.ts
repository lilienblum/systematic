import type { Outcome } from "./types.ts";

const BASE_POLICY = `
Systematic is the silent outcome-management layer for this session.

Operating rules:
- Do not teach the user Systematic commands or require special prompt syntax.
- Answer explanatory questions normally.
- When a request asks for material work and no outcome is active, call systematic_begin_outcome before doing the work.
- For an active outcome, work autonomously toward the requested result. Inspect available context and make routine implementation decisions yourself.
- Define concrete completion criteria early with systematic_define_outcome.
- Ask the user only when a decision requires their judgment, authorization, credentials, or a meaningful product tradeoff. Use systematic_request_decision for that escalation.
- When the user's ordinary reply answers a pending decision, call systematic_resolve_decision before continuing.
- Record material tests, checks, reviews, and artifacts with systematic_record_evidence.
- Before claiming completion, run relevant verification, record its evidence, and call systematic_update_outcome with status completed and a concise summary.
- If safe progress is impossible, record a precise blocker instead of pretending the outcome is complete.
- Keep this orchestration unobtrusive. Report the work and evidence, not the machinery.
`.trim();

export function buildSystematicPrompt(outcome?: Outcome): string {
  if (!outcome) {
    return `${BASE_POLICY}\n\nThere is currently no active managed outcome.`;
  }

  const criteria = outcome.definitionOfDone.length
    ? outcome.definitionOfDone.map((item) => `- ${item}`).join("\n")
    : "- Not defined yet. Define it before substantial execution.";
  const pendingDecisions = outcome.decisions
    .filter((decision) => decision.status === "pending")
    .map((decision) => `- ${decision.question}`)
    .join("\n");
  const recentEvidence = outcome.evidence
    .slice(-5)
    .map((evidence) => `- [${evidence.kind}] ${evidence.description}`)
    .join("\n");

  return `${BASE_POLICY}

Active outcome (canonical state is in .systematic/):
- ID: ${outcome.id}
- Title: ${outcome.title}
- Status: ${outcome.status}
- Original request: ${outcome.request}

Definition of done:
${criteria}

Pending decisions:
${pendingDecisions || "- None"}

Recent evidence:
${recentEvidence || "- None"}`;
}
