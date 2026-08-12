import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import systematic from "../extensions/systematic.ts";
import type { Outcome, ProjectState } from "../src/core/types.ts";

type Handler = (...args: unknown[]) => unknown;
type RegisteredTool = {
  name: string;
  execute: (...args: unknown[]) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: unknown;
    isError?: boolean;
  }>;
};

test("the Pi adapter manages an outcome without registering user commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "systematic-extension-test-"));
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, RegisteredTool>();
  const statuses = new Map<string, string | undefined>();
  let sessionName: string | undefined;
  let registeredCommands = 0;
  let projectTrusted = true;

  const api = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {
      registeredCommands += 1;
    },
    setSessionName(name: string) {
      sessionName = name;
    },
  };
  const context = {
    cwd: root,
    hasUI: false,
    isProjectTrusted() {
      return projectTrusted;
    },
    ui: {
      setStatus(key: string, value: string | undefined) {
        statuses.set(key, value);
      },
    },
  } as unknown as ExtensionContext;

  systematic(api as unknown as ExtensionAPI);

  assert.equal(registeredCommands, 0);
  assert.deepEqual([...tools.keys()].sort(), [
    "systematic_begin_outcome",
    "systematic_define_outcome",
    "systematic_record_evidence",
    "systematic_request_decision",
    "systematic_resolve_decision",
    "systematic_update_outcome",
  ]);

  await callHandler(handlers, "session_start", {}, context);
  await callHandler(
    handlers,
    "input",
    { text: "How does this project work?", source: "interactive" },
    context,
  );
  await assert.rejects(readFile(join(root, ".systematic", "project.json")), /ENOENT/);

  await callHandler(
    handlers,
    "input",
    { text: "Fix authentication", source: "interactive" },
    context,
  );
  assert.equal(sessionName, "Fix authentication");
  assert.match(statuses.get("systematic") ?? "", /^captured · Fix authentication$/);

  const prompt = (await callHandler(
    handlers,
    "before_agent_start",
    { systemPrompt: "base prompt" },
    context,
  )) as { systemPrompt: string };
  assert.match(prompt.systemPrompt, /Active outcome/);
  assert.match(prompt.systemPrompt, /Fix authentication/);

  await callHandler(handlers, "agent_start", {}, context);
  assert.match(statuses.get("systematic") ?? "", /^executing · Fix authentication$/);

  await callTool(tools, "systematic_define_outcome", {
    definitionOfDone: ["Authentication tests pass."],
  }, context);
  const decisionResult = await callTool(tools, "systematic_request_decision", {
    question: "Which compatibility policy should be preserved?",
    reason: "The answer determines the public contract.",
    options: [{ label: "Backward compatible" }, { label: "Breaking change" }],
  }, context);
  const decisionOutcome = (decisionResult.details as { outcome: Outcome }).outcome;
  const decision = decisionOutcome.decisions.at(-1);
  assert.ok(decision);
  assert.equal(decision.status, "pending");
  await callTool(tools, "systematic_resolve_decision", {
    decisionId: decision.id,
    answer: "Backward compatible",
  }, context);
  await callTool(tools, "systematic_record_evidence", {
    kind: "test",
    description: "Authentication tests passed.",
    command: "npm test",
  }, context);
  await callTool(tools, "systematic_update_outcome", {
    status: "completed",
    summary: "Authentication is fixed and verified.",
  }, context);

  assert.equal(statuses.get("systematic"), undefined);
  const project = JSON.parse(
    await readFile(join(root, ".systematic", "project.json"), "utf8"),
  ) as ProjectState;
  assert.equal(project.activeOutcomeId, null);
  const outcome = JSON.parse(
    await readFile(join(root, ".systematic", "outcomes", `${project.outcomeIds[0]}.json`), "utf8"),
  ) as Outcome;
  assert.equal(outcome.status, "completed");

  projectTrusted = false;
  await callHandler(
    handlers,
    "input",
    { text: "Build an untrusted instruction", source: "interactive" },
    context,
  );
  const unchangedProject = JSON.parse(
    await readFile(join(root, ".systematic", "project.json"), "utf8"),
  ) as ProjectState;
  assert.deepEqual(unchangedProject.outcomeIds, project.outcomeIds);
  assert.equal(
    await callHandler(handlers, "before_agent_start", { systemPrompt: "base prompt" }, context),
    undefined,
  );
});

async function callHandler(
  handlers: Map<string, Handler>,
  name: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(name);
  assert.ok(handler, `Expected ${name} handler to be registered.`);
  return handler(...args);
}

async function callTool(
  tools: Map<string, RegisteredTool>,
  name: string,
  params: object,
  context: ExtensionContext,
): Promise<Awaited<ReturnType<RegisteredTool["execute"]>>> {
  const tool = tools.get(name);
  assert.ok(tool, `Expected ${name} tool to be registered.`);
  const result = await tool.execute("tool-call", params, undefined, undefined, context);
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return result;
}
