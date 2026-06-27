// Self-contained shape test for the decomposer agent
// No test framework needed — throws on assertion failure, exits 0 on pass
// ponytail: assert() is Node stdlib, no vitest/jest required for this smoke check
//
// Run: npx tsx backend/src/routes/decompose.test.ts
// (requires ANTHROPIC_API_KEY in env — set in .env.local or CI secrets)

import { decompose, type DecomposedPlan } from "../../../agents/decomposer.js";

const VALID_AGENTS = new Set([
  "LEGAL", "DISCOVERY", "FINANCE", "BUILD", "QA",
  "RESEARCH", "COMMS", "MEMORY", "MONITOR", "SCHEDULER", "EXECUTE",
]);

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function validatePlan(plan: DecomposedPlan, goal: string): void {
  assert(typeof plan.title === "string" && plan.title.length > 0, "plan.title must be non-empty string");
  assert(typeof plan.domain === "string" && plan.domain.length > 0, "plan.domain must be non-empty string");
  assert(Array.isArray(plan.tasks) && plan.tasks.length > 0, "plan.tasks must be non-empty array");

  for (const [i, t] of plan.tasks.entries()) {
    assert(typeof t.title === "string" && t.title.length > 0, `task[${i}].title must be non-empty`);
    assert(VALID_AGENTS.has(t.agent), `task[${i}].agent "${t.agent}" must be one of valid agents`);
    assert(typeof t.priority === "number" && t.priority >= 1 && t.priority <= 10, `task[${i}].priority must be 1-10`);
    assert(typeof t.payload?.instruction === "string", `task[${i}].payload.instruction must be string`);
    assert(Array.isArray(t.depends_on_indices), `task[${i}].depends_on_indices must be array`);
    for (const dep of t.depends_on_indices) {
      assert(typeof dep === "number" && dep >= 0 && dep < plan.tasks.length, `task[${i}] depends_on_indices[${dep}] out of range`);
      assert(dep !== i, `task[${i}] cannot depend on itself`);
    }
  }
  console.log(`✓ Plan "${plan.title}" | domain: ${plan.domain} | tasks: ${plan.tasks.length}`);
  plan.tasks.forEach((t, i) =>
    console.log(`  [${i}] ${t.agent.padEnd(12)} p${t.priority} "${t.title}" → deps: [${t.depends_on_indices.join(",")}]`)
  );
}

const GOAL = "Prepare the Five9 evidence record for trial";

console.log(`\nDecomposer test — goal: "${GOAL}"\n`);

try {
  const plan = await decompose(GOAL);
  validatePlan(plan, GOAL);
  console.log("\nALL ASSERTIONS PASSED");
  process.exit(0);
} catch (err) {
  console.error("\nTEST FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
