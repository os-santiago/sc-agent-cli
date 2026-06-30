import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileAnswers } from './profile.js';

test('validateProfileAnswers treats fully cancelled profile prompts as a clean cancel', () => {
  assert.equal(
    validateProfileAnswers({}),
    'Profile creation cancelled'
  );
});

test('validateProfileAnswers requires a base URL before saving a profile', () => {
  assert.equal(
    validateProfileAnswers({ baseUrl: '   ', model: 'llama3.2' }),
    'Base URL is required'
  );
});

test('validateProfileAnswers requires a model name before saving a profile', () => {
  assert.equal(
    validateProfileAnswers({ baseUrl: 'http://localhost:11434/v1', model: '   ' }),
    'Model name is required'
  );
});

test('validateProfileAnswers accepts complete profile answers', () => {
  assert.equal(
    validateProfileAnswers({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      apiKey: '',
    }),
    null
  );
});
