export const OUTCOME_STATUSES = [
  "captured",
  "executing",
  "verifying",
  "blocked",
  "awaiting_review",
  "completed",
  "failed",
] as const;

export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const EVIDENCE_KINDS = ["test", "check", "review", "artifact", "observation"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  description: string;
  command?: string;
  path?: string;
  recordedAt: string;
}

export interface DecisionOption {
  label: string;
  description?: string;
}

export interface Decision {
  id: string;
  question: string;
  reason: string;
  options: DecisionOption[];
  status: "pending" | "resolved";
  answer?: string;
  requestedAt: string;
  resolvedAt?: string;
}

export interface Outcome {
  schemaVersion: 1;
  id: string;
  title: string;
  request: string;
  status: OutcomeStatus;
  definitionOfDone: string[];
  evidence: Evidence[];
  decisions: Decision[];
  summary?: string;
  blocker?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectState {
  schemaVersion: 1;
  activeOutcomeId: string | null;
  outcomeIds: string[];
}

export interface OutcomePatch {
  title?: string;
  status?: OutcomeStatus;
  definitionOfDone?: string[];
  summary?: string;
  blocker?: string;
}

export const TERMINAL_OUTCOME_STATUSES: ReadonlySet<OutcomeStatus> = new Set(["completed", "failed"]);

export function isVerificationEvidence(evidence: Evidence): boolean {
  return evidence.kind === "test" || evidence.kind === "check" || evidence.kind === "review";
}
