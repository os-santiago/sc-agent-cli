export function getModelProfileEmptyStateGuidance(): string[] {
  return [
    'No model profiles available.',
    '  • Run "sc config-init" in another terminal to create the default profiles',
    '  • Or add one with "sc profile add <name>"',
    '  • Then return here and run "/reload"',
  ];
}
