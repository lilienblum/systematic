import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SystematicStore } from "../src/core/store.ts";

async function temporaryProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "systematic-test-"));
}

test("does not create state merely by reading an empty project", async () => {
  const root = await temporaryProject();
  const store = new SystematicStore(root);
  assert.equal(await store.getActiveOutcome(), undefined);
  await assert.rejects(readFile(join(root, ".systematic", "project.json")), /ENOENT/);
});

test("creates and persists a single active outcome", async () => {
  const root = await temporaryProject();
  const store = new SystematicStore(root);
  const created = await store.createOutcome("Fix authentication", "Fix authentication");
  const duplicate = await store.createOutcome("A second request", "Second");

  assert.equal(duplicate.id, created.id);
  assert.equal((await store.getActiveOutcome())?.request, "Fix authentication");
});

test("requires verification evidence before completion", async () => {
  const root = await temporaryProject();
  const store = new SystematicStore(root);
  const outcome = await store.createOutcome("Fix authentication", "Fix authentication");

  await assert.rejects(
    store.updateOutcome(outcome.id, { status: "completed", summary: "Fixed it." }),
    /Definition-of-done criteria/,
  );

  await store.updateOutcome(outcome.id, {
    definitionOfDone: ["Authentication tests pass."],
  });
  await assert.rejects(
    store.updateOutcome(outcome.id, { status: "completed", summary: "Fixed it." }),
    /Verification evidence/,
  );
  await store.recordEvidence(outcome.id, {
    kind: "test",
    description: "Authentication tests passed.",
    command: "npm test",
  });
  const completed = await store.updateOutcome(outcome.id, {
    status: "completed",
    summary: "Authentication now works.",
  });

  assert.equal(completed.status, "completed");
  assert.equal(await store.getActiveOutcome(), undefined);
});

test("blocks completion while a decision is pending", async () => {
  const root = await temporaryProject();
  const store = new SystematicStore(root);
  const outcome = await store.createOutcome("Choose an API design", "Choose API design");
  await store.updateOutcome(outcome.id, {
    definitionOfDone: ["The compatibility policy is selected and documented."],
  });
  await store.recordEvidence(outcome.id, { kind: "review", description: "Reviewed both API designs." });
  const { decision } = await store.requestDecision(outcome.id, {
    question: "Which compatibility policy should we use?",
    reason: "This changes the public API contract.",
    options: [{ label: "Compatible" }, { label: "Breaking" }],
  });

  await assert.rejects(
    store.updateOutcome(outcome.id, { status: "completed", summary: "Design selected." }),
    /pending human decisions/,
  );

  await store.resolveDecision(outcome.id, decision.id, "Compatible");
  const completed = await store.updateOutcome(outcome.id, {
    status: "completed",
    summary: "Selected the compatible design.",
  });
  assert.equal(completed.status, "completed");
});

test("requires a precise blocker when work cannot continue", async () => {
  const root = await temporaryProject();
  const store = new SystematicStore(root);
  const outcome = await store.createOutcome("Deploy the service", "Deploy service");

  await assert.rejects(store.updateOutcome(outcome.id, { status: "blocked" }), /precise blocker/);
  const blocked = await store.updateOutcome(outcome.id, {
    status: "blocked",
    blocker: "Production credentials require user authorization.",
  });
  assert.equal(blocked.status, "blocked");
});
