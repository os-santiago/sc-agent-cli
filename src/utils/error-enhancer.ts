export type ErrorCategory = 'compatibility' | 'blocking' | 'expectable' | 'unknown';

export interface EnhancedError {
  summary: string;
  category: ErrorCategory;
  likelyCause: string;
  suggestions: string[];
  raw: string;
}

function classifyError(toolName: string, errorMsg: string): ErrorCategory {
  const lower = errorMsg.toLowerCase();

  // Compatibility: Windows-specific issues, missing POSIX commands
  const isCompatibility =
    lower.includes('is not recognized as an internal or external command') ||
    lower.includes('not recognized') ||
    (lower.includes('cannot find the path') && lower.includes('wsl')) ||
    lower.includes('the system cannot find the file specified') ||
    lower.includes('is not recognized') ||
    lower.includes('command not found') ||
    lower.includes('powershell') ||
    lower.includes('$psversiontable');

  if (isCompatibility) return 'compatibility';

  // Blocking: permission, access, syntax, critical failures
  const isBlocking =
    lower.includes('permission denied') ||
    (lower.includes('enoent') && toolName !== 'run_shell') ||
    lower.includes('syntax error') ||
    lower.includes('cannot read') ||
    lower.includes('access denied') ||
    lower.includes('eacces') ||
    lower.includes('eisdir');

  if (isBlocking) return 'blocking';

  // Expectable: command exit codes, not found, API errors, GitHub restrictions
  const isExpectable =
    lower.includes('command exited with code') ||
    lower.includes('not found') ||
    lower.includes('could not resolve to') ||
    lower.includes('graphql:') ||
    lower.includes('review can not approve') ||
    lower.includes('repository rule violations') ||
    lower.includes('waiting for code scanning') ||
    lower.includes('base branch policy prohibits') ||
    lower.includes('is not mergeable') ||
    lower.includes('failed to parse jq expression') ||
    lower.includes('accepts 1 arg') ||
    lower.includes('http 4') ||
    lower.includes('http 5') ||
    lower.includes('timeout') ||
    lower.includes('etimedout');

  if (isExpectable) return 'expectable';

  return 'unknown';
}

function getCompatibilitySuggestions(errorMsg: string, shellInfo?: string): string[] {
  const suggestions: string[] = [];

  if (errorMsg.includes('not recognized') || errorMsg.includes('command not found')) {
    suggestions.push(`The command is not available on this platform. Try an alternative.`);
    if (shellInfo === 'cmd') {
      suggestions.push('Running in CMD. Use CMD-native commands: dir, type, find, findstr');
      suggestions.push('PowerShell commands (Get-ChildItem, $variable) need wrapper: powershell -Command "..."');
      suggestions.push('Check tool installation: where <command>');
      suggestions.push('For JSON parsing in CMD: use the built-in tools (read_file, search_text) or pipe through powershell -Command "Get-Content file.json | ConvertFrom-Json"');
    } else if (shellInfo === 'powershell') {
      suggestions.push('Running in PowerShell. Use: Get-ChildItem (dir), Get-Content (cat/type), Select-String (grep)');
      suggestions.push('POSIX commands (ls, grep, head) may not be available');
      suggestions.push('Check tool installation: Get-Command <command>');
    } else if (shellInfo?.includes('git-bash')) {
      suggestions.push('POSIX commands work: ls, cat, grep, find, sed, awk');
      suggestions.push('Check tool installation: which <command> or where <command>');
    } else if (shellInfo === 'bash' || shellInfo === 'wsl') {
      suggestions.push('POSIX commands available. Check tool installation: which <command>');
    }
  }

  // PowerShell command executed in CMD (missing -Command wrapper)
  if (errorMsg.includes('$psversiontable') || (errorMsg.includes('$') && errorMsg.includes('not recognized'))) {
    suggestions.push('This looks like a PowerShell command run in CMD.');
    suggestions.push('Prefix with: powershell -Command "$command"');
    suggestions.push('Example: powershell -Command "$PSVersionTable.PSVersion"');
  }

  if (errorMsg.includes('wsl') && (errorMsg.includes('pipe') || errorMsg.includes('|'))) {
    suggestions.push('WSL pipes execute in Windows shell, not inside WSL. Use: wsl bash -c "command | pipe"');
  }

  if (errorMsg.includes('cannot find the path') || errorMsg.includes('no such file')) {
    suggestions.push('Verify the file path exists. Use list_dir to check available files.');
  }

  if (suggestions.length === 0) {
    suggestions.push('Try a different approach or tool to achieve the same goal.');
    suggestions.push('Use run_shell to check what tools are available (e.g., "where node", "node --version").');
  }

  return suggestions;
}

function getBlockingSuggestions(toolName: string, errorMsg: string): string[] {
  const suggestions: string[] = [];

  if (errorMsg.includes('permission denied') || errorMsg.includes('access denied') || errorMsg.includes('eacces')) {
    suggestions.push('The tool lacks permissions to access this resource.');
    suggestions.push('Try a different file path or check file permissions.');
    if (toolName === 'run_shell') {
      suggestions.push('The command may need administrator privileges. Suggest the user run it manually.');
    }
  }

  if (errorMsg.includes('enoent') && toolName !== 'run_shell') {
    suggestions.push('The specified file or directory was not found.');
    suggestions.push('Use list_dir to list available files in the parent directory.');
    suggestions.push('Verify the path is correct and the file exists before retrying.');
  }

  if (errorMsg.includes('syntax error') || errorMsg.includes('cannot read')) {
    suggestions.push('There may be a format or encoding issue with the file.');
    suggestions.push('Try reading the file first to verify its contents are valid.');
  }

  if (suggestions.length === 0) {
    suggestions.push('This error prevents the operation from continuing. Try a different approach.');
  }

  return suggestions;
}

function getExpectableSuggestions(toolName: string, errorMsg: string): string[] {
  const suggestions: string[] = [];

  if (errorMsg.includes('command exited with code')) {
    suggestions.push('The shell command returned a non-zero exit code. Review the command output for details.');
    suggestions.push('Check if the command syntax is correct or if required tools are installed.');
  }

  if (errorMsg.includes('Unknown JSON field')) {
    suggestions.push('You specified an invalid field for --json in GitHub CLI. Review the printed "Available fields" list in the error message.');
    suggestions.push('Use one of the listed available fields. For review threads/comments, use "reviews" or "comments" instead.');
  }

  if (errorMsg.includes('not found') && toolName === 'run_shell') {
    suggestions.push('The command or tool is not installed. Try installing it or use an alternative approach.');
  }

  if (errorMsg.includes('timeout') || errorMsg.includes('etimedout')) {
    suggestions.push('The operation took too long. Try with a shorter scope or increase the timeout.');
  }

  if (errorMsg.includes('http 404')) {
    suggestions.push('The URL or resource was not found. Verify the URL is correct.');
  }

  if (errorMsg.includes('http 403') || errorMsg.includes('http 401')) {
    suggestions.push('Authentication or authorization failed. The resource may require credentials.');
  }

  if (errorMsg.includes('http 429')) {
    suggestions.push('Rate limit exceeded. Wait before retrying or reduce request frequency.');
  }

  if (errorMsg.includes('repository rule violations') || errorMsg.includes('base branch policy prohibits')) {
    suggestions.push('Branch protection rules prevented the operation. This is expected GitHub behavior.');
    suggestions.push('Use --auto flag to queue the merge when checks pass, or ask the user to override.');
  }

  if (errorMsg.includes('review can not approve')) {
    suggestions.push('This is a known GitHub restriction: you cannot approve your own pull request.');
    suggestions.push('Ask another reviewer to approve, or use a different GitHub account if available.');
  }

  if (errorMsg.includes('failed to parse jq expression') || errorMsg.includes('accepts 1 arg')) {
    suggestions.push('jq syntax error on Windows. Use double quotes instead of single quotes for jq expressions.');
    suggestions.push('Example: gh api ... --jq ".field"  (NOT: --jq \'.field\')');
  }

  if (errorMsg.includes('rebase-merge/head-name') || errorMsg.includes('rebase-merge')) {
    suggestions.push('The git repository has a corrupted empty rebase state. Delete the directory ".git/rebase-merge" to resolve this.');
    suggestions.push('Run: Remove-Item -Recurse -Force .git/rebase-merge (PowerShell) or rm -rf .git/rebase-merge (Bash).');
  }

  if (errorMsg.includes('refusing to fetch into branch') && errorMsg.includes('checked out at')) {
    suggestions.push('Git refuses to fetch directly into the currently checked-out branch.');
    suggestions.push('Try running "git fetch origin" to fetch updates globally, then merge or rebase them locally.');
  }

  if ((errorMsg.includes('select') || errorMsg.includes('head')) && errorMsg.includes('not recognized')) {
    suggestions.push('The "select" or "head" commands are not available in this shell.');
    suggestions.push('Retrieve the full command output directly, or use PowerShell\'s "Select-Object" or Bash\'s "head" instead.');
  }

  if (errorMsg.includes('ls') && errorMsg.includes('not recognized')) {
    suggestions.push('The "ls" command is not available in this Windows CMD environment.');
    suggestions.push('Use "dir" (CMD) or "Get-ChildItem" (PowerShell) to list directory contents.');
  }

  if (errorMsg.includes('Could not resolve to PullRequestReviewThread node') || errorMsg.includes('PRRC_')) {
    suggestions.push('To resolve a review thread in GitHub, you must use the thread ID (starts with "PRRT_") instead of the comment ID (starts with "PRRC_").');
    suggestions.push('Run a GraphQL query to retrieve the reviewThreads and their IDs for the PR, then call resolveReviewThread with the "PRRT_" ID.');
  }

  if (errorMsg.includes('resolved is not a permitted key') || errorMsg.includes('Update a review comment for a pull request')) {
    suggestions.push('The GitHub REST API does not support resolving threads directly via PATCH /pulls/comments.');
    suggestions.push('You must use the GitHub GraphQL API mutation "resolveReviewThread" with the thread ID (starts with "PRRT_").');
  }

  if (suggestions.length === 0) {
    suggestions.push('This is an expected error. Try a different approach or retry with adjusted parameters.');
  }

  return suggestions;
}

function getLikelyCause(toolName: string, errorMsg: string, category: ErrorCategory, shellInfo?: string): string {
  const lower = errorMsg.toLowerCase();

  if (category === 'compatibility') {
    if (lower.includes('not recognized') || lower.includes('command not found')) {
      if (shellInfo === 'cmd') {
        return 'The command does not exist on this platform. Running in Windows CMD where most POSIX/PowerShell commands are not available natively.';
      }
      return 'The command does not exist on this platform. POSIX commands (ls, head, tail, grep) are not available on Windows CMD.';
    }
    if (lower.includes('cannot find the path')) {
      return 'The system cannot find the specified path. This often happens with WSL path issues or incorrect file separators.';
    }
    if (lower.includes('$psversiontable') || lower.includes('powershell')) {
      return 'A PowerShell-specific command was executed in a non-PowerShell shell (CMD). PowerShell variables ($variable) and cmdlets are not available in CMD.';
    }
    return 'A platform compatibility issue occurred. The command or syntax is not supported in this environment.';
  }

  if (category === 'blocking') {
    if (lower.includes('permission denied') || lower.includes('access denied') || lower.includes('eacces')) {
      return 'The tool lacks the necessary permissions to access or modify the target resource.';
    }
    if (lower.includes('enoent')) {
      return 'The specified file or directory does not exist at the given path.';
    }
    if (lower.includes('syntax error')) {
      return 'The input has a syntax error. This could be invalid JSON, malformed arguments, or incorrect command syntax.';
    }
    return 'A blocking error prevented the operation from completing.';
  }

  if (category === 'expectable') {
    if (lower.includes('command exited with code')) {
      return 'The shell command completed but returned a non-zero exit code, indicating a failure in the executed command itself.';
    }
    if (lower.includes('timeout')) {
      return 'The operation exceeded the maximum allowed time and was cancelled.';
    }
    if (lower.includes('404') || lower.includes('not found')) {
      return 'The requested resource does not exist. This is a normal condition (not a bug).';
    }
    return 'An expected operational error occurred.';
  }

  return 'An unexpected error occurred during tool execution.';
}

function getSummary(toolName: string, errorMsg: string, category: ErrorCategory): string {
  const prefix = category === 'compatibility' ? '⚠️ Platform Compatibility' :
                 category === 'blocking' ? '❌ Blocking Error' :
                 category === 'expectable' ? 'ℹ️ Expected Error' :
                 '⚠️ Error';

  // Extract the most relevant part: first line or first 120 chars
  const cleanMsg = errorMsg.split('\n')[0].substring(0, 120);
  return `[${prefix}] ${toolName}: ${cleanMsg}`;
}

export function enhanceError(
  toolName: string,
  errorMsg: string,
  shellInfo?: string
): EnhancedError {
  const category = classifyError(toolName, errorMsg);

  let suggestions: string[];
  switch (category) {
    case 'compatibility':
      suggestions = getCompatibilitySuggestions(errorMsg, shellInfo);
      break;
    case 'blocking':
      suggestions = getBlockingSuggestions(toolName, errorMsg);
      break;
    case 'expectable':
      suggestions = getExpectableSuggestions(toolName, errorMsg);
      break;
    default:
      suggestions = [
        'Review the error and try a different approach.',
        'If the problem persists, try breaking the task into smaller steps.',
      ];
  }

  return {
    summary: getSummary(toolName, errorMsg, category),
    category,
    likelyCause: getLikelyCause(toolName, errorMsg, category, shellInfo),
    suggestions,
    raw: errorMsg,
  };
}

export function formatEnhancedError(enhanced: EnhancedError): string {
  const lines: string[] = [];
  lines.push(`[ERROR] ${enhanced.summary}`);
  lines.push(`📋 Category: ${enhanced.category}`);
  lines.push(`🔍 Likely cause: ${enhanced.likelyCause}`);
  if (enhanced.suggestions.length > 0) {
    lines.push(`💡 Suggested actions:`);
    enhanced.suggestions.forEach(s => lines.push(`   • ${s}`));
  }
  return lines.join('\n');
}
