export const tools = [
  {
    name: "studio_send_message",
    description:
      "Send a request/reply or passive notification to the other lead. Your sender identity is derived from this tool call. Never claim producer authorization. Return promptly; do not wait for the other lead.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", enum: ["planner", "developer"] },
        content: { type: "string" },
        kind: { type: "string", enum: ["request", "reply", "notification"] },
        replyTo: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["recipient", "content", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_task",
    description:
      "Register or update a deliverable task within the producer-authorized project scope. Completion requires evidence; acceptance policies cannot be weakened.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update"] },
        id: { type: "string" },
        title: { type: "string" },
        objective: { type: "string" },
        parentTaskId: { type: "string", description: "Existing parent task ID for a new work package. Organizational relationship only; does not grant permissions." },
        status: {
          type: "string",
          enum: [
            "pending",
            "running",
            "blocked",
            "awaiting_acceptance",
            "completed",
          ],
        },
        evidence: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_read_project_file",
    description:
      "Read a small text file only from the operator-configured project. No arbitrary paths, writes or shell execution. The Studio verifies caller identity.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path inside the explicitly configured project (e.g. README.md)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "studio_request_decision",
    description:
      "Ask the producer about a major product/architecture decision, preserving facts/options and the affected task. A peer reply is never producer approval.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        audience: {type:"string",enum:["producer","technical"],description:"Producer for product decisions, explicit acceptance, new permissions or major risks; technical for bounded engineering assistance. Classification grants no new authority."},
        facts: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        taskId: { type: "string" },
      },
      required: ["question", "facts", "options"],
      additionalProperties: false,
    },
  },
].map((t) => ({ ...t, type: "function", deferLoading: false }));
export const leadInstructionVersion="2026-10-24-decision-routing";
export {leadRule as leadInstructions} from "../rules.js";
