import { McpToolError } from "./errors";
import { McpToolRegistry } from "./toolRegistry";
import type { JsonObject, JsonValue, McpToolCallContext, McpToolResponse } from "./types";

interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface McpResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

const jsonMimeType = "application/json";

const staticResources: readonly McpResourceDefinition[] = [
  resource("hcb://status", "status", "Current HCB account, sync, cache, queue, and MCP status."),
  resource("hcb://doctor", "doctor", "Read-only diagnostic findings and suggested next commands."),
  resource("hcb://today", "today", "Today's tasks, notes, and events."),
  resource("hcb://week", "week", "Seven-day agenda from today."),
  resource("hcb://diff", "diff", "Pending local-to-Google mutations."),
  resource("hcb://logs", "logs", "Recent sanitized HCB logs."),
  resource("hcb://pending-mutations", "pending-mutations", "Pending mutation queue entries.")
];

const resourceTemplates: readonly McpResourceTemplateDefinition[] = [
  template("hcb://week/{startDate}", "week-by-start-date", "Seven-day agenda from an ISO date."),
  template("hcb://tasks/{id}", "task-by-id", "Task detail by id."),
  template("hcb://events/{id}", "event-by-id", "Calendar event detail by id."),
  template("hcb://notes/{id}", "note-by-id", "Note detail by id."),
  template("hcb://mutations/{id}", "mutation-by-id", "Pending mutation detail by id.")
];

export class McpResourceRegistry {
  constructor(private readonly tools: McpToolRegistry) {}

  listResources(): JsonObject[] {
    return staticResources.map((definition) => ({ ...definition }));
  }

  listResourceTemplates(): JsonObject[] {
    return resourceTemplates.map((definition) => ({ ...definition }));
  }

  async readResource(uri: string, context: McpToolCallContext): Promise<JsonObject> {
    const parsed = parseHcbUri(uri);
    const response = await this.readResourceResponse(parsed, context);
    return {
      contents: [
        {
          uri,
          mimeType: jsonMimeType,
          text: JSON.stringify(response.payload, null, 2)
        }
      ]
    };
  }

  private async readResourceResponse(
    parsed: ParsedHcbUri,
    context: McpToolCallContext
  ): Promise<{ payload: JsonObject }> {
    switch (parsed.host) {
      case "status":
        return resourcePayload("status", await this.tools.callTool("hcb_status", {}, context));
      case "doctor":
        return resourcePayload("doctor", await this.tools.callTool("hcb_doctor", {}, context));
      case "today":
        return resourcePayload("today", await this.tools.callTool("hcb_today", {}, context));
      case "week":
        return resourcePayload("week", await this.tools.callTool("hcb_week", weekArgs(parsed), context));
      case "diff":
        return resourcePayload("diff", await this.tools.callTool("hcb_diff", limitArgs(parsed), context));
      case "logs":
        return resourcePayload("logs", await this.tools.callTool("hcb_log", logArgs(parsed), context));
      case "pending-mutations":
        return resourcePayload("pendingMutations", await this.tools.callTool("hcb_pending_mutations", limitArgs(parsed), context));
      case "task":
      case "tasks":
        return resourcePayload("task", await this.tools.callTool("hcb_get_task", { id: requiredPathId(parsed, "task") }, context));
      case "event":
      case "events":
        return resourcePayload("event", await this.tools.callTool("hcb_get_event", { id: requiredPathId(parsed, "event") }, context));
      case "note":
      case "notes":
        return resourcePayload("note", await this.tools.callTool("hcb_get_note", { id: requiredPathId(parsed, "note") }, context));
      case "mutation":
      case "mutations":
        return resourcePayload("mutation", await this.tools.callTool("hcb_show", {
          kind: "mutation",
          id: requiredPathId(parsed, "mutation")
        }, context));
      default:
        throw new McpToolError("NOT_FOUND", "Unknown HCB MCP resource.");
    }
  }
}

interface ParsedHcbUri {
  host: string;
  pathId?: string;
  searchParams: URLSearchParams;
}

function resource(uri: string, name: string, description: string): McpResourceDefinition {
  return { uri, name, description, mimeType: jsonMimeType };
}

function template(uriTemplate: string, name: string, description: string): McpResourceTemplateDefinition {
  return { uriTemplate, name, description, mimeType: jsonMimeType };
}

function parseHcbUri(uri: string): ParsedHcbUri {
  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    throw new McpToolError("INVALID_ARGUMENTS", "Resource uri must be a valid hcb:// URI.");
  }

  if (parsed.protocol !== "hcb:" || parsed.hostname.length === 0) {
    throw new McpToolError("INVALID_ARGUMENTS", "Resource uri must use the hcb:// scheme.");
  }

  const path = parsed.pathname.replace(/^\/+/, "");

  return {
    host: parsed.hostname,
    ...(path.length === 0 ? {} : { pathId: decodeURIComponent(path) }),
    searchParams: parsed.searchParams
  };
}

function weekArgs(parsed: ParsedHcbUri): JsonObject {
  const startDate = parsed.pathId ?? parsed.searchParams.get("startDate") ?? undefined;
  return startDate === undefined ? {} : { startDate };
}

function limitArgs(parsed: ParsedHcbUri): JsonObject {
  const limit = numberParam(parsed.searchParams.get("limit"));
  return limit === undefined ? {} : { limit };
}

function logArgs(parsed: ParsedHcbUri): JsonObject {
  const args = limitArgs(parsed);
  const level = parsed.searchParams.get("level");

  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    args.level = level;
  }

  return args;
}

function numberParam(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 200) : undefined;
}

function requiredPathId(parsed: ParsedHcbUri, kind: string): string {
  if (!parsed.pathId) {
    throw new McpToolError("INVALID_ARGUMENTS", `Missing ${kind} id in resource uri.`);
  }

  return parsed.pathId;
}

function resourcePayload(kind: string, response: McpToolResponse): { payload: JsonObject } {
  if (response.item) {
    return { payload: response.item };
  }

  if (response.items) {
    return {
      payload: {
        kind,
        items: response.items as JsonValue
      }
    };
  }

  return {
    payload: {
      kind,
      message: response.message
    }
  };
}
