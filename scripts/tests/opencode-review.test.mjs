import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('workflows register their intended LiteLLM models without embedding a key', () => {
  const model = 'gpt-6-luna';
  for (const path of ['.github/workflows/opencode.yml', '.github/workflows/opencode-triage.yml']) {
    const workflow = readFileSync(path, 'utf8');
    const match = workflow.match(/OPENCODE_CONFIG_CONTENT: >-\n\s+(\{[^\n]+\})/);
    assert.ok(match, `${path} has an inline V1 provider configuration`);
    const config = JSON.parse(match[1]);
    assert.equal(config.provider.litellm_ott.options.baseURL, 'https://litellm.twiket.com/v1');
    assert.equal(config.provider.litellm_ott.options.apiKey, '{env:LITELLM_API_KEY}');
    assert.equal(config.provider.litellm_ott.models[model].tool_call, true);
    assert.match(workflow, /MODEL: litellm_ott\/gpt-6-luna/);
    const agentStep = workflow.split('- name: Run OpenCode')[1];
    assert.ok(agentStep, `${path} has an agent step`);
    assert.match(agentStep.split(/\n {6}- /)[0], /LITELLM_API_KEY: \$\{\{ secrets\.LITELLM_API_KEY \}\}/);
  }
  const workflow = readFileSync('.github/workflows/opencode-review.yml', 'utf8');
  const configText = workflow.split('cat > "$RUNNER_TEMP/review/sandbox/opencode.json" <<\'JSON\'\n')[1]
    .split('\n          JSON')[0].split('\n').map((line) => line.slice(10)).join('\n');
  const provider = JSON.parse(configText).providers.litellm_ott;
  assert.equal(provider.settings.baseURL, 'https://litellm.twiket.com/v1');
  assert.deepEqual(provider.env, ['LITELLM_API_KEY']);
  assert.equal(provider.models['gpt-6.1-terra'].capabilities.tools, true);
  assert.match(workflow, /launcher\.py litellm_ott\/gpt-6\.1-terra/);
});

test('review snapshot contains only regular blobs from the requested commit', () => {
  const temp = mkdtempSync(join(tmpdir(), 'review-snapshot-'));
  try {
    const repo = join(temp, 'review-head');
    mkdirSync(repo);
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'review-test@example.invalid');
    git('config', 'user.name', 'Review test');
    writeFileSync(join(repo, 'file.txt'), 'first version');
    symlinkSync('/etc/passwd', join(repo, 'link'));
    git('add', '.');
    git('commit', '-qm', 'first');
    const head = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'file.txt'), 'later version');
    git('add', '.');
    git('commit', '-qm', 'second');
    const workflow = readFileSync('.github/workflows/opencode-review.yml', 'utf8');
    const section = workflow.split('Materialize only regular Git blobs')[1];
    const script = section.split("          python3 - <<'PY'\n")[1].split('\n          PY')[0]
      .split('\n').map((line) => line.slice(10)).join('\n');
    mkdirSync(join(temp, 'review/sandbox/source'), { recursive: true });
    execFileSync('python3', ['-c', script], { cwd: temp, env: { ...process.env, RUNNER_TEMP: temp, HEAD_SHA: head } });
    assert.equal(readFileSync(join(temp, 'review/sandbox/source/file.txt'), 'utf8'), 'first version');
    assert.throws(() => readFileSync(join(temp, 'review/sandbox/source/link')));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
