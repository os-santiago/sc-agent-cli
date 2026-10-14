// Unit coverage for the code_query tool (#543). The filesystem read and the
// permission layer are mocked: happy paths assert the analyzer's documented
// output shape per language, the denial test proves the file is never read,
// and error paths cover the tool's argument/read-failure contract.

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ToolContext } from './tool.js';

const mocks = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({ requestPermission: mocks.requestPermission }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs/promises')>();
  return { ...mod, readFile: mocks.readFile };
});

import { codeQueryTool, analyzeCode } from './code-query.js';

function makeCtx(): ToolContext {
  return {
    workspaceRoot: '/ws',
    config: {
      model: { provider: 'openai-compatible', baseUrl: 'http://provider.test/v1', model: 'test-model' },
    },
  };
}

const exec = (args: Record<string, unknown>, ctx: ToolContext = makeCtx()) =>
  codeQueryTool.execute(args, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestPermission.mockResolvedValue(true);
});

describe('code_query — analysis output', () => {
  test('a Python file reports its class and methods', async () => {
    const src = [
      'class Greeter:',
      '    def greet(self, name):',
      '        return f"hi {name}"',
      '',
      '    def helper(self):',
      '        pass',
    ].join('\n');
    mocks.readFile.mockResolvedValue(src);

    const out = await exec({ path: 'greeter.py' });
    assert.match(out, /📄 greeter\.py \(6 lines, \.py\)/);
    assert.match(out, /📋 1 class\(s\):/);
    assert.match(out, /📦 Greeter \(line 1\)/);
    assert.match(out, /• public greet\(self, name\)/);
    assert.match(out, /• public helper\(self\)/);
  });

  test('a JavaScript file reports its class and methods', async () => {
    const src = [
      'class Repo {',
      '  fetch(id) {',
      '    return id;',
      '  }',
      '}',
    ].join('\n');
    mocks.readFile.mockResolvedValue(src);

    const out = await exec({ path: 'repo.js' });
    assert.match(out, /📄 repo\.js \(5 lines, \.js\)/);
    assert.match(out, /📦 Repo \(line 1\)/);
    assert.match(out, /• public fetch\(id\)/);
  });

  test('a TypeScript file enumerates classes and interfaces', async () => {
    const src = [
      'export class UserService {',
      '  public getUser(id: string): string {',
      '    return id;',
      '  }',
      '}',
      '',
      'interface Shape {',
      '  area(): number;',
      '}',
    ].join('\n');
    mocks.readFile.mockResolvedValue(src);

    const out = await exec({ path: 'models.ts' });
    assert.match(out, /📄 models\.ts \(9 lines, \.ts\)/);
    assert.match(out, /📋 2 class\(s\):/);
    assert.match(out, /📦 UserService \(line 1\)/);
    assert.match(out, /📐 Shape \(line 7\)/);
    // getUser is detected as a method bullet under UserService; Shape's
    // signature-only member yields "(no methods detected)".
    assert.match(out, /\n {4}• /);
    assert.match(out, /\(no methods detected\)/);
  });

  test('a Go file reports struct types and methods', async () => {
    const src = [
      'package main',
      '',
      'type Greeter struct {',
      '\tName string',
      '}',
      '',
      'func (g Greeter) Greet(name string) string {',
      '\treturn name',
      '}',
    ].join('\n');
    mocks.readFile.mockResolvedValue(src);

    const out = await exec({ path: 'main.go' });
    assert.match(out, /📄 main\.go \(9 lines, \.go\)/);
    assert.match(out, /🧱 Greeter \(line 3\)/);
    assert.match(out, /• public \(g Greeter\) Greet\(name string\): string/);
  });

  test('bare functions outside a class are listed under Functions', async () => {
    mocks.readFile.mockResolvedValue('def helper():\n    pass');
    const out = await exec({ path: 'utils.py' });
    assert.match(out, /🔧 Functions \(1\):/);
    assert.match(out, /• helper\(\)/);
  });

  test('a file with no symbols reports that explicitly', async () => {
    mocks.readFile.mockResolvedValue('x = 1\ny = 2');
    const out = await exec({ path: 'vars.py' });
    assert.match(out, /No classes or functions detected\./);
  });
});

describe('code_query — argument and error contract', () => {
  test('an unsupported extension returns the documented message without reading the file', async () => {
    const out = await exec({ path: 'README.md' });
    assert.match(out, /Unsupported file type\. Supported: \.ts, \.js, \.java, \.py, \.go, \.rs/);
    assert.equal(mocks.readFile.mock.calls.length, 0);
  });

  test('analyzeCode short-circuits unsupported types before any I/O', async () => {
    const out = await analyzeCode('notes.txt');
    assert.match(out, /Unsupported file type/);
    assert.equal(mocks.readFile.mock.calls.length, 0);
  });

  test('a missing/empty path rejects before the permission layer runs', async () => {
    await assert.rejects(exec({}), /path is required/);
    await assert.rejects(exec({ path: '' }), /path is required/);
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
    assert.equal(mocks.readFile.mock.calls.length, 0);
  });

  test('an unreadable file rejects with the wrapped analyzer error', async () => {
    mocks.readFile.mockRejectedValue(new Error("ENOENT: no such file or directory, open 'gone.py'"));
    await assert.rejects(
      exec({ path: 'gone.py' }),
      /Failed to analyze code: ENOENT/,
    );
  });

  test('a non-string path reaches the analyzer and surfaces its failure', async () => {
    // detectLang → path.extname(123) throws TypeError; execute wraps it.
    await assert.rejects(exec({ path: 123 }), /Failed to analyze code:/);
  });

  test('denied permission rejects and the file is never read', async () => {
    mocks.requestPermission.mockResolvedValue(false);
    await assert.rejects(
      exec({ path: 'secrets.py' }),
      /Permission denied by user/,
    );
    assert.equal(mocks.requestPermission.mock.calls.length, 1);
    assert.equal(mocks.readFile.mock.calls.length, 0);
  });

  test('the tool self-gates as "code_query" with the caller args', async () => {
    mocks.readFile.mockResolvedValue('x = 1');
    const ctx = makeCtx();
    await exec({ path: 'a.py' }, ctx);
    const perm = mocks.requestPermission.mock.calls[0][0];
    assert.equal(perm.toolName, 'code_query');
    assert.deepEqual(perm.args, { path: 'a.py' });
    assert.equal(perm.config, ctx.config);
  });
});
