import type { Example, Message, Skill } from "./types.js";

export interface Strategy {
  id: string;
  description: string;
  run(skill: Skill, opts: { perSkill: number; systemPrompt?: string }): Example[];
}

/** Build a system message for one skill: role + description + full instructions. */
function skillSystemPrompt(skill: Skill, base?: string): string {
  const parts: string[] = [];
  if (base) parts.push(base.trim());
  parts.push(
    `You are trained on the "${skill.name}" skill.\n\nSkill description: ${
      skill.description || "(none)"
    }\n\n## Skill instructions\n\n${skill.body.trim()}`
  );
  for (const [rel, content] of Object.entries(skill.files)) {
    parts.push(`\n## Reference file: ${rel}\n\n${content.trim()}`);
  }
  return parts.join("\n\n");
}

/** Cut a string down to roughly maxChars without breaking in the middle of a word. */
function clip(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** Extract markdown headings (## / ###) as candidate task topics. */
function headings(body: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** Build a user message that asks the model to apply the skill to a scenario. */
function scenarioUser(skill: Skill, scenario: string): string {
  return `Use the "${skill.name}" skill to help with the following:\n\n${scenario}`;
}

const EXAMPLE_TASK_PREFIXES = [
  "Help me apply this to my project",
  "Walk me through the recommended approach step by step",
  "What should I watch out for here?",
  "Draft the key pieces for me",
];

/**
 * Strategy: teach — question/answer pairs derived from the skill's own
 * section headings. The assistant answers by faithfully summarizing what
 * that section of the skill says, grounding the model in the material.
 */
export const teach: Strategy = {
  id: "teach",
  description: "Q&A pairs per skill section (grounded in the skill's own headings)",
  run(skill, { perSkill, systemPrompt }) {
    const sys = skillSystemPrompt(skill, systemPrompt);
    const hs = headings(skill.body).filter((h) => h.text.length > 3).slice(0, Math.max(1, perSkill));
    const examples: Example[] = [];
    for (const h of hs) {
      const messages: Message[] = [
        { role: "system", content: sys },
        {
          role: "user",
          content: `In the context of the "${skill.name}" skill, what does it say about "${h.text}"?`,
        },
        {
          role: "assistant",
          content: clip(
            `Per the "${skill.name}" skill, regarding ${h.text}:\n\n${skill.body.trim()}`,
            8000
          ),
        },
      ];
      examples.push({ messages, sourceSkills: [skill.name], strategy: "teach" });
    }
    return examples;
  },
};

/**
 * Strategy: apply — scenario prompts. Each reference file (or the skill body
 * itself when there are no reference files) becomes the "knowledge" the
 * assistant must apply to a realistic task.
 */
export const apply: Strategy = {
  id: "apply",
  description: "Scenario prompts where the assistant must apply the skill",
  run(skill, { perSkill, systemPrompt }) {
    const sys = skillSystemPrompt(skill, systemPrompt);
    const examples: Example[] = [];
    const sources: { label: string; content: string }[] = Object.entries(skill.files).map(
      ([rel, content]) => ({ label: rel, content })
    );
    if (sources.length === 0) {
      sources.push({ label: "skill body", content: skill.body });
    }
    for (let i = 0; i < Math.min(Math.max(1, perSkill), sources.length); i++) {
      const src = sources[i];
      const prefix = EXAMPLE_TASK_PREFIXES[i % EXAMPLE_TASK_PREFIXES.length];
      const messages: Message[] = [
        { role: "system", content: sys },
        {
          role: "user",
          content: scenarioUser(
            skill,
            `I'm working with ${src.label}. ${prefix}, based on the skill instructions.`
          ),
        },
        {
          role: "assistant",
          content: clip(
            `Here's how to apply the "${skill.name}" skill to ${src.label}:\n\n${src.content.trim()}`,
            8000
          ),
        },
      ];
      examples.push({ messages, sourceSkills: [skill.name], strategy: "apply" });
    }
    return examples;
  },
};

/**
 * Strategy: quiz — reverse direction. The user quizzes the model on the
 * skill's content; the assistant must answer accurately, demonstrating
 * recall of the material rather than free generation.
 */
export const quiz: Strategy = {
  id: "quiz",
  description: "Reverse Q&A: quiz the model on skill content to build recall",
  run(skill, { perSkill, systemPrompt }) {
    const sys = skillSystemPrompt(skill, systemPrompt);
    const hs = headings(skill.body)
      .filter((h) => h.level === 2 && h.text.length > 3)
      .slice(0, Math.max(1, perSkill));
    const topics = hs.length ? hs.map((h) => h.text) : [skill.name];
    const examples: Example[] = [];
    for (const topic of topics) {
      const messages: Message[] = [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Quiz check: without looking anything up, summarize what the "${skill.name}" skill covers regarding "${topic}". Be precise; if unsure, say so.`,
        },
        {
          role: "assistant",
          content: clip(
            `The "${skill.name}" skill covers ${topic} as follows:\n\n${skill.body.trim()}`,
            6000
          ),
        },
      ];
      examples.push({ messages, sourceSkills: [skill.name], strategy: "quiz" });
    }
    return examples;
  },
};

/**
 * Strategy: multi — compose several skills into one conversation. Picks
 * consecutive pairs of skills so the model learns to blend related skills
 * in a single session.
 */
export const multi: Strategy = {
  id: "multi",
  description: "Compose multiple skills into one conversation",
  run(_skill, { perSkill, systemPrompt }) {
    // Filled in by synthesizeSkills, which sees the whole pack; per-skill call is a no-op.
    void perSkill;
    void systemPrompt;
    return [];
  }
};

export const STRATEGIES: Record<string, Strategy> = { teach, apply, quiz, multi };
