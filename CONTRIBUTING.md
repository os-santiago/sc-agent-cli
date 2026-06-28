# Contributing to SC-Agent CLI

Thanks for your interest in contributing! This is a personal project, but contributions are welcome.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/sc-cli`
3. Install dependencies: `npm install`
4. Build the project: `npm run build`

## Development Workflow

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Test locally: `npm run build && node bin/sc.js`
4. Commit with clear messages: `git commit -m "feat: add new feature"`
5. Push and create a PR

## Code Style

- Use TypeScript strict mode
- Follow the existing code style (consistent indentation, naming, etc.)
- Add type annotations where helpful for clarity
- Handle errors gracefully with meaningful messages

## Testing

Currently, testing is manual. To test your changes:

1. Build the project: `npm run build`
2. Run different scenarios:
   ```bash
   sc chat
   # Try various commands: file operations, search, shell execution
   ```

## Adding Features

### Adding a New Tool

1. Create a new file in `src/tools/`, e.g., `my-tool.ts`
2. Implement the `Tool` interface:
   ```typescript
   import type { Tool, ToolContext } from './tool.js';

   export const myTool: Tool = {
     definition: {
       type: 'function',
       function: {
         name: 'my_tool',
         description: 'Description of what it does',
         parameters: {
           type: 'object',
           properties: {
             arg1: { type: 'string', description: '...' },
           },
           required: ['arg1'],
         },
       },
     },
     async execute(args, ctx) {
       // Implementation
       return 'result';
     },
   };
   ```
3. Add to `src/tools/registry.ts`
4. Test thoroughly

### Adding a New Command

1. Create `src/commands/my-command.ts`
2. Implement your command logic
3. Register it in `src/cli.ts`:
   ```typescript
   program
     .command('my-command')
     .description('...')
     .action(async () => {
       await myCommand();
     });
   ```

### Adding Support for a New Provider Type

The current design supports any OpenAI-compatible API, but if you want to add a provider with a different API structure (e.g., native Anthropic Messages API), you would:

1. Create a new provider class in `src/core/`, e.g., `anthropic-provider.ts`
2. Implement the same interface as `OpenAICompatibleProvider`
3. Update `src/core/types.ts` to include the new provider type
4. Update `src/core/agent.ts` to instantiate the appropriate provider

## Pull Request Guidelines

- Keep PRs focused on a single feature/fix
- Update documentation (README, AGENTS.md) if needed
- Test with at least one provider (Ollama is easiest for local testing)
- Explain the "why" in your PR description, not just the "what"

## Questions?

Open an issue for discussion before starting major changes.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
