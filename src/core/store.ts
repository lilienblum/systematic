import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  TERMINAL_OUTCOME_STATUSES,
  isVerificationEvidence,
  type Decision,
  type DecisionOption,
  type Evidence,
  type EvidenceKind,
  type Outcome,
  type OutcomePatch,
  type ProjectState,
} from "./types.ts";

const EMPTY_PROJECT: ProjectState = {
  schemaVersion: 1,
  activeOutcomeId: null,
  outcomeIds: [],
};

export class SystematicStore {
  readonly root: string;
  readonly outcomesDirectory: string;
  readonly projectFile: string;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(projectRoot: string) {
    this.root = join(projectRoot, ".systematic");
    this.outcomesDirectory = join(this.root, "outcomes");
    this.projectFile = join(this.root, "project.json");
  }

  async getActiveOutcome(): Promise<Outcome | undefined> {
    await this.writeQueue;
    const project = await this.readProject();
    if (!project.activeOutcomeId) return undefined;
    return this.readOutcome(project.activeOutcomeId);
  }

  async createOutcome(request: string, title: string): Promise<Outcome> {
    return this.withWriteLock(async () => {
      const project = await this.readProject();
      if (project.activeOutcomeId) {
        const active = await this.readOutcome(project.activeOutcomeId);
        if (active && !TERMINAL_OUTCOME_STATUSES.has(active.status)) return active;
      }

      const now = new Date().toISOString();
      const outcome: Outcome = {
        schemaVersion: 1,
        id: randomUUID(),
        title,
        request,
        status: "captured",
        definitionOfDone: [],
        evidence: [],
        decisions: [],
        createdAt: now,
        updatedAt: now,
      };

      project.activeOutcomeId = outcome.id;
      project.outcomeIds.push(outcome.id);
      await this.writeOutcome(outcome);
      await this.writeProject(project);
      return outcome;
    });
  }

  async updateOutcome(outcomeId: string, patch: OutcomePatch): Promise<Outcome> {
    return this.withWriteLock(async () => {
      const outcome = await this.requireOutcome(outcomeId);
      const next: Outcome = {
        ...outcome,
        ...patch,
        definitionOfDone: patch.definitionOfDone
          ? uniqueNonEmpty(patch.definitionOfDone)
          : outcome.definitionOfDone,
        updatedAt: new Date().toISOString(),
      };

      if (next.status === "blocked" && !next.blocker?.trim()) {
        throw new Error("A precise blocker is required when an outcome is blocked.");
      }

      if (next.status === "completed") {
        if (next.definitionOfDone.length === 0) {
          throw new Error("Definition-of-done criteria are required before an outcome can be completed.");
        }
        if (!next.summary?.trim()) {
          throw new Error("A completion summary is required before an outcome can be completed.");
        }
        if (!next.evidence.some(isVerificationEvidence)) {
          throw new Error("Verification evidence is required before an outcome can be completed.");
        }
        if (next.decisions.some((decision) => decision.status === "pending")) {
          throw new Error("Resolve pending human decisions before completing the outcome.");
        }
      }

      if (next.status !== "blocked") next.blocker = undefined;
      await this.writeOutcome(next);

      if (TERMINAL_OUTCOME_STATUSES.has(next.status)) {
        const project = await this.readProject();
        if (project.activeOutcomeId === next.id) {
          project.activeOutcomeId = null;
          await this.writeProject(project);
        }
      }

      return next;
    });
  }

  async recordEvidence(
    outcomeId: string,
    input: { kind: EvidenceKind; description: string; command?: string; path?: string },
  ): Promise<Outcome> {
    return this.withWriteLock(async () => {
      const outcome = await this.requireOutcome(outcomeId);
      const evidence: Evidence = {
        id: randomUUID(),
        kind: input.kind,
        description: requiredText(input.description, "Evidence description"),
        command: optionalText(input.command),
        path: optionalText(input.path),
        recordedAt: new Date().toISOString(),
      };
      const next = {
        ...outcome,
        evidence: [...outcome.evidence, evidence],
        updatedAt: evidence.recordedAt,
      };
      await this.writeOutcome(next);
      return next;
    });
  }

  async requestDecision(
    outcomeId: string,
    input: { question: string; reason: string; options: DecisionOption[] },
  ): Promise<{ outcome: Outcome; decision: Decision }> {
    return this.withWriteLock(async () => {
      const outcome = await this.requireOutcome(outcomeId);
      const decision: Decision = {
        id: randomUUID(),
        question: requiredText(input.question, "Decision question"),
        reason: requiredText(input.reason, "Decision reason"),
        options: input.options.map((option) => ({
          label: requiredText(option.label, "Decision option label"),
          description: optionalText(option.description),
        })),
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      if (decision.options.length < 2) throw new Error("A decision requires at least two options.");

      const next: Outcome = {
        ...outcome,
        status: "blocked",
        blocker: decision.question,
        decisions: [...outcome.decisions, decision],
        updatedAt: decision.requestedAt,
      };
      await this.writeOutcome(next);
      return { outcome: next, decision };
    });
  }

  async resolveDecision(outcomeId: string, decisionId: string, answer: string): Promise<Outcome> {
    return this.withWriteLock(async () => {
      const outcome = await this.requireOutcome(outcomeId);
      const resolvedAt = new Date().toISOString();
      let found = false;
      const decisions = outcome.decisions.map((decision) => {
        if (decision.id !== decisionId) return decision;
        found = true;
        return {
          ...decision,
          status: "resolved" as const,
          answer: requiredText(answer, "Decision answer"),
          resolvedAt,
        };
      });
      if (!found) throw new Error(`Decision ${decisionId} does not exist.`);

      const next: Outcome = {
        ...outcome,
        decisions,
        status: "executing",
        blocker: undefined,
        updatedAt: resolvedAt,
      };
      await this.writeOutcome(next);
      return next;
    });
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readProject(): Promise<ProjectState> {
    const project = await readJson<ProjectState>(this.projectFile);
    if (!project) return structuredClone(EMPTY_PROJECT);
    if (project.schemaVersion !== 1 || !Array.isArray(project.outcomeIds)) {
      throw new Error(`Unsupported Systematic project state in ${this.projectFile}.`);
    }
    return project;
  }

  private async readOutcome(outcomeId: string): Promise<Outcome | undefined> {
    return readJson<Outcome>(this.outcomePath(outcomeId));
  }

  private async requireOutcome(outcomeId: string): Promise<Outcome> {
    const outcome = await this.readOutcome(outcomeId);
    if (!outcome) throw new Error(`Outcome ${outcomeId} does not exist.`);
    return outcome;
  }

  private async writeProject(project: ProjectState): Promise<void> {
    await atomicWriteJson(this.projectFile, project);
  }

  private async writeOutcome(outcome: Outcome): Promise<void> {
    await atomicWriteJson(this.outcomePath(outcome.id), outcome);
  }

  private outcomePath(outcomeId: string): string {
    if (!/^[a-f0-9-]+$/i.test(outcomeId)) throw new Error("Invalid outcome ID.");
    return join(this.outcomesDirectory, `${outcomeId}.json`);
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
