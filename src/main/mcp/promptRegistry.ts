import { McpToolError } from "./errors";
import type { JsonObject } from "./types";

interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
  text: (args: JsonObject) => string;
}

const promptDefinitions: readonly McpPromptDefinition[] = [
  {
    name: "agent-brief",
    description: "Produce a concise HCB planner brief for the user.",
    text: () => [
      "Brief the user on local HCB planner state.",
      "Read hcb://brief, hcb://status, and hcb://tail?level=warn&limit=25.",
      "Keep it concise: account/sync state, today counts, pending action risk, and next suggested read."
    ].join("\n")
  },
  {
    name: "agent-plan",
    description: "Draft a safe local plan from HCB planner data.",
    arguments: [optionalArgument("startDate", "Optional ISO date for the plan window.")],
    text: (args) => {
      const startDate = stringArg(args, "startDate");
      const resource = startDate ? `hcb://plan/${encodeURIComponent(startDate)}` : "hcb://plan";

      return [
        "Draft an HCB planner plan from local cache.",
        `Read ${resource}, hcb://brief, and hcb://pending-mutations?limit=50.`,
        "Separate read-only observations from proposed writes.",
        "Do not apply writes without explicit user approval."
      ].join("\n");
    }
  },
  {
    name: "debug-sync",
    description: "Inspect HCB sync/account/queue health and propose next commands.",
    arguments: [optionalArgument("focus", "Optional sync focus, e.g. tasks, calendar, auth, queue.")],
    text: (args) => [
      "Debug local HCB sync health.",
      `Focus: ${stringArg(args, "focus") ?? "overall"}.`,
      "First read hcb://doctor, hcb://status, hcb://diff, and hcb://logs?level=warn&limit=50.",
      "Use hcb_pending_mutations when queue detail is needed.",
      "Do not run writes unless the user explicitly approves a dry-run and confirmation flow.",
      "Return findings ordered by severity with exact CLI commands."
    ].join("\n")
  },
  {
    name: "inspect-pending-mutations",
    description: "Review pending queue entries and identify retry/cancel candidates.",
    text: () => [
      "Inspect HCB pending mutations.",
      "Read hcb://pending-mutations?limit=100 and hcb://status.",
      "For each failed or stale mutation, inspect hcb://mutations/{id}.",
      "Recommend retry or cancel only when the reason is clear from local diagnostics.",
      "Use dry-run first for hcb_retry_mutation or hcb_cancel_mutation."
    ].join("\n")
  },
  {
    name: "clean-stuck-google-sync",
    description: "Guide a safe stuck-sync cleanup using existing queue controls.",
    text: () => [
      "Clean up stuck HCB Google sync carefully.",
      "Read hcb://doctor, hcb://status, hcb://pending-mutations?limit=100, and hcb://logs?level=error&limit=50.",
      "If the account is not connected, stop and tell the user to reconnect Google.",
      "If queue entries are failed, dry-run hcb_retry_mutation before applying.",
      "Only dry-run hcb_cancel_mutation for entries that are clearly obsolete or invalid."
    ].join("\n")
  },
  {
    name: "review-today",
    description: "Review today's HCB agenda from local cache.",
    text: () => [
      "Review today's HCB agenda.",
      "Read hcb://today and hcb://status.",
      "Summarize tasks, events, and notes; flag overdue or unscheduled items.",
      "Do not create/update/delete anything unless the user asks."
    ].join("\n")
  },
  {
    name: "plan-week",
    description: "Review a seven-day agenda and suggest planning actions.",
    arguments: [optionalArgument("startDate", "Optional ISO date for the week start.")],
    text: (args) => {
      const startDate = stringArg(args, "startDate");
      const resource = startDate ? `hcb://week/${encodeURIComponent(startDate)}` : "hcb://week";

      return [
        "Plan the HCB week from local cache.",
        `Read ${resource}, hcb://today, and hcb://status.`,
        "Identify overloaded days, empty planning gaps, and unscheduled important tasks.",
        "Only suggest writes; do not apply them without user approval."
      ].join("\n");
    }
  },
  {
    name: "prepare-support-summary",
    description: "Prepare a redacted support/debug summary from local diagnostics.",
    text: () => [
      "Prepare a redacted HCB support summary.",
      "Read hcb://doctor, hcb://status, hcb://diff, and hcb://logs?level=warn&limit=100.",
      "Include app version, account state, sync state, queue counts, recent warning/error summaries, and next commands.",
      "Do not include secrets, bearer tokens, OAuth tokens, raw Google payloads, or private note/task bodies unless necessary."
    ].join("\n")
  }
];

export class McpPromptRegistry {
  listPrompts(): JsonObject[] {
    return promptDefinitions.map(({ name, description, arguments: args }) => ({
      name,
      description,
      ...(args === undefined
        ? {}
        : {
            arguments: args.map((arg) => ({
              name: arg.name,
              description: arg.description,
              required: arg.required ?? false
            }))
          })
    }));
  }

  getPrompt(name: string, args: JsonObject): JsonObject {
    const definition = promptDefinitions.find((candidate) => candidate.name === name);

    if (!definition) {
      throw new McpToolError("NOT_FOUND", "Unknown HCB MCP prompt.");
    }

    return {
      description: definition.description,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: definition.text(args)
          }
        }
      ]
    };
  }
}

function optionalArgument(name: string, description: string): McpPromptArgument {
  return { name, description, required: false };
}

function stringArg(args: JsonObject, key: string): string | undefined {
  const value = args[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
