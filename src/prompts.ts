import { promises as fs } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./skills.js";
import type { Example, Message, Skill } from "./types.js";

/**
 * Prompt file format (markdown or plain text):
 *
 *   ---
 *   skills: [skill-a, skill-b]   # optional; default = skills named in the prompt
 *   answer: |                    # optional; default = synthesized from the skills
 *     The assistant's ideal response...
 *   ---
 *   The user prompt / task goes here.
 *
 * One file = one training example.
 */
export async function loadPrompts(
  promptsDir: string,
  skills: Skill[],
  baseSystemPrompt?: string
): Promise<Example[]> {
  let entries;
  try {
    entries = await fs.readdir(promptsDir, { withFileTypes: true });
  } catch {
    throw new Error(`Prompts directory "${promptsDir}" is not readable.`);
  }
  const files = entries
    .filter((e) => e.isFile() && /\.(md|markdown|txt)$/i.test(e.name))
    .map((e) => path.join(promptsDir, e.name))
    .sort();
  const examples: Example[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const { data, body } = parseFrontmatter(raw);
    const question = body.trim();
    if (!question) continue;

    const named = Array.isArray(data.skills)
      ? data.skills.filter((s): s is string => typeof s === "string")
      : [];
    const attached = named.length
      ? skills.filter((s) => named.includes(s.name))
      : matchSkillsInText(question, skills);
    if (attached.length === 0) {
      console.warn(
        `Warning: prompt "${path.basename(file)}" matched no skills; skipping. ` +
          `Name a skill or set "skills:" in frontmatter.`
      );
      continue;
    }

    let answer: string;
    if (typeof data.answer === "string" && data.answer.trim()) {
      answer = data.answer.trim();
    } else {
      answer = attached
        .map((s) => `### Skill: ${s.name}\n${(s.description ? s.description + "\n\n" : "") + s.body.trim()}`)
        .join("\n\n");
    }
    const sys =
      (baseSystemPrompt ? baseSystemPrompt.trim() + "\n\n" : "") +
      `You are trained on the following skills: ${attached.map((s) => s.name).join(", ")}.\n\n` +
      attached
        .map(
          (s) =>
            `## Skill instructions: ${s.name}\n${s.body.trim()}\n` +
            Object.entries(s.files)
              .map(([rel, content]) => `\n## Reference file (${s.name}): ${rel}\n${content.trim()}`)
              .join("\n")
        )
        .join("\n\n");
    const messages: Message[] = [
      { role: "system", content: sys },
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];
    examples.push({
      messages,
      sourceSkills: attached.map((s) => s.name),
      strategy: "custom",
    });
  }
  return examples;
}

/** Attach skills whose names (or slugified names) appear in the prompt text. */
function matchSkillsInText(text: string, skills: Skill[]): Skill[] {
  const lower = text.toLowerCase();
  const hits = skills.filter((s) => lower.includes(s.name.toLowerCase()));
  return hits.length ? hits : skills.slice(0, 3); // fallback: first 3 skills
}
