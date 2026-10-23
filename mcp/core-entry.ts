/* Entry point for the local MCP server's bundled core. Everything here is the
   same code the browser uses to validate, repair and prompt a quiz. */
export { validateQuiz } from "../src/core/validator";
export { repairQuiz } from "../src/core/repair";
export {
  buildPrompt,
  defaultFields,
  QUIZ_SCHEMA_REF,
  QUIZ_HARD_RULES,
} from "../src/core/prompts";
