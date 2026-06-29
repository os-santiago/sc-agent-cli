import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import { editFileTool } from './edit-file.js';

test('editFileTool explains how to recover when a patch no longer matches file content', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-edit-file-test-'));
  const filePath = 'notes.txt';
  const config: ProjectConfig = {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      model: 'example-model',
    },
  };

  try {
    await writeFile(path.join(workspaceRoot, filePath), 'hello\n', 'utf-8');

    await assert.rejects(
      () =>
        editFileTool.execute(
          {
            path: filePath,
            patch: '@@ -1 +1 @@\n-bye\n+hi\n',
          },
          {
            workspaceRoot,
            config,
            autoApprove: true,
          }
        ),
      /Failed to apply patch to "notes\.txt" because the file content did not match the patch context\. Re-read the file and generate a unified diff patch against the current content before retrying\./
    );

    const content = await readFile(path.join(workspaceRoot, filePath), 'utf-8');
    assert.equal(content, 'hello\n');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
