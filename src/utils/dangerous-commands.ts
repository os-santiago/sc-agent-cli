// Dangerous commands blacklist for intelligent permission filtering

export interface DangerousPattern {
  pattern: RegExp;
  category: string;
  description: string;
  severity: 'critical' | 'high' | 'medium';
}

export const DANGEROUS_COMMANDS: DangerousPattern[] = [
  // File Deletion - CRITICAL
  {
    pattern: /\brm\s+(-[rRfF]*\s+)?[^\s]/,
    category: 'file-deletion',
    description: 'Delete files/directories',
    severity: 'critical',
  },
  {
    pattern: /\bdel\s+/i,
    category: 'file-deletion',
    description: 'Delete files (Windows)',
    severity: 'critical',
  },
  {
    pattern: /\bremove-item\s+/i,
    category: 'file-deletion',
    description: 'Delete files (PowerShell)',
    severity: 'critical',
  },
  {
    pattern: /\bunlink\s+/,
    category: 'file-deletion',
    description: 'Delete files (system call)',
    severity: 'critical',
  },

  // Recursive/Force deletion - CRITICAL
  {
    pattern: /\brm\s+-[rRfF]*r[fF]*/,
    category: 'recursive-deletion',
    description: 'Recursive delete (rm -rf)',
    severity: 'critical',
  },
  {
    pattern: /\brm\s+-[rRfF]*f[rR]*/,
    category: 'recursive-deletion',
    description: 'Force delete (rm -f)',
    severity: 'critical',
  },
  {
    pattern: /\brd\s+\/s/i,
    category: 'recursive-deletion',
    description: 'Recursive delete (Windows rd /s)',
    severity: 'critical',
  },

  // System Administration - CRITICAL
  {
    pattern: /\bsudo\s+/,
    category: 'privilege-escalation',
    description: 'Execute as superuser',
    severity: 'critical',
  },
  {
    pattern: /\bsu\s+-/,
    category: 'privilege-escalation',
    description: 'Switch user',
    severity: 'critical',
  },
  {
    pattern: /\brunas\s+/i,
    category: 'privilege-escalation',
    description: 'Run as administrator (Windows)',
    severity: 'critical',
  },

  // Disk Operations - HIGH
  {
    pattern: /\bmkfs\b/,
    category: 'disk-operation',
    description: 'Format filesystem',
    severity: 'high',
  },
  {
    pattern: /\bdd\s+if=/,
    category: 'disk-operation',
    description: 'Disk dump (can overwrite data)',
    severity: 'high',
  },
  {
    pattern: /\bformat\s+/i,
    category: 'disk-operation',
    description: 'Format disk (Windows)',
    severity: 'high',
  },
  {
    pattern: /\bfdisk\b/,
    category: 'disk-operation',
    description: 'Partition disk',
    severity: 'high',
  },

  // Network Operations - HIGH
  {
    pattern: /\bcurl\s+.*\|\s*(bash|sh|zsh|fish)/,
    category: 'network-execution',
    description: 'Download and execute script',
    severity: 'high',
  },
  {
    pattern: /\bwget\s+.*\|\s*(bash|sh|zsh|fish)/,
    category: 'network-execution',
    description: 'Download and execute script',
    severity: 'high',
  },
  {
    pattern: /\bnc\s+-[le]/,
    category: 'network-backdoor',
    description: 'Netcat listener (potential backdoor)',
    severity: 'high',
  },
  {
    pattern: /\biptables\s+/,
    category: 'network-config',
    description: 'Modify firewall rules',
    severity: 'high',
  },
  {
    pattern: /\bnetsh\s+/i,
    category: 'network-config',
    description: 'Network configuration (Windows)',
    severity: 'high',
  },

  // System Configuration - HIGH
  {
    pattern: /\bchmod\s+[0-7]*[246][0-7]*/,
    category: 'permissions-change',
    description: 'Make file world-writable',
    severity: 'high',
  },
  {
    pattern: /\bchown\s+/,
    category: 'permissions-change',
    description: 'Change file ownership',
    severity: 'high',
  },
  {
    pattern: /\bcrontab\s+-/,
    category: 'system-config',
    description: 'Modify scheduled tasks',
    severity: 'high',
  },
  {
    pattern: /\bsystemctl\s+(enable|disable|stop|start)/,
    category: 'system-config',
    description: 'Modify system services',
    severity: 'high',
  },
  {
    pattern: /\bservice\s+/,
    category: 'system-config',
    description: 'Control system services',
    severity: 'high',
  },

  // Package Management - MEDIUM
  {
    pattern: /\bapt-get\s+(remove|purge)/,
    category: 'package-removal',
    description: 'Uninstall packages',
    severity: 'medium',
  },
  {
    pattern: /\byum\s+remove/,
    category: 'package-removal',
    description: 'Uninstall packages',
    severity: 'medium',
  },
  {
    pattern: /\bnpm\s+(uninstall|remove)/,
    category: 'package-removal',
    description: 'Uninstall npm packages',
    severity: 'medium',
  },
  {
    pattern: /\bpip\s+uninstall/,
    category: 'package-removal',
    description: 'Uninstall Python packages',
    severity: 'medium',
  },

  // Process Management - MEDIUM
  {
    pattern: /\bkill\s+-9/,
    category: 'process-kill',
    description: 'Force kill process',
    severity: 'medium',
  },
  {
    pattern: /\bkillall\s+/,
    category: 'process-kill',
    description: 'Kill all processes by name',
    severity: 'medium',
  },
  {
    pattern: /\btaskkill\s+\/f/i,
    category: 'process-kill',
    description: 'Force terminate process (Windows)',
    severity: 'medium',
  },

  // File Overwrite - MEDIUM
  {
    pattern: />\s*\/etc\//,
    category: 'system-file-overwrite',
    description: 'Overwrite system configuration',
    severity: 'high',
  },
  {
    pattern: />\s*\/boot\//,
    category: 'system-file-overwrite',
    description: 'Overwrite boot files',
    severity: 'critical',
  },
  {
    pattern: />\s*C:\\Windows\\/i,
    category: 'system-file-overwrite',
    description: 'Overwrite Windows system files',
    severity: 'high',
  },

  // Database Operations - HIGH
  {
    pattern: /\bdrop\s+(database|table|schema)/i,
    category: 'database-deletion',
    description: 'Delete database/table',
    severity: 'high',
  },
  {
    pattern: /\btruncate\s+table/i,
    category: 'database-deletion',
    description: 'Delete all table data',
    severity: 'high',
  },
  {
    pattern: /\bdelete\s+from.*where\s+1\s*=\s*1/i,
    category: 'database-deletion',
    description: 'Delete all rows',
    severity: 'high',
  },

  // Git Operations - MEDIUM
  {
    pattern: /\bgit\s+push\s+(-f|--force)/,
    category: 'git-force',
    description: 'Force push (can overwrite remote)',
    severity: 'medium',
  },
  {
    pattern: /\bgit\s+reset\s+--hard/,
    category: 'git-destructive',
    description: 'Hard reset (loses changes)',
    severity: 'medium',
  },
  {
    pattern: /\bgit\s+clean\s+-[dfx]/,
    category: 'git-destructive',
    description: 'Delete git untracked files',
    severity: 'medium',
  },
];

export function isDangerousCommand(command: string): {
  isDangerous: boolean;
  matches: DangerousPattern[];
} {
  const matches: DangerousPattern[] = [];

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (dangerous.pattern.test(command)) {
      matches.push(dangerous);
    }
  }

  return {
    isDangerous: matches.length > 0,
    matches,
  };
}

export function getHighestSeverity(patterns: DangerousPattern[]): 'critical' | 'high' | 'medium' | 'safe' {
  if (patterns.length === 0) return 'safe';

  const severities = patterns.map(p => p.severity);
  if (severities.includes('critical')) return 'critical';
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'safe';
}

export function formatDangerousWarning(patterns: DangerousPattern[]): string {
  if (patterns.length === 0) return '';

  const severity = getHighestSeverity(patterns);
  const descriptions = [...new Set(patterns.map(p => p.description))];

  return `⚠️  Dangerous command detected (${severity}):\n${descriptions.map(d => `   • ${d}`).join('\n')}`;
}
