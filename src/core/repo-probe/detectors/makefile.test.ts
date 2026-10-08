import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectMakefile } from './makefile.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sc-probe-mk-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  dirs.push(root);
  return root;
}

test('no makefile → not detected', () => {
  const res = detectMakefile(repo({ 'README.md': 'x' }));
  assert.equal(res.detected, false);
  assert.deepEqual(res.targets, {});
});

test('standard targets map to make commands', () => {
  const root = repo({
    'Makefile': [
      'install: build',
      '\tcp bin/app /usr/local/bin/',
      'build:',
      '\tgo build ./...',
      'test:',
      '\tgo test ./...',
      'lint:',
      '\tgolangci-lint run',
      'verify:',
      '\tmake test && make lint',
      'clean:',
      '\trm -rf dist',
      '',
    ].join('\n'),
  });
  const res = detectMakefile(root);

  assert.equal(res.detected, true);
  assert.ok(res.manifests.includes('Makefile'));
  assert.equal(res.commands.install, 'make install');
  assert.equal(res.commands.build, 'make build');
  assert.equal(res.commands.test, 'make test');
  assert.equal(res.commands.lint, 'make lint');
  assert.equal(res.commands.verify, 'make verify');
  assert.equal(res.commands.clean, 'make clean');
  assert.deepEqual(res.targets.test, ['go test ./...']);
});

test('fallback target names: all → build, tests/check → test, ci → verify', () => {
  const root = repo({
    'Makefile': ['all:', '\techo all', 'tests:', '\techo tests', 'check:', '\techo check', 'ci:', '\techo ci', ''].join('\n'),
  });
  const res = detectMakefile(root);
  assert.equal(res.commands.build, 'make all');
  // 'tests' wins the test fallback before 'check'
  assert.equal(res.commands.test, 'make tests');
  assert.equal(res.commands.verify, 'make ci');
});

test('check target alone maps to test command', () => {
  const root = repo({ 'Makefile': 'check:\n\techo check\n' });
  assert.equal(detectMakefile(root).commands.test, 'make check');
});

test('lowercase makefile and GNUmakefile names are found', () => {
  for (const name of ['makefile', 'GNUmakefile']) {
    const root = repo({ [name]: 'build:\n\techo hi\n' });
    const res = detectMakefile(root);
    assert.equal(res.detected, true, name);
    assert.ok(res.manifests.includes(name));
    assert.equal(res.commands.build, 'make build');
  }
});

test('Makefile precedence order: Makefile before makefile before GNUmakefile', () => {
  const root = repo({
    'Makefile': 'a:\n\techo a\n',
    'makefile': 'b:\n\techo b\n',
    'GNUmakefile': 'c:\n\techo c\n',
  });
  const res = detectMakefile(root);
  assert.deepEqual(res.manifests, ['Makefile']);
  assert.deepEqual(Object.keys(res.targets), ['a']);
});

test('empty/unparseable makefile still reports detected', () => {
  const root = repo({ 'Makefile': '# only comments\n\n\n' });
  const res = detectMakefile(root);
  assert.equal(res.detected, true);
  assert.deepEqual(res.targets, {});
  assert.deepEqual(res.commands, {});
});
