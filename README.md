# RainDance

**Your AI Skill Trainer.** RainDance takes skill packs — collections of `SKILL.md` files like [claude-code-apple-skills](https://github.com/rshankras/claude-code-apple-skills) — plus your own prompt files, and turns them into **fine-tuning datasets** for ChatGPT (OpenAI) and Claude (Anthropic).

Zero runtime dependencies. One command. Reproducible output.

## Why

Skills are knowledge about *how to do things well* (code generation, ASO, TDD workflows, design rules…). Fine-tuning bakes that knowledge into a model so it shows up without you pasting instructions every session. RainDance converts skill files into clean training examples in the exact JSONL shapes the providers expect.

## Install & build

```bash
npm install          # dev deps only (typescript) — zero runtime deps
npm run build        # emits dist/
npm run typecheck    # strict typecheck
npm test             # unit tests (node --test)
```

Run locally without building:

```bash
npm run raindance -- --help
```

## Usage

### 1. Scan a skills pack

```bash
git clone https://github.com/rshankras/claude-code-apple-skills.git
npm run raindance -- scan ./claude-code-apple-skills/skills
```

RainDance walks the tree, finds every directory with a `SKILL.md`, parses its frontmatter (`name`, `description`, …) and loads reference files shipped next to it.

### 2. (Optional) Add your own prompts

Create a folder of prompt files — one file = one training example:

```
my-prompts/
└── paywall-pricing.md
```

```markdown
---
skills: [paywall-generator]
answer: |
  Use a 3-tier structure: Free, Pro at $4.99/mo, Teams at $12.99/mo.
  Offer a 7-day free trial on Pro only.
---
How should I price my subscription tiers for a fitness app?
```

- `skills:` — which skills to attach (defaults to skills whose names appear in the prompt)
- `answer:` — the ideal assistant response (defaults to the attached skills' instructions)

### 3. Generate the dataset

```bash
npm run raindance -- generate ./claude-code-apple-skills/skills \
  --format openai \
  --per-skill 3 \
  --system-prompt "You are a senior Apple platform engineer." \
  --out ./out/datasets

# With your own prompts, targeting Claude:
npm run raindance -- generate ./skills --prompts ./my-prompts --format anthropic
```

Output in `--out` (default `out/datasets`):

| File | Purpose |
| --- | --- |
| `openai-train.jsonl` / `openai-validation.jsonl` | 90/10 split for OpenAI fine-tuning |
| `anthropic-train.jsonl` / `anthropic-validation.jsonl` | same data in Anthropic Messages shape |
| `manifest.json` | run details: strategies, counts, skills used, timestamps |

### 4. Validate a pack

```bash
npm run raindance -- validate ./skills
```

Reports skills missing `name`/`description` frontmatter or with empty bodies — fix these before generating.

## Formats

| Format | Shape | Use with |
| --- | --- | --- |
| `openai` | `{"messages":[{role,content},…]}` | OpenAI fine-tuning (gpt-4o, gpt-4.1, …) |
| `anthropic` | `{"system":"…","messages":[…]}` | Anthropic Messages API / Claude |
| `universal` | `{"system","messages","meta"}` | Your own pipelines; keeps skill/strategy provenance |

## Synthesis strategies

Each strategy creates a different *kind* of example so the model learns more than one skill of using a skill:

| Strategy | What it teaches |
| --- | --- |
| `teach` | Q&A grounded in the skill's own section headings |
| `apply` | Applying the skill (incl. its reference files) to realistic tasks |
| `quiz` | Reverse Q&A that builds *recall* of skill content |
| `multi` | Conversations composing two skills together |
| `custom` | Your prompt files, verbatim questions with your answers |

Select with `--strategies teach,apply` (default: all).

## Programmatic use

```ts
import { generateDataset, discoverSkills } from "raindance";

const skills = await discoverSkills("./skills");
const result = await generateDataset({
  skillsDir: "./skills",
  format: "openai",
  perSkill: 3,
});
console.log(result.byStrategy);
```

## Tips for good datasets

- **Quality over quantity** — a few hundred well-formed examples outperform thousands of noisy ones. Start with `--per-skill 2`.
- **Write real answers** in prompt files for the behaviors you care most about; synthesized answers are faithful to the skill text but not conversational.
- **Validate first** — `raindance validate` catches packs with missing metadata.
- **Review the manifest** — check `byStrategy` counts and skim a few JSONL lines before uploading.
- OpenAI requires ≥ 10 examples and recommends ≥ 50; a large pack with default settings easily clears that.

## License

MIT
