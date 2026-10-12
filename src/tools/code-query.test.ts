// code_query tool coverage (#545, parent #544): analyzeCode()'s per-language
// parsers (the regex-driven class/method extraction for ts/js/java/py/go/rs),
// the no-classes/no-methods/unsupported shapes, and the execute() permission
// gate. Fixture files are real files under a tmp dir — analyzeCode() takes
// the path verbatim (no resolveSafePath), so absolute fixture paths work.

import { test, describe, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { analyzeCode, codeQueryTool } from './code-query.js';
import { clearSessionPermissions } from '../utils/permissions.js';

let dir: string;
const f = (name: string) => join(dir, name);

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: ['code_query'] },
  };
}

function ctx(): ToolContext {
  return { workspaceRoot: dir, config: makeConfig() };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-codequery-'));
  writeFileSync(f('sample.ts'), [
    'export class Widget {',
    '  public async render(name: string): Promise<string> {',
    '    return name;',
    '  }',
    '  private reset(): void {}',
    '}',
    '',
  ].join('\n'));
  writeFileSync(f('sample.py'), [
    'class Engine:',
    '    def start(self, mode):',
    '        pass',
    '',
    'def helper(x, y):',
    '    return x',
    '',
  ].join('\n'));
  writeFileSync(f('sample.go'), [
    'package main',
    '',
    'type Server struct{}',
    '',
    'func (s *Server) Run(port int) error {',
    '\treturn nil',
    '}',
    '',
  ].join('\n'));
  writeFileSync(f('sample.rs'), [
    'pub struct Config {}',
    '',
    'impl Config {',
    '    pub fn load(&self, path: &str) -> bool {',
    '        true',
    '    }',
    '}',
    '',
  ].join('\n'));
  writeFileSync(f('sample.java'), [
    'public class App {',
    '    public static int add(int a, int b) {',
    '        return a + b;',
    '    }',
    '}',
    '',
  ].join('\n'));
  writeFileSync(f('sample.js'), [
    'class View {',
    '  async show(item) {',
    '    return item;',
    '  }',
    '}',
    '',
  ].join('\n'));
  // A file with top-level defs but no class → the "Functions" branch.
  writeFileSync(f('functions.py'), ['def alpha(x):', '    return x', '', 'def beta():', '    pass', ''].join('\n'));
  // A class with no detectable methods → the "(no methods detected)" branch.
  writeFileSync(f('emptyclass.py'), ['class Empty:', '    pass', ''].join('\n'));
  writeFileSync(f('empty.ts'), '');
  writeFileSync(f('notes.txt'), 'plain text\n');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

describe('analyzeCode', () => {
  test('TypeScript: class extraction reports the class(s) section', async () => {
    const out = await analyzeCode(f('sample.ts'));
    assert.match(out, /sample\.ts \(\d+ lines, \.ts\)/);
    assert.match(out, /Widget/);
    assert.match(out, /1 class\(s\):/);
  });

  test('Python: class with methods and a top-level def', async () => {
    const out = await analyzeCode(f('sample.py'));
    assert.match(out, /Engine/);
    assert.match(out, /start/);
    assert.match(out, /helper/);
  });

  test('Go: struct + method receiver', async () => {
    const out = await analyzeCode(f('sample.go'));
    assert.match(out, /Server/);
    assert.match(out, /Run/);
  });

  test('Rust: struct + impl fn', async () => {
    const out = await analyzeCode(f('sample.rs'));
    assert.match(out, /Config/);
    assert.match(out, /load/);
  });

  test('Java: class + static method', async () => {
    const out = await analyzeCode(f('sample.java'));
    assert.match(out, /App/);
    assert.match(out, /add/);
  });

  test('JavaScript: class method extraction', async () => {
    const out = await analyzeCode(f('sample.js'));
    assert.match(out, /View/);
    assert.match(out, /show/);
  });

  test('a file with functions but no classes uses the Functions section', async () => {
    const out = await analyzeCode(f('functions.py'));
    assert.match(out, /Functions \(2\)/);
    assert.match(out, /alpha/);
    assert.match(out, /beta/);
  });

  test('a class with no detectable methods says so', async () => {
    const out = await analyzeCode(f('emptyclass.py'));
    assert.match(out, /Empty/);
    assert.match(out, /\(no methods detected\)/);
  });

  test('an empty file reports no classes or functions', async () => {
    const out = await analyzeCode(f('empty.ts'));
    assert.match(out, /No classes or functions detected\./);
  });

  test('unsupported extensions are reported with the supported list', async () => {
    const out = await analyzeCode(f('notes.txt'));
    assert.match(out, /Unsupported file type\. Supported: \.ts, \.js, \.java, \.py, \.go, \.rs/);
  });
});

describe('code_query tool gate', () => {
  test('requires path', async () => {
    await assert.rejects(codeQueryTool.execute({}, ctx()), /path is required/);
  });

  test('a denied prompt rejects', async () => {
    const context: ToolContext = {
      workspaceRoot: dir,
      config: { model: { provider: 'openai-compatible', baseUrl: 'http://localhost/v1', model: 't' }, permissions: { autoApprove: [] } },
    };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      codeQueryTool.execute({ path: f('sample.ts') }, context),
      /Permission denied by user/,
    );
  });

  test('approved execution returns the analysis', async () => {
    const out = await codeQueryTool.execute({ path: f('sample.ts') }, ctx());
    assert.match(out, /Widget/);
  });

  test('an unreadable target is wrapped as a failure', async () => {
    await assert.rejects(
      codeQueryTool.execute({ path: f('ghost.ts') }, ctx()),
      /Failed to analyze code/,
    );
  });
});
