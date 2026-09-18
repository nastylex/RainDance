import type { DatasetFormat, Example } from "./types.js";

/**
 * Emit one JSONL line for an example in the requested format.
 *
 * - openai:    {"messages":[{"role","content"},...]}  — Chat Completions fine-tune schema
 * - anthropic: {"system":"...", "messages":[user/assistant messages]} — Messages API shape
 * - universal: {"system":"...", "messages":[...], "meta":{skills,strategy}}
 */
export function encodeExample(example: Example, format: DatasetFormat): string {
  if (format === "openai") {
    return JSON.stringify({
      messages: example.messages.map((m) => ({ role: m.role, content: m.content })),
    });
  }
  const systemMsg = example.messages.find((m) => m.role === "system");
  const turns = example.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  if (format === "anthropic") {
    return JSON.stringify({ system: systemMsg?.content ?? "", messages: turns });
  }
  // universal
  return JSON.stringify({
    system: systemMsg?.content ?? "",
    messages: turns,
    meta: { skills: example.sourceSkills, strategy: example.strategy },
  });
}

export function fileExtensionFor(format: DatasetFormat): string {
  return "jsonl";
}

export function fileNameFor(format: DatasetFormat, split: "train" | "validation"): string {
  return `${format}-${split}.jsonl`;
}
