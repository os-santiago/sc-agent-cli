# Sandbox integration suite

Opt-in bwrap integration tests (#544, split out of #481). These exercise
`run_shell` through a **real** bubblewrap boundary — mount namespaces,
read-only `/`, workspace bind, egress policy — instead of the injected fake
backend the unit suite (`src/utils/sandbox.test.ts`) uses.

They are **not** part of the default `npm test` unit suite and contribute no
coverage to `npm run test:coverage` — the `src/tools/**` per-file floor is
scoped to the unit suite (`vitest.config.ts`) alone.

## Running locally

```bash
SC_SANDBOX_TESTS=1 npm run test:sandbox   # vitest --config vitest.sandbox.config.ts
```

Every suite is double-gated:

- **`SC_SANDBOX_TESTS=1`** — explicit opt-in. Without it every test skips,
  and the bwrap probe is never spawned (the flag is short-circuited first).
- **`hasBwrap()`** (`src/utils/sandbox.ts`) — real host detection: Linux +
  `bwrap` on `PATH` + usable unprivileged user namespaces. On macOS,
  Windows, or a Linux host where userns is locked down (e.g. Ubuntu 24.04
  AppArmor defaults, nested containers), the `describe.skipIf` pattern
  degrades the suite to an all-skipped pass — CI and dev machines never
  *require* bwrap or root.

CI runs the suite on the Linux leg only, behind `SC_SANDBOX_TESTS=1`
(`.github/workflows/ci.yml`).

## Adding a case

Place `*.test.ts` files under `test/sandbox/` and wrap the suite in:

```ts
describe.skipIf(process.env.SC_SANDBOX_TESTS !== '1' || !hasBwrap())('...', () => { ... });
```

Check the env flag **first** so the bwrap probe never spawns for non-opted
runs. For real sandboxed commands, build a `SandboxRuntime` without a
`detectBackend` override (the real host probe runs) and pass it via
`ToolContext.sandbox`; unit tests keep using the injected-fake-backend
pattern instead.
