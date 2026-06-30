export function getStorageGuidance(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    return [
      '  • Increase limit: $env:SC_MAX_STORAGE_GB = "2"',
      '  • Clean manually: Remove-Item "$HOME\\.sc-agent\\old-files" -Recurse -Force',
      '  • Auto-cleanup runs when limit is exceeded',
    ];
  }

  return [
    '  • Increase limit: export SC_MAX_STORAGE_GB=2',
    '  • Clean manually: rm -rf ~/.sc-agent/old-files',
    '  • Auto-cleanup runs when limit is exceeded',
  ];
}
