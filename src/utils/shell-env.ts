import { execSync } from 'node:child_process';

export type ShellType = 'cmd' | 'powershell' | 'bash' | 'git-bash' | 'wsl' | 'unknown';

export interface ToolsAvailable {
  git: boolean;
  gh: boolean;
  node: boolean;
  npm: boolean;
  python: boolean;
  curl: boolean;
  wget: boolean;
  jq: boolean;
  podman: boolean;
  winget: boolean;
  choco: boolean;
}

export interface ShellInfo {
  type: ShellType;
  isWindows: boolean;
  isWSL: boolean;
  shellPath: string;
  tips: string[];
  hasPodman: boolean;
  tools: ToolsAvailable;
}

function checkTool(cmd: string, args: string = '--version'): boolean {
  try {
    execSync(`${cmd} ${args}`, { encoding: 'utf-8', timeout: 2000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectTools(): ToolsAvailable {
  const isWindows = process.platform === 'win32';
  return {
    git: checkTool('git'),
    gh: checkTool('gh'),
    node: checkTool('node'),
    npm: checkTool('npm'),
    python: checkTool('python'),
    curl: checkTool('curl'),
    wget: checkTool('wget'),
    jq: checkTool('jq'),
    podman: checkTool('podman'),
    winget: isWindows && checkTool('winget'),
    choco: isWindows && checkTool('choco', '--version 2>nul'),
  };
}

export function detectShell(): ShellInfo {
  const isWindows = process.platform === 'win32';
  const shell = process.env.SHELL || '';
  const comspec = process.env.COMSPEC || '';
  let type: ShellType;
  const tips: string[] = [];
  const tools = detectTools();

  if (isWindows) {
    if (shell?.includes('bash')) {
      type = 'git-bash';
      tips.push('POSIX commands work: ls, cat, grep, find');
      tips.push('Windows paths need /c/ prefix or use /mnt/c/');
    } else if (process.env.PSModulePath || process.env.__PWSH_PID) {
      type = 'powershell';
      tips.push('Use PowerShell cmdlets: Get-ChildItem, Get-Content');
      tips.push('PowerShell: $variable, ConvertFrom-Json for JSON parsing');
    } else {
      type = 'cmd';
      tips.push('CMD shell: dir, type, find, findstr, cd');
      tips.push('PowerShell avail via: powershell -Command "..."');
      tips.push('Variables: %VAR% instead of $VAR');
    }
  } else {
    try {
      const version = execSync('cat /proc/version 2>/dev/null || uname -r', { encoding: 'utf-8', timeout: 2000 });
      if (version.toLowerCase().includes('microsoft') || version.toLowerCase().includes('wsl')) {
        type = 'wsl';
        tips.push('Running in WSL (Linux on Windows)');
        tips.push('Windows files at /mnt/c/, /mnt/d/, etc.');
      } else {
        type = 'bash';
        tips.push('Native Linux shell');
      }
    } catch {
      type = 'bash';
      tips.push('POSIX environment');
    }
  }

  // Tool availability tips
  if (tools.jq) {
    tips.push('jq available for JSON parsing in shell');
  } else if (isWindows) {
    tips.push('jq not installed. Use PowerShell ConvertFrom-Json for JSON or install: winget install jqlang.jq');
  } else {
    tips.push('jq not installed. Install via: apt-get install jq (or brew install jq)');
  }

  if (tools.wget) {
    tips.push('wget available for downloads');
  } else {
    tips.push('wget not installed. Use curl instead (curl -O <url>)');
  }

  if (tools.podman) {
    tips.push('Podman available for containers (preferred over Docker)');
  } else if (type === 'wsl' || type === 'bash') {
    tips.push('Install Podman for rootless containers: podman.io');
  }

  if (tools.winget) {
    tips.push('winget available for package management');
  }

  return { type, isWindows, isWSL: type === 'wsl', shellPath: shell || comspec, tips, hasPodman: tools.podman, tools };
}

/** Returns shell-specific prompt guidance for the AI model */
export function getShellPromptSections(shellInfo: ShellInfo): string {
  const { type, isWindows, tools } = shellInfo;
  const parts: string[] = [];

  if (type === 'cmd' || type === 'powershell' || (isWindows && type !== 'git-bash')) {
    const shellName = type === 'powershell' ? 'PowerShell' : 'CMD';
    const jsonTip = tools.jq
      ? '  jq available: cat file.json | jq ".field"'
      : [
          '  jq NOT installed. Use one of:',
          '  - PowerShell: powershell -Command "Get-Content file.json | ConvertFrom-Json | Select -Expand field"',
          '  - Install: winget install jqlang.jq',
          '  - Use gh --template or gh --jq (handles JSON natively)',
        ].join('\n');

    parts.push(
      '# Windows CMD/PowerShell Compatibility',
      '',
      'You are running in ' + shellName + ', NOT a POSIX shell.',
      '',
      'Commands that DO NOT WORK:',
      '  head, tail, grep (pipe)    - Not available natively',
      '  ls -la, cat, chmod, chown  - POSIX-only commands',
      '  $VARIABLE syntax           - Use %VAR% (CMD) or $variable (PowerShell)',
      '  Single quotes in args      - Use double quotes in CMD',
      '',
      'Commands that WORK:',
      '  dir, type, find, findstr   - Native CMD equivalents',
      '  where <tool>               - Find executable paths (like Unix which)',
      '  curl, git, gh, node        - Available in PATH',
      '  PowerShell: powershell -Command "..."  - For complex operations',
      '',
      'JSON Parsing:',
      jsonTip,
      '',
      'For multi-step workflows, prefer the built-in tools:',
      '  read_file, write_file, edit_file - Instead of cat, echo >, sed',
      '  search_text                     - Instead of grep, findstr',
      '  git tool                        - Instead of shell git commands'
    );
  }

  if (type === 'git-bash') {
    parts.push(
      '# Git Bash Compatibility',
      '',
      'POSIX commands work: ls, cat, grep, find, head, tail',
      'Windows paths need /c/ prefix or /mnt/c/'
    );
  }

  if (type === 'wsl') {
    parts.push(
      '# WSL Compatibility',
      '',
      'Full Linux/POSIX environment.',
      'Windows files accessible at /mnt/c/, /mnt/d/, etc.'
    );
  }

  if (tools.podman) {
    parts.push(
      '# Podman Containers (available)',
      '',
      'Podman is available. Use it for container operations.',
      '  podman pull <image>       - Pull an image',
      '  podman run -it <image>    - Run a container',
      '  podman ps                 - List running containers',
      '  podman build -t <tag> .   - Build from Dockerfile',
      '',
      'Podman is rootless by default (no sudo needed).'
    );
  }

  parts.push(
    '# Shell-Aware Command Execution',
    '',
    'Be aware of the detected shell and adapt commands accordingly.',
    'The shell info is injected above - read it before running commands.'
  );

  return parts.join('\n');
}
