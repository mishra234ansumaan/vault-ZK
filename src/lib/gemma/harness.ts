import { useAppStore } from "@/lib/store";
import { errorMessage } from "@/lib/utils";
import { extractJson, generate } from "@/lib/gemma/engine";
import { callTool, TOOL_MANIFEST, type DocumentParseResult, type ToolName } from "@/lib/gemma/tools";
import type { SignatureValidationResult } from "@/lib/signature";

export interface DocumentAgentResult {
  parse: DocumentParseResult;
  signature: SignatureValidationResult;
  steps: ToolName[];
  guardrailInterventions: number;
}

const DOCUMENT_PLAN: ToolName[] = ["parseDocumentOffline", "validateGovernmentSignature"];

/**
 * VaultZK agent harness.
 * Gemma acts as the planner: each turn it receives the tool manifest and the list of completed
 * tools and must answer with a JSON tool call. The harness validates the choice (schema +
 * allow-list + no repeats), binds the document bytes as arguments, executes the tool locally and
 * logs every call. If the model errs, a deterministic guardrail picks the next required tool.
 */
export async function runDocumentAgent(ctx: { fileName: string; text: string; bytes: Uint8Array }): Promise<DocumentAgentResult> {
  const { pushLog } = useAppStore.getState();
  const done = new Set<ToolName>();
  let parse: DocumentParseResult | null = null;
  let signature: SignatureValidationResult | null = null;
  let guard = 0;

  const toolSpec = TOOL_MANIFEST.filter((t) => DOCUMENT_PLAN.includes(t.name))
    .map((t) => `- ${t.name}(${Object.entries(t.parameters).map(([k, v]) => `${k}: ${v}`).join(", ")}): ${t.description}`)
    .join("\n");

  for (let turn = 0; turn < 4; turn++) {
    const remaining = DOCUMENT_PLAN.filter((t) => !done.has(t));
    if (remaining.length === 0) break;
    let choice: ToolName | null = null;

    const plan = await generate(
      [
        {
          role: "system",
          content: `You are the VaultZK on-device agent. Decide the next tool to call to ingest a document.\nTools:\n${toolSpec}\nReply ONLY with JSON: {"tool": "<toolName>"} or {"tool": "done"}. Arguments are bound automatically.`,
        },
        { role: "user", content: `File: ${ctx.fileName}\nCompleted: [${[...done].join(", ")}]\nPreview: ${ctx.text.slice(0, 160).replace(/\s+/g, " ")}` },
      ],
      { json: true, maxTokens: 40 },
    );
    if (plan) {
      const obj = extractJson(plan.text) as { tool?: string } | null;
      const candidate = obj?.tool as ToolName | undefined;
      pushLog({ level: "inference", message: `Gemma planner chose: ${candidate ?? "(unparseable)"}`, ms: plan.ms });
      if (candidate && remaining.includes(candidate)) choice = candidate;
    }
    if (!choice) {
      choice = remaining[0];
      if (plan) {
        guard++;
        pushLog({ level: "info", message: `Guardrail: planner output rejected → executing required tool ${choice}` });
      }
    }

    try {
      if (choice === "parseDocumentOffline") parse = await callTool("parseDocumentOffline", { rawText: ctx.text });
      else signature = await callTool("validateGovernmentSignature", { docBytes: ctx.bytes });
      done.add(choice);
    } catch (e) {
      pushLog({ level: "error", message: `Agent aborted: ${errorMessage(e)}` });
      throw e;
    }
  }
  if (!parse || !signature) throw new Error("Agent did not complete required tool calls");
  return { parse, signature, steps: [...done], guardrailInterventions: guard };
}
