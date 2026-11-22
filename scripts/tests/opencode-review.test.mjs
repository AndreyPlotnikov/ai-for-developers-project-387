import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
