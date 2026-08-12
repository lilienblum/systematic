import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { classifyInput, deriveOutcomeTitle } from "../src/core/classifier.ts";
import { buildSystematicPrompt } from "../src/core/prompt.ts";
import { SystematicStore } from "../src/core/store.ts";
import {
  EVIDENCE_KINDS,
  OUTCOME_STATUSES,
  type EvidenceKind,
  type Outcome,
  type OutcomeStatus,
} from "../src/core/types.ts";

const STATUS_KEY = "systematic";

const BeginOutcomeParameters = Type.Object({
  request: Type.String({ description: "The user's desired material result, in their own terms." }),
  title: Type.String({ description: "A concise, action-oriented title for the outcome." }),
});

const DefineOutcomeParameters = Type.Object({
  title: Type.Optional(Type.String({ description: "A clearer title discovered during inspection." })),
  definitionOfDone: Type.Array(Type.String(), {
    minItems: 1,
    description: "Observable conditions that must hold before completion can be claimed.",
  }),
});

const RecordEvidenceParameters = Type.Object({
  kind: Type.Union(EVIDENCE_KINDS.map((kind) => Type.Literal(kind))),
  description: Type.String({ description: "What was verified or produced, including the result." }),
  command: Type.Optional(Type.String({ description: "Exact command used, when applicable." })),
  path: Type.Optional(Type.String({ description: "Relevant artifact or file path, when applicable." })),
});

const UpdateOutcomeParameters = Type.Object({
  status: Type.Union(
    OUTCOME_STATUSES.filter((status) => status !== "captured" && status !== "awaiting_review").map((status) =>
      Type.Literal(status),
    ),
  ),
  summary: Type.Optional(Type.String({ description: "Concise result or current-state summary." })),
  blocker: Type.Optional(Type.String({ description: "Precise blocker when status is blocked." })),
});

const DecisionOption = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
});

const RequestDecisionParameters = Type.Object({
  question: Type.String({ description: "The single decision the user must make." }),
  reason: Type.String({ description: "Why proceeding without the user's judgment would be unsafe or arbitrary." }),
  options: Type.Array(DecisionOption, { minItems: 2, maxItems: 4 }),
});

const ResolveDecisionParameters = Type.Object({
  decisionId: Type.String({ description: "The ID of the pending decision answered by the user." }),
  answer: Type.String({ description: "The user's answer, preserving any important qualification." }),
});

export default function systematic(pi: ExtensionAPI): void {
  let store: SystematicStore | undefined;
  let activeOutcome: Outcome | undefined;

  const getStore = (ctx: ExtensionContext): SystematicStore => {
    if (!ctx.isProjectTrusted()) {
      throw new Error("Systematic is disabled until this Pi project is trusted.");
    }
    store ??= new SystematicStore(ctx.cwd);
    return store;
  };

  const showStatus = (ctx: ExtensionContext): void => {
    if (!activeOutcome) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, `${activeOutcome.status.replaceAll("_", " ")} · ${activeOutcome.title}`);
  };

  const refresh = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.isProjectTrusted()) {
      activeOutcome = undefined;
      showStatus(ctx);
      return;
    }
    activeOutcome = await getStore(ctx).getActiveOutcome();
    showStatus(ctx);
  };

  const requireActive = async (ctx: ExtensionContext): Promise<Outcome> => {
    await refresh(ctx);
    if (!activeOutcome) throw new Error("There is no active Systematic outcome.");
    return activeOutcome;
  };

  pi.on("session_start", async (_event, ctx) => {
    store = undefined;
    activeOutcome = undefined;
    if (!ctx.isProjectTrusted()) {
      showStatus(ctx);
      return;
    }
    store = new SystematicStore(ctx.cwd);
    await refresh(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (!ctx.isProjectTrusted()) return { action: "continue" };

    await refresh(ctx);
    const intent = classifyInput(event.text, Boolean(activeOutcome));
    if (intent === "outcome") {
      activeOutcome = await getStore(ctx).createOutcome(event.text, deriveOutcomeTitle(event.text));
      pi.setSessionName(activeOutcome.title);
      showStatus(ctx);
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    await refresh(ctx);
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystematicPrompt(activeOutcome)}`,
    };
  });

  pi.on("agent_start", async (_event, ctx) => {
    await refresh(ctx);
    if (activeOutcome && (activeOutcome.status === "captured" || activeOutcome.status === "awaiting_review")) {
      activeOutcome = await getStore(ctx).updateOutcome(activeOutcome.id, { status: "executing" });
      showStatus(ctx);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await refresh(ctx);
    if (activeOutcome && (activeOutcome.status === "executing" || activeOutcome.status === "verifying")) {
      activeOutcome = await getStore(ctx).updateOutcome(activeOutcome.id, { status: "awaiting_review" });
      showStatus(ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerTool({
    name: "systematic_begin_outcome",
    label: "Outcome",
    description:
      "Begin tracking a material work request as an outcome. Use only when no outcome is active; do not use for explanatory conversation.",
    parameters: BeginOutcomeParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        activeOutcome = await getStore(ctx).createOutcome(params.request, params.title);
        pi.setSessionName(activeOutcome.title);
        showStatus(ctx);
        return toolResult(`Outcome active: ${activeOutcome.title}`, activeOutcome);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "systematic_define_outcome",
    label: "Outcome criteria",
    description: "Define or refine the active outcome's observable completion criteria after inspecting the project.",
    parameters: DefineOutcomeParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = await requireActive(ctx);
        activeOutcome = await getStore(ctx).updateOutcome(outcome.id, {
          title: params.title,
          definitionOfDone: params.definitionOfDone,
        });
        showStatus(ctx);
        return toolResult(`Defined ${activeOutcome.definitionOfDone.length} completion criteria.`, activeOutcome);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "systematic_record_evidence",
    label: "Evidence",
    description:
      "Record material verification or an artifact for the active outcome. Record actual results, never intended or assumed results.",
    parameters: RecordEvidenceParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = await requireActive(ctx);
        activeOutcome = await getStore(ctx).recordEvidence(outcome.id, {
          kind: params.kind as EvidenceKind,
          description: params.description,
          command: params.command,
          path: params.path,
        });
        showStatus(ctx);
        return toolResult(`Evidence recorded: ${params.description}`, activeOutcome);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "systematic_update_outcome",
    label: "Outcome status",
    description:
      "Update the active outcome lifecycle. Completion is rejected unless verification evidence exists and all decisions are resolved.",
    parameters: UpdateOutcomeParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = await requireActive(ctx);
        activeOutcome = await getStore(ctx).updateOutcome(outcome.id, {
          status: params.status as OutcomeStatus,
          summary: params.summary,
          blocker: params.blocker,
        });
        const updated = activeOutcome;
        if (updated.status === "completed" || updated.status === "failed") activeOutcome = undefined;
        showStatus(ctx);
        return toolResult(`Outcome status: ${updated.status}`, updated);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "systematic_request_decision",
    label: "Decision",
    description:
      "Escalate one genuine human decision. Do not use for routine implementation choices that can be resolved from project context.",
    parameters: RequestDecisionParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = await requireActive(ctx);
        const requested = await getStore(ctx).requestDecision(outcome.id, {
          question: params.question,
          reason: params.reason,
          options: params.options,
        });
        activeOutcome = requested.outcome;
        showStatus(ctx);

        if (!ctx.hasUI) {
          return toolResult(`Decision pending: ${requested.decision.question}`, requested.outcome);
        }

        const labels = requested.decision.options.map((option) =>
          option.description ? `${option.label} — ${option.description}` : option.label,
        );
        const selection = await ctx.ui.select(requested.decision.question, labels);
        if (!selection) {
          return toolResult(`Decision remains pending: ${requested.decision.question}`, requested.outcome);
        }

        const selectedIndex = labels.indexOf(selection);
        const answer = requested.decision.options[selectedIndex]?.label ?? selection;
        activeOutcome = await getStore(ctx).resolveDecision(outcome.id, requested.decision.id, answer);
        showStatus(ctx);
        return toolResult(`Decision resolved: ${answer}`, activeOutcome);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "systematic_resolve_decision",
    label: "Decision resolved",
    description:
      "Resolve an existing pending decision when the user's ordinary reply supplies the answer. Continue the outcome afterward.",
    parameters: ResolveDecisionParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = await requireActive(ctx);
        activeOutcome = await getStore(ctx).resolveDecision(outcome.id, params.decisionId, params.answer);
        showStatus(ctx);
        return toolResult(`Decision resolved: ${params.answer}`, activeOutcome);
      } catch (error) {
        return toolError(error);
      }
    },
  });
}

function toolResult(message: string, outcome: Outcome) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { outcome },
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Systematic state error: ${message}` }],
    details: { error: message },
    isError: true,
  };
}
