export { discoverSkills, parseFrontmatter } from "./skills.js";
export { generateDataset } from "./generate.js";
export { loadPrompts } from "./prompts.js";
export { encodeExample } from "./formats.js";
export { teach, apply, quiz, multi } from "./synthesize.js";
export type {
  Skill,
  Example,
  Message,
  DatasetFormat,
  GenerateOptions,
  GenerateResult,
} from "./types.js";
