import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileFromPromptResponse, normalizeProfileName } from './profile.js';

test('normalizeProfileName trims surrounding whitespace', () => {
  assert.equal(normalizeProfileName('  openai  '), 'openai');
});

test('normalizeProfileName rejects blank names', () => {
  assert.equal(normalizeProfileName('   '), undefined);
  assert.equal(normalizeProfileName(undefined), undefined);
});

test('buildProfileFromPromptResponse trims values and omits blank api keys', () => {
  const result = buildProfileFromPromptResponse({
    baseUrl: '  https://api.openai.com/v1  ',
    model: '  gpt-4o  ',
    apiKey: '   ',
  });

  assert.deepEqual(result, {
    profile: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    },
  });
});

test('buildProfileFromPromptResponse requires baseUrl and model', () => {
  assert.deepEqual(
    buildProfileFromPromptResponse({ baseUrl: '   ', model: 'gpt-4o' }),
    { error: 'base URL is required.' }
  );

  assert.deepEqual(
    buildProfileFromPromptResponse({ baseUrl: 'https://api.openai.com/v1', model: '   ' }),
    { error: 'model name is required.' }
  );
});
