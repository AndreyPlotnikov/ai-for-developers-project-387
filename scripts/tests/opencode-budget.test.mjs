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

test('authorizes commands only for trusted users and non-fork PRs', async () => {
  const authorization = workflow.match(/name: Check command and repository permission[\s\S]*?script: \|\n((?: {12}.+\n|\n)+)/);
  assert.ok(authorization, 'authorization script is present in workflow');
  const script = authorization[1].replace(/^ {12}/gm, '');
  const runAuthorization = new Function('context', 'github', 'core', `return (async () => { ${script} })()`);
  async function authorize({ body = '/oc explain', permission = 'write', head, event = 'issue' } = {}) {
    const outputs = {};
    const payload = { comment: { body } };
    if (head !== undefined) {
      if (event === 'review') payload.pull_request = { number: 42 };
      else payload.issue = { number: 42, pull_request: {} };
    } else payload.issue = { number: 42 };
    const context = { payload, repo: { owner: 'owner', repo: 'repo' } };
    const github = { rest: {
      pulls: { get: async () => ({ data: { head: { repo: head === null ? null : { full_name: head } } } }) },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) },
    } };
    context.payload.comment.user = { login: 'user' };
    await runAuthorization(context, github, { setOutput: (key, value) => { outputs[key] = value; } });
    return outputs.allowed;
  }
  assert.equal(await authorize(), true);
  assert.equal(await authorize({ permission: 'read' }), false);
  assert.equal(await authorize({ body: 'text /oc explain' }), 'false');
  assert.equal(await authorize({ head: 'owner/repo' }), true);
  assert.equal(await authorize({ head: 'fork/repo' }), 'false');
  assert.equal(await authorize({ head: null, event: 'review' }), 'false');
});
