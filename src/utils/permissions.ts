import prompts from 'prompts';
import chalk from 'chalk';
import type { ProjectConfig } from '../core/types.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDangerousCommand, formatDangerousWarning } from './dangerous-commands.js';
import { boxHeader, boxFooter } from './box-drawing.js';

export interface PermissionContext {
  toolName: string;
  args: Record<string, unknown>;
  config: ProjectConfig;
  autoApprove?: boolean; // Override from CLI flag
}

// Track session-level permissions (reset when process ends)
const sessionAutoApprove = new Set<string>();

// Clear session permissions (used when switching to "always ask" mode)
export function clearSessionPermissions(): void {
  sessionAutoApprove.clear();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Shell-command normalization (#474) ──
// matchDenyCommand and the git-mutation guard both run on normalizeCommand()
// output so flag/quoting/indirection tricks cannot slip a denied command past
// a plain string match. Covered: shell quoting (r\m, r''m, "rm", ANSI-C
// $'\xNN'), $IFS, env/VAR=x prefixes, nice/time/xargs/sudo/shell -c wrappers,
// git global options (--git-dir/--work-tree/-C/…), path-prefixed binaries
// (/usr/bin/git), simple variable indirection (a=git;$a …, ${X:-def}), eval,
// and `…`/$( … ) substitution bodies. This is NOT a full shell parser —
// residual limits are documented in docs/permission-profiles.md; use
// `sandbox` for hard boundaries.

// C0 sentinel emitted where an expansion cannot be resolved statically
// ($VAR with no visible assignment, $@/$?/positional params, malformed ${}).
// Real command text never contains it.
const DYNAMIC = '\x01';
const CTRL_RE = /[\x00-\x1f]/;
const CTRL_STRIP_RE = /[\x00-\x1f]/g;
const SEPARATOR_SPLIT_RE = /([;|&(){}<>]+)/;

// Escaped shell metacharacters hide behind sentinels so later passes don't
// mistake them for real syntax (`a\;b` is one word, not two commands).
const ESCAPE_SENTINELS: Record<string, string> = {
  '\\': '\x03', '$': '\x04', '`': '\x06', ';': '\x07', '|': '\x08',
  '&': '\x0e', '>': '\x0f', '<': '\x10', '(': '\x11', ')': '\x12',
  '{': '\x13', '}': '\x14', '"': '\x15', "'": '\x16',
};
const SENTINEL_TO_CHAR: Record<string, string> = {};
for (const [ch, sentinel] of Object.entries(ESCAPE_SENTINELS)) {
  SENTINEL_TO_CHAR[sentinel] = ch;
}

// Reduce a token to its basename so path-prefixed binaries match
// (`/usr/bin/git`, `C:\tools\git.exe`, `./git`). Sentinels strip for compare.
function basenameOf(token: string): string {
  const clean = token.replace(CTRL_STRIP_RE, '');
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1];
}

interface WrapperSpec {
  /** Options that consume the following token as their value (`-u user`). */
  argFlags?: ReadonlySet<string>;
  /** Options that make the remainder an unanalyzable command string (`sh -c`). */
  opaqueFlags?: ReadonlySet<string>;
  /** The wrapper itself re-parses its arguments as a command (`eval`, `xargs`). */
  opaque?: boolean;
  /** Non-flag args owned by the wrapper before the real command (`timeout 5`). */
  positional?: number;
  /** The command's args are completed from stdin — appends a dynamic tail. */
  appendsArgs?: boolean;
  /** The wrapper accepts `/flag` style options (Windows `cmd`). */
  slashFlags?: boolean;
}

// Head-of-command wrappers that execute a later argument list as the real
// command. Folding them away exposes the nested command to matching:
// `nice -n 10 rm -rf x` → `rm -rf x`.
const WRAPPERS: Record<string, WrapperSpec> = {
  env:     { argFlags: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']) },
  sudo:    { argFlags: new Set(['-u', '-g', '-h', '-p', '-C', '-T', '-r', '-s', '-t']) },
  doas:    { argFlags: new Set(['-u', '-C']) },
  nice:    { argFlags: new Set(['-n', '--adjustment']) },
  time:    { argFlags: new Set(['-o', '-f', '--output', '--format']) },
  timeout: { argFlags: new Set(['-s', '--signal', '-k', '--kill-after']), positional: 1 },
  xargs:   { opaque: true, appendsArgs: true, argFlags: new Set(['-I', '-L', '-n', '-d', '-s', '-P', '-a', '-E', '-e', '--replace', '--max-lines', '--max-args', '--delimiter', '--max-chars', '--max-procs', '--arg-file', '--eof', '--exit', '--process-slot-var']) },
  stdbuf:  { argFlags: new Set(['-i', '-o', '-e', '--input', '--output', '--error']) },
  ionice:  { argFlags: new Set(['-c', '-n', '-p', '-P', '-t']) },
  taskset: { argFlags: new Set(['-c', '-p']), positional: 1 },
  watch:   { argFlags: new Set(['-n', '--interval']) },
  strace:  { argFlags: new Set(['-o', '-p', '-e', '-s', '-u', '-P']) },
  ltrace:  { argFlags: new Set(['-o', '-p', '-e', '-S']) },
  nohup:   {},
  setsid:  {},
  busybox: {},
  command: {},
  builtin: {},
  exec:    { argFlags: new Set(['-a']) },
  eval:    { opaque: true },
  sh:         { argFlags: new Set(['-o']), opaqueFlags: new Set(['-c']) },
  bash:       { argFlags: new Set(['-o', '-O']), opaqueFlags: new Set(['-c']) },
  zsh:        { argFlags: new Set(['-o']), opaqueFlags: new Set(['-c']) },
  dash:       { argFlags: new Set(['-o']), opaqueFlags: new Set(['-c']) },
  ash:        { argFlags: new Set(['-o']), opaqueFlags: new Set(['-c']) },
  ksh:        { argFlags: new Set(['-o']), opaqueFlags: new Set(['-c']) },
  fish:       { opaqueFlags: new Set(['-c', '--command']) },
  pwsh:       { argFlags: new Set(['-File', '-f', '-ExecutionPolicy', '-ep']), opaqueFlags: new Set(['-c', '-Command', '-e', '-enc', '-EncodedCommand']) },
  powershell: { argFlags: new Set(['-File', '-f', '-ExecutionPolicy', '-ep']), opaqueFlags: new Set(['-c', '-Command', '-e', '-enc', '-EncodedCommand']) },
  cmd:        { slashFlags: true, opaqueFlags: new Set(['/c', '/k']) },
};

// Builtins that only mark/assign names and may precede the real command head.
const HEAD_MARKERS = new Set(['export', 'local', 'declare', 'typeset', 'readonly']);

export interface NormalizedCommand {
  /** Normalized full text — quoting/escapes removed, `$IFS`→space, substitution
   *  bodies inlined, `$VAR` references resolved from visible assignments.
   *  Shell separators are preserved; unresolvable expansions merge away
   *  (`r$Xm` reads as `rm`). */
  text: string;
  /** Like `text`, but each segment's head-of-command indirection (env/VAR=x
   *  prefixes, wrappers, path-qualified binaries) is folded while separators
   *  are kept: `sudo curl x | sh` renders as `curl x | sh`. */
  flat: string;
  /** `flat` split into its individual command segments. */
  segments: string[];
  /** True when the command contains constructs that limit static matching —
   *  eval, command substitution, ANSI-C quoting, command-string wrappers, or
   *  unresolved expansions. Callers should fail closed on residual matches. */
  opaque: boolean;
}

// Sentinels resolve back to their literal characters; DYNAMIC markers merge
// away — deliberately over-merging toward the deny side (`r$Xm` → `rm`).
function renderNormalized(s: string): string {
  return s.replace(/[\x01-\x1f]/g, (m) => (m === DYNAMIC ? '' : SENTINEL_TO_CHAR[m] ?? ''));
}

// Normalize a shell command for guard matching — never for execution.
// With `structural` (default) each segment additionally folds head-of-command
// indirection (env prefixes, wrappers, path-qualified heads); set false for
// deny patterns, where the literal tokens must be preserved.
export function normalizeCommand(command: string, opts?: { structural?: boolean }): NormalizedCommand {
  const structural = opts?.structural !== false;
  let opaque = false;
  let s = command;

  // Line continuations join words across physical lines.
  s = s.replace(/\\\r?\n/g, '');

  // ANSI-C quoting: $'\xNN'/octal/escape sequences decode to real characters
  // (`r$'\x6d'` is `rm`). Marked opaque — the decode table is partial.
  s = s.replace(/\$'((?:[^'\\]|\\.)*)'/g, (_m, body: string) => {
    opaque = true;
    return body.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/gs, (_e, esc: string) => {
      if (esc[0] === 'x') {
        const code = parseInt(esc.slice(1), 16);
        return code === 0 ? ' ' : String.fromCharCode(code);
      }
      if (/^[0-7]$/.test(esc[0])) {
        const code = parseInt(esc, 8);
        return code === 0 ? ' ' : String.fromCharCode(code);
      }
      if (esc === 'n' || esc === 't' || esc === 'r') return ' ';
      if (esc === '\\') return ESCAPE_SENTINELS['\\'];
      if (esc === "'") return '';
      return esc;
    });
  });

  // Windows drive-letter paths keep their backslashes (`C:\tools\git.exe`) —
  // everywhere else a backslash escapes the following character (`r\m` → `rm`).
  s = s.replace(/\b[A-Za-z]:\\[^\s;|&(){<>'"]*/g, (m) => m.replace(/\\/g, ESCAPE_SENTINELS['\\']));
  s = s.replace(/\\(.)/gs, (_m, c: string) => {
    if (/\s/.test(c)) return c === '\n' ? '' : ' ';
    return ESCAPE_SENTINELS[c] ?? c;
  });

  // Quote characters merge words: r''m → rm, "rm" → rm.
  s = s.replace(/['"]/g, '');

  // Backtick substitution bodies stay visible so literal deny patterns can
  // still see them: `` `echo rm` -rf x `` → ` echo rm  -rf x`.
  if (s.includes('`')) {
    opaque = true;
    s = s.replace(/`/g, ' ');
  }

  // $IFS expands to whitespace.
  s = s.replace(/\$\{IFS\}|\$IFS\b/g, ' ');

  // Collect simple NAME=value literals — including values built from command
  // substitution (`GIT=$(echo git)`) — so later $NAME references resolve.
  const vars = new Map<string, string>();
  const assignRe = /(?:^|[\s;|&(){<>])(?:(?:export|local|declare|typeset|readonly)\s+)*([A-Za-z_][A-Za-z0-9_]*)=((?:\$\([^()]*\)|[^\s;|&(){<>}])*)/g;
  let am: RegExpExecArray | null;
  while ((am = assignRe.exec(s)) !== null) {
    vars.set(am[1], am[2]);
  }

  // Resolve $NAME / ${NAME} / ${NAME:-default} / ${NAME:+alt} against the
  // visible assignments (`a=git;$a reset` → `git reset`). Anything
  // unresolvable collapses to a DYNAMIC placeholder and flags opaque.
  const varRe =
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-+?])([^}]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$([@*#?$!0-9-]|\{[^}]*\})/g;
  for (let pass = 0; pass < 8; pass++) {
    const prev = s;
    s = s.replace(
      varRe,
      (
        _m: string,
        opName: string | undefined,
        op: string | undefined,
        word: string | undefined,
        brName: string | undefined,
        name: string | undefined,
        special: string | undefined,
      ) => {
        if (special !== undefined) {
          opaque = true;
          return DYNAMIC;
        }
        const n = opName ?? brName ?? name;
        const has = n !== undefined && vars.has(n);
        const v = has ? (vars.get(n as string) as string) : '';
        if (op === '+' || op === ':+') return has && (op === '+' || v !== '') ? (word ?? '') : '';
        if (op === '-' || op === ':-') return has && (op === '-' || v !== '') ? v : (word ?? '');
        if (has) {
          if (v.includes('$') || CTRL_RE.test(v)) opaque = true;
          return v;
        }
        opaque = true;
        return DYNAMIC;
      },
    );
    if (s === prev) break;
  }

  // $( … ) bodies inline with matched parens, keeping the inner text visible:
  // `$(echo rm) -rf x` → ` echo rm  -rf x`.
  if (s.includes('$(')) {
    opaque = true;
    let out = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '$' && s[i + 1] === '(') {
        depth++;
        out += ' ';
        i++;
      } else if (ch === ')' && depth > 0) {
        depth--;
        out += ' ';
      } else {
        out += ch;
      }
    }
    s = out;
  }

  // Any $ still standing is an expansion we could not model.
  if (s.includes('$')) {
    s = s.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$\S?/g, () => {
      opaque = true;
      return DYNAMIC;
    });
  }

  s = s.trim().replace(/\s+/g, ' ');

  // Structural pass: per command segment, fold head-of-command indirection —
  // marker builtins, VAR=x env prefixes, and wrapper commands — then reduce a
  // path-qualified command head to its basename.
  const parts = s.split(SEPARATOR_SPLIT_RE); // [seg, sep, seg, …]
  const segments: string[] = [];
  const flatParts: string[] = [];
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (p % 2 === 1) {
      flatParts.push(part); // captured separator — kept verbatim
      continue;
    }
    const tokens = part.split(' ').filter(Boolean);
    if (!structural) {
      segments.push(tokens.join(' '));
      flatParts.push(part);
      continue;
    }
    let i = 0;
    let appendsArgs = false;
    let lastWrapper = '';
    for (let spins = 0; i < tokens.length && spins < 32; spins++) {
      const head = tokens[i];
      if (HEAD_MARKERS.has(head) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
        i++;
        continue;
      }
      const w = WRAPPERS[basenameOf(head)];
      if (!w) break;
      if (w.opaque === true) opaque = true;
      if (w.appendsArgs === true) appendsArgs = true;
      lastWrapper = head;
      i++;
      while (i < tokens.length && spins < 32) {
        spins++;
        const t = tokens[i];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
        const isFlag = t.startsWith('-') || (w.slashFlags === true && t.startsWith('/'));
        if (!isFlag) break;
        i++;
        if (w.argFlags?.has(t)) i++;
        if (w.opaqueFlags?.has(t)) opaque = true;
      }
      for (let k = w.positional ?? 0; k > 0 && i < tokens.length && spins < 32; k--, spins++) {
        if (tokens[i].startsWith('-')) break;
        i++;
      }
    }
    const rest = tokens.slice(i);
    // A wrapper that consumed the whole segment is itself the command — a
    // trailing `| bash`/`| sh` runs the shell on stdin, it doesn't vanish.
    // Keep the innermost wrapper head so pipe-to-interpreter globs like
    // `curl * | *sh` still match the folded form.
    if (rest.length === 0 && lastWrapper) rest.push(lastWrapper);
    if (appendsArgs && rest.length > 0) rest.push(DYNAMIC);
    if (rest.length > 0) rest[0] = basenameOf(rest[0]);
    const seg = rest.join(' ');
    segments.push(seg);
    // Pad so stripped segments stay separated from neighboring separators
    // (`sudo curl x | sh` must render `curl x | sh`, not `curl x| sh`).
    flatParts.push(` ${seg} `);
  }

  return {
    text: renderNormalized(s).trim().replace(/\s+/g, ' '),
    flat: renderNormalized(flatParts.join('')).trim().replace(/\s+/g, ' '),
    segments,
    opaque,
  };
}

// Git global options that consume the following token as their value.
// Any other `-x`/`--opt`/`--opt=v` token is treated as flag-only — skipping
// just the flag fails closed onto the next word (`git --bogus commit` still
// lands on `commit`).
const GIT_ARG_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

interface GitInvocation {
  /** Subcommand token — '' when the position held an unresolvable expansion. */
  sub: string;
  /** Tokens after the subcommand within the same segment. */
  rest: string[];
  /** True when the subcommand position held an unresolvable expansion. */
  dynamicSub: boolean;
}

// Extract every `git …` invocation from a normalized segment's tokens,
// skipping global options between the binary and the subcommand.
function gitInvocations(tokens: string[]): GitInvocation[] {
  const out: GitInvocation[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const base = basenameOf(tokens[i]);
    if (base !== 'git' && base !== 'git.exe') continue;
    let j = i + 1;
    while (j < tokens.length) {
      const t = tokens[j].replace(CTRL_STRIP_RE, '');
      if (GIT_ARG_OPTIONS.has(t)) { j += 2; continue; }
      if (t.startsWith('-')) { j += 1; continue; }
      break;
    }
    if (j >= tokens.length) continue;
    const sub = tokens[j];
    if (CTRL_RE.test(sub)) {
      out.push({ sub: '', rest: [], dynamicSub: true });
      continue;
    }
    out.push({ sub: sub.replace(CTRL_STRIP_RE, ''), rest: tokens.slice(j + 1), dynamicSub: false });
  }
  return out;
}

// Match a shell command against permissions.denyCommands patterns.
// The command is normalized first (see normalizeCommand), so quoting, `$IFS`,
// env/wrapper prefixes, git global flags, path-prefixed binaries, variable
// indirection, and eval/`…`/$(…) substitution cannot hide a denied command.
// Pattern semantics (case-sensitive):
//   - contains '*': glob anchored on the whole normalized command AND on each
//                   command segment (split on ; | && || after normalization)
//   - otherwise:    substring match anywhere in the normalized command
// Opaque commands additionally fail closed: when the literal text still
// carries every word of a pattern, the command is treated as denied.
// Returns the matching pattern, or null when the command is allowed.
export function matchDenyCommand(command: string, patterns: string[]): string | null {
  const norm = normalizeCommand(command);
  const candidates = new Set<string>([
    norm.text,
    norm.flat,
    command.trim().replace(/\s+/g, ' '),
    ...norm.segments,
  ]);
  // Canonical `git <sub> …` forms so `git --git-dir=x push` still matches a
  // `git push` deny entry.
  for (const seg of norm.segments) {
    for (const inv of gitInvocations(seg.split(' ').filter(Boolean))) {
      if (!inv.sub) continue;
      const rest = inv.rest.map((t) => t.replace(CTRL_STRIP_RE, '')).join(' ');
      candidates.add(`git ${inv.sub} ${rest}`.trim());
    }
  }

  for (const raw of patterns) {
    const pattern = normalizeCommand(raw || '', { structural: false }).text;
    if (!pattern) continue;

    let hit = false;
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
      for (const c of candidates) {
        if (re.test(c)) { hit = true; break; }
      }
      if (!hit && norm.opaque) {
        const frags = pattern.split('*').map((f) => f.trim()).filter(Boolean);
        hit = frags.length > 0 && frags.every((f) => norm.text.includes(f));
      }
    } else {
      for (const c of candidates) {
        if (c.includes(pattern)) { hit = true; break; }
      }
      if (!hit && norm.opaque) {
        const words = pattern.split(' ').filter(Boolean);
        hit = words.length > 0 && words.every((w) => norm.text.includes(w));
      }
    }
    if (hit) return raw;
  }
  return null;
}

// Git subcommands that mutate refs/index/worktree when run via run_shell.
// Listing forms (`git branch`, `git tag` with no extra args) stay allowed.
const GIT_MUTATING_SUBCOMMANDS = new Set([
  'add', 'am', 'apply', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit',
  'fetch', 'init', 'merge', 'mv', 'pull', 'push', 'rebase', 'reset', 'restore',
  'revert', 'rm', 'stash', 'submodule', 'switch', 'worktree',
]);
const GIT_ARG_MUTATING_SUBCOMMANDS = new Set(['branch', 'tag']);

// Detect git-mutating invocations inside a shell command string.
// Runs on normalized segments (quoting/env/wrappers/flags folded — see
// normalizeCommand), so `git --git-dir=… reset`, `env V=x git commit`,
// `a=git;$a reset`, `eval "git …"`, `g''it …`, and `/usr/bin/git …` are all
// caught. `git branch`/`git tag` only count as mutating when followed by more
// args. Opaque commands fail closed: a git invocation whose subcommand is an
// unresolvable expansion (`git $OP`) is reported as `git <dynamic>`.
export function isGitMutatingCommand(command: string): string | null {
  const norm = normalizeCommand(command);
  let sawGit = false;
  let dynamicSub = false;
  for (const seg of norm.segments) {
    const tokens = seg.split(' ').filter(Boolean);
    const invocations = gitInvocations(tokens);
    if (
      invocations.length > 0 ||
      tokens.some((t) => {
        const b = basenameOf(t);
        return b === 'git' || b === 'git.exe';
      })
    ) {
      sawGit = true;
    }
    for (const inv of invocations) {
      if (inv.dynamicSub) {
        dynamicSub = true;
        continue;
      }
      if (GIT_MUTATING_SUBCOMMANDS.has(inv.sub)) return `git ${inv.sub}`;
      if (GIT_ARG_MUTATING_SUBCOMMANDS.has(inv.sub) && inv.rest.length > 0) return `git ${inv.sub}`;
    }
  }

  if (norm.opaque && sawGit) {
    for (const seg of norm.segments) {
      for (const tok of seg.split(' ')) {
        const w = tok.replace(CTRL_STRIP_RE, '');
        if (GIT_MUTATING_SUBCOMMANDS.has(w) || GIT_ARG_MUTATING_SUBCOMMANDS.has(w)) {
          return `git ${w}`;
        }
      }
    }
    if (dynamicSub) return 'git <dynamic>';
  }
  return null;
}

const GIT_MUTATION_DENIED =
  'Git mutations are managed externally (--no-commit / permissions.denyGitMutation). ' +
  'Make filesystem edits only — do not run git add/commit/checkout/push or any git-mutating command.';

const GIT_MUTATION_UNATTENDED_DENIED =
  'Git-mutating commands via run_shell are refused in unattended mode (-y / --permissions unlimited) — ' +
  'the dedicated `git` tool owns repo state (use it for status/diff/log/show/branch/add/commit/format). ' +
  'Do not run git checkout/restore/reset/clean/stash or any other git-mutating command via run_shell: ' +
  'they can silently revert your own edits before the run ends.';

export async function requestPermission(ctx: PermissionContext): Promise<boolean> {
  // Hard deny first: permissions.denyCommands is a non-interactive blocklist
  // that applies to run_shell in every mode — including -y/autoApprove.
  if (ctx.toolName === 'run_shell') {
    const command = (ctx.args.command as string) || '';
    const denied = matchDenyCommand(command, ctx.config.permissions?.denyCommands || []);
    if (denied) {
      throw new Error(
        `Command denied by permissions.denyCommands rule "${denied}": ${command}\n` +
        `This is a hard block — adjust the deny list in your config to allow it.`
      );
    }
  }

  // Hard deny: permissions.denyGitMutation blocks git-mutating operations in
  // every mode — orchestrators (ai-sdlc workers) own git state externally.
  if (ctx.config.permissions?.denyGitMutation) {
    if (ctx.toolName === 'git') {
      const op = (ctx.args.operation as string) || '';
      if (op === 'add' || op === 'commit') {
        throw new Error(`git ${op} denied. ${GIT_MUTATION_DENIED}`);
      }
    }
    if (ctx.toolName === 'run_shell') {
      const command = (ctx.args.command as string) || '';
      const gitOp = isGitMutatingCommand(command);
      if (gitOp) {
        throw new Error(`${gitOp} denied. ${GIT_MUTATION_DENIED}`);
      }
    }
  }

  // Hard deny: in unattended runs (-y / --permissions unlimited) the `git` tool
  // owns repo state. A run_shell `git checkout -- .`, `git restore`, `git reset
  // --hard`, `git clean -f`, or `git stash` can silently revert the model's own
  // edits before commit time (#464). Interactive mode is unaffected — the
  // human approves each command.
  if (ctx.autoApprove && ctx.toolName === 'run_shell') {
    const command = (ctx.args.command as string) || '';
    const gitOp = isGitMutatingCommand(command);
    if (gitOp) {
      throw new Error(`${gitOp} refused. ${GIT_MUTATION_UNATTENDED_DENIED}`);
    }
  }

  // Auto-approve if explicitly set in context
  if (ctx.autoApprove) return true;

  // Check permission profile
  const permissionProfile = ctx.config.permissions?.profile || 'traditional';

  // BLACKLIST MODE: Only ask for dangerous commands
  if (permissionProfile === 'blacklist' && ctx.toolName === 'run_shell') {
    const command = (ctx.args.command as string) || '';
    const dangerCheck = isDangerousCommand(normalizeCommand(command).text);

    if (!dangerCheck.isDangerous) {
      // Safe command - auto-approve
      return true;
    }

    // Dangerous command - show warning and ask
    console.log(chalk.gray(`\n${boxHeader('Dangerous Command Alert', 2)}`));
    console.log(chalk.gray(`  │ ${chalk.red('⚠️')}  Tool: ${ctx.toolName}`));
    console.log(chalk.gray(`  │    Command: ${command}`));
    console.log(chalk.gray('  │'));

    const warning = formatDangerousWarning(dangerCheck.matches);
    warning.split('\n').forEach(line => {
      console.log(chalk.gray(`  │    ${chalk.yellow(line)}`));
    });

    console.log(chalk.gray(boxFooter(2)));

    const response = await prompts({
      type: 'confirm',
      name: 'approved',
      message: chalk.red('This command is potentially dangerous. Allow anyway?'),
      initial: false,
    });

    if (response.approved === false) {
      console.log(chalk.gray(`\n   ℹ️  Action denied. The agent will try another approach.\n`));
      return false;
    }

    return response.approved ?? false;
  }

  // TRADITIONAL MODE: Continue with normal permission flow
  // Check session-level auto-approve
  if (sessionAutoApprove.has(ctx.toolName)) {
    return true;
  }

  // Check auto-approve list in config
  const autoApproveList = ctx.config.permissions?.autoApprove || [];
  if (autoApproveList.includes(ctx.toolName)) {
    return true;
  }

  // Ask user with helpful context (redact sensitive fields)
  const SENSITIVE_KEYS = new Set([
    'apiKey', 'api_key', 'api-key',
    'password', 'passwd', 'pass',
    'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'secret', 'secretKey', 'secret_key', 'clientSecret', 'client_secret',
    'auth', 'authorization', 'authToken', 'auth_token',
    'key', 'privateKey', 'private_key', 'publicKey', 'public_key',
    'credential', 'credentials',
    'jwt', 'jwt_token', 'sessionKey', 'session_key',
    'sshKey', 'ssh_key', 'sshPrivateKey',
  ]);
  const redactedArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.args)) {
    redactedArgs[k] = SENSITIVE_KEYS.has(k) ? '***' : v;
  }
  console.log(chalk.gray(`\n${boxHeader('Permission', 2)}`));
  console.log(chalk.gray(`  │ ${chalk.yellow('🔐')} Tool: ${ctx.toolName}`));
  console.log(chalk.gray(`  │    Args: ${JSON.stringify(redactedArgs)}`));
  console.log(chalk.gray(boxFooter(2)));

  const response = await prompts({
    type: 'select',
    name: 'choice',
    message: 'Allow this action?',
    choices: [
      { title: 'Yes (once)', value: 'yes', description: 'Allow this time only' },
      { title: 'Always (save to config)', value: 'always', description: 'Auto-approve forever' },
      { title: 'Session (until exit)', value: 'session', description: 'Auto-approve this session' },
      { title: 'No (deny)', value: 'no', description: 'Deny this action' },
    ],
    initial: 0, // Default to "Yes (once)"
  });

  const choice = response.choice;

  if (!choice || choice === 'no') {
    console.log(chalk.gray(`\n   ℹ️  Action denied. The agent will try another approach.\n`));
    return false;
  }

  if (choice === 'always') {
    // Save to config permanently AND update in-memory config to avoid re-prompting
    try {
      const configDir = path.join(homedir(), '.sc-agent');
      const configPath = path.join(configDir, 'config.json');

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      let configContent: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        const fileContent = readFileSync(configPath, 'utf-8');
        configContent = JSON.parse(fileContent);
      }

      const permissions = (configContent.permissions as { autoApprove?: string[]; profile?: string; denyPaths?: string[] }) || {};
      if (!permissions.autoApprove) {
        permissions.autoApprove = [];
      }
      if (!permissions.autoApprove.includes(ctx.toolName)) {
        permissions.autoApprove.push(ctx.toolName);
        configContent.permissions = permissions;
        writeFileSync(configPath, JSON.stringify(configContent, null, 2));
      }

      // Also update in-memory config for immediate effect in this session
      const configPermissions = ctx.config.permissions;
      if (configPermissions) {
        if (!configPermissions.autoApprove) {
          configPermissions.autoApprove = [];
        }
        if (!configPermissions.autoApprove.includes(ctx.toolName)) {
          configPermissions.autoApprove.push(ctx.toolName);
        }
      }

      console.log(chalk.gray(`\n   ✓ "${ctx.toolName}" auto-approved for this and future sessions\n`));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.gray(`\n   ⚠️  Could not save to config: ${errorMsg}`));
      console.log(chalk.gray(`   Approved for this session only\n`));
      sessionAutoApprove.add(ctx.toolName);
    }
    return true;
  }

  if (choice === 'session') {
    sessionAutoApprove.add(ctx.toolName);
    console.log(chalk.gray(`\n   ✓ "${ctx.toolName}" auto-approved for this session\n`));
    return true;
  }

  // choice === 'yes'
  return true;
}