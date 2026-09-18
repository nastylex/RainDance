import { promises as fs } from "node:fs";
import path from "node:path";

import { encodeExample, fileNameFor } from "./formats.js";
import { loadPrompts } from "./prompts.js";
import { discoverSkills } from "./skills.js";
import { STRATEGIES } from "./synthesize.js";
import type { Example, GenerateOptions, GenerateResult, Skill } from "./types.js";

const ALL_STRATEGY_IDS = ["teach", "apply", "quiz", "multi"];

/** Deterministic PRNG so shuffles/splits are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dedupe(examples: Example[]): Example[] {
  const seen = new Set<string>();
  const out: Example[] = [];
  for (const ex of examples) {
    const key = ex.messages.map((m) => `${m.role}:${m.content}`).join("\u241F");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ex);
  }
  return out;
}

/** The `multi` strategy: conversations that compose two related skills. */
function synthesizeMulti(
  skills: Skill[],
  opts: { perSkill: number; systemPrompt?: string }
): Example[] {
  const out: Example[] = [];
  for (let i = 0; i + 1 < skills.length; i += 2) {
    const [a, b] = [skills[i], skills[i + 1]];
    const system =
      (opts.systemPrompt ? opts.systemPrompt.trim() + "\n\n" : "") +
      `You are trained on the "${a.name}" and "${b.name}" skills.\n\n` +
      `## Skill: ${a.name}\n${a.description}\n\n${a.body.trim()}\n\n` +
      `## Skill: ${b.name}\n${b.description}\n\n${b.body.trim()}`;
    out.push({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `I need help that spans both the "${a.name}" and "${b.name}" skills. Combine them sensibly and lay out a plan.`,
        },
        {
          role: "assistant",
          content: `Working across both skills:\n\n### ${a.name}\n${a.body.trim().slice(0, 4000)}\n\n### ${b.name}\n${b.body.trim().slice(0, 4000)}`,
        },
      ],
      sourceSkills: [a.name, b.name],
      strategy: "multi",
    });
    if (out.length >= Math.max(1, opts.perSkill)) break;
  }
  return out;
}

/**
 * Generate a fine-tuning dataset from a skills pack plus optional user
 * prompt files. Writes train/validation JSONL in the requested format and
 * a manifest.json describing the run.
 */
export async function generateDataset(options: GenerateOptions): Promise<GenerateResult> {
  const {
    skillsDir,
    promptsDir,
    outDir = "out/datasets",
    format = "openai",
    strategies = ALL_STRATEGY_IDS,
    perSkill = 2,
    systemPrompt,
    shuffle = true,
  } = options;

  const skills = await discoverSkills(skillsDir);
  if (skills.length === 0) {
    throw new Error(`No skills found under "${skillsDir}" (looked for SKILL.md files).`);
  }

  const customExamples = promptsDir ? await loadPrompts(promptsDir, skills, systemPrompt) : [];
  if (promptsDir && customExamples.length === 0) {
    console.warn(`Warning: no usable prompt files found in "${promptsDir}".`);
  }

  const wanted = new Set(
    strategies.length ? strategies : ALL_STRATEGY_IDS
  );
  const byStrategy: Record<string, number> = {};
  let examples: Example[] = [...customExamples];
  for (const ex of customExamples) {
    byStrategy[ex.strategy] = (byStrategy[ex.strategy] ?? 0) + 1;
  }

  for (const id of ALL_STRATEGY_IDS) {
    if (!wanted.has(id)) continue;
    const strat = STRATEGIES[id];
    let produced: Example[];
    if (id === "multi") {
      produced = synthesizeMulti(skills, { perSkill, systemPrompt });
    } else {
      produced = skills.flatMap((s) =>
        strat.run(s, { perSkill, systemPrompt })
      );
    }
    byStrategy[id] = (byStrategy[id] ?? 0) + produced.length;
    examples.push(...produced);
  }

  examples = dedupe(examples);

  // Deterministic shuffle + 90/10 split.
  const rand = mulberry32(0x5eed);
  if (shuffle) {
    for (let i = examples.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [examples[i], examples[j]] = [examples[j], examples[i]];
    }
  }
  const valCount = examples.length >= 20 ? Math.floor(examples.length * 0.1) : 0;
  const train = examples.slice(valCount);
  const validation = examples.slice(0, valCount);

  await fs.mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const writeSplit = async (split: "train" | "validation", data: Example[]) => {
    if (data.length === 0) return;
    const file = path.join(outDir, fileNameFor(format, split));
    await fs.writeFile(
      file,
      data.map((ex) => encodeExample(ex, format)).join("\n") + "\n",
      "utf8"
    );
    written.push(`${file} (${data.length} examples)`);
  };
  await writeSplit("train", train);
  await writeSplit("validation", validation);

  const manifest = {
    tool: "raindance",
    format,
    skillsDir,
    promptsDir: promptsDir ?? null,
    strategies: [...wanted],
    perSkill,
    totalExamples: examples.length,
    trainExamples: train.length,
    validationExamples: validation.length,
    byStrategy,
    skillsUsed: skills.map((s) => s.name),
    generatedAt: new Date().toISOString(),
    files: written,
  };
  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return {
    file: manifestPath,
    format,
    examples: examples.length,
    skillsUsed: manifest.skillsUsed,
    strategiesRun: manifest.strategies,
    byStrategy,
  };
}
