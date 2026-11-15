// Isolate potentially blocking diff input in a child process. Vitest's own
// timer cannot interrupt a synchronous loop inside the diff library.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT } from './helpers/run-cli.js';

test.each([
  ['empty EOF replacement', '@@ -1 +1 @@\n-alpha\n+\n\\ No newline at end of file\n'],
  ['overlapping EOF hunks', '@@ -1 +1 @@\n-alpha\n+beta\n\\ No newline at end of file\n@@ -1 +0,0 @@\n-alpha\n'],
  ['enormous anchor', '@@ -1000000000 +1 @@\n-alpha\n+beta\n'],
])('built edit_file rejects %s within a process deadline', async (_name, patch) => {
  const script = `
    import { editFileTool } from './dist/tools/edit-file.js';
    import assert from 'node:assert/strict';
    import { mkdtempSync, writeFileSync, readFileSync, statSync, utimesSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'scc-eof-bounds-'));
    const target = join(workspaceRoot, 'f.txt');
    try {
      writeFileSync(target, 'alpha\\n');
      utimesSync(target, new Date('2000-01-01'), new Date('2000-01-01'));
      const before = statSync(target, { bigint: true }).mtimeNs;
      const patch = process.argv[1];
      await assert.rejects(editFileTool.execute({path: 'f.txt', patch}, {
        workspaceRoot, autoApprove: true,
        config: {model: {provider: 'openai-compatible', baseUrl: 'http://provider.test/v1', model: 'fixture'}}
      }), /invalid unified diff format|Patch does not match file content/);
      assert.equal(readFileSync(target, 'utf8'), 'alpha\\n');
      assert.equal(statSync(target, { bigint: true }).mtimeNs, before);
      console.log('rejected without writing');
    } finally { rmSync(workspaceRoot, {recursive: true, force: true}); }
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, patch], {
    cwd: REPO_ROOT, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 16384,
  });
  assert.match(result.stdout, /rejected without writing/);
});
