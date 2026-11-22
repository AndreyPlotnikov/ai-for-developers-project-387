import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = await readFile('.github/workflows/opencode.yml', 'utf8');
const match = workflow.match(/name: Enforce PR budget before every agent attempt[\s\S]*?script: \|\n((?: {12}.+\n|\n)+)/);
assert.ok(match, 'budget script is present in workflow');
const source = match[1].replace(/^ {12}/gm, '');
const execute = new Function('context', 'github', 'core', `return (async () => { ${source} })()`);

async function evaluate(runs) {
  const outputs = {};
  const context = { payload: { pull_request: { number: 42 } }, repo: {}, runId: 99 };
  const github = { rest: { actions: { listWorkflowRuns: {} } }, paginate: async () => runs };
  await execute(context, github, { setOutput: (key, value) => { outputs[key] = value; }, info: () => {} });
  return outputs.reason;
}

const run = (id, run_attempt, title = 'pr-budget-42') => ({ id, run_attempt, display_title: title });
test('allows three attempts including cancelled and repeated runs', async () => {
  assert.equal(await evaluate([run(1, 2), run(99, 1)]), 'ok');
});
test('blocks a fourth attempt including reruns', async () => {
  assert.equal(await evaluate([run(1, 2), run(2, 1), run(99, 1)]), 'limit_exhausted');
});
test('does not charge another PR', async () => {
  assert.equal(await evaluate([run(1, 5, 'pr-budget-43'), run(99, 1)]), 'ok');
});
test('fails closed if current run is missing', async () => {
  await assert.rejects(evaluate([run(1, 1)]), /missing from budget ledger/);
});
