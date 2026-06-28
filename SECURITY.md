# Security Policy

## Automated Security Measures

This repository implements comprehensive security scanning to protect user data confidentiality and prevent malicious code.

### GitHub Actions Security Workflows

#### 1. Security Vulnerability Scanning (`.github/workflows/security-scan.yml`)

Runs on: Push to main, Pull Requests, Daily at 2 AM UTC

**Scans:**
- ✅ **Dependency Vulnerability Scan** - npm audit for vulnerable packages
- ✅ **CodeQL Analysis** - Advanced security pattern detection
- ✅ **Malware & Backdoor Detection** - Custom pattern matching for:
  - Tracking/telemetry code
  - Data exfiltration attempts
  - Base64 obfuscation
  - eval() usage
  - Credential harvesting
  - Cryptocurrency mining
- ✅ **Secret Scanning** - TruffleHog for exposed credentials
- ✅ **Supply Chain Security** - Dependency confusion attacks
- ✅ **License Compliance** - Blocks GPL licenses
- ✅ **Static Code Analysis** - Hardcoded secrets detection

#### 2. PR Security Checks (`.github/workflows/pr-security-checks.yml`)

Runs on: All Pull Requests

**Checks:**
- ✅ **Dependency Review** - Blocks vulnerable dependencies
- ✅ **Code Diff Analysis** - Detects suspicious changes:
  - New network calls
  - File system operations
  - Environment variable access
- ✅ **Permission Changes** - Alerts on permission system modifications
- ✅ **Backdoor Detection** - Advanced pattern matching:
  - Obfuscated code (hex/unicode escapes)
  - Delayed execution (setTimeout/setInterval)
  - WebSocket connections (unusual for CLI)
  - Command injection risks
- ✅ **Data Exfiltration Prevention** - Blocks:
  - File uploads
  - Clipboard access
  - Screenshot/screen capture
  - System information gathering

---

## What We Protect Against

### 🛡️ Tracking & Telemetry
- No analytics
- No phone-home
- No usage tracking
- No crash reporting without consent

### 🛡️ Data Exfiltration
- No unauthorized network requests
- No credential harvesting
- No file uploads to external servers
- No clipboard access

### 🛡️ Backdoors & Malware
- No obfuscated code
- No eval() usage
- No cryptocurrency mining
- No remote code execution

### 🛡️ Supply Chain Attacks
- Dependency vulnerability scanning
- License compliance checks
- Dependency confusion protection
- Package integrity verification

---

## Branch Protection

**Main branch is protected:**
- ✅ Requires PR for all changes
- ✅ Requires 1 approving review
- ✅ Requires linear history (no merge commits)
- ✅ Blocks force pushes
- ✅ Blocks branch deletion

**All code changes must:**
1. Pass all security scans
2. Pass CodeQL analysis
3. Pass dependency review
4. Be reviewed by maintainer
5. Have no detected vulnerabilities

---

## Reporting Security Vulnerabilities

If you discover a security vulnerability, please report it via:

**Email:** security@os-santiago.com (preferred)  
**GitHub:** [Create a private security advisory](https://github.com/os-santiago/sc-agent-cli/security/advisories/new)

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Response time:**
- Critical: 24 hours
- High: 72 hours
- Medium: 1 week
- Low: 2 weeks

---

## Security Best Practices for Contributors

### ✅ DO:
- Use environment variables for sensitive data
- Validate all user input
- Use parameterized queries
- Follow principle of least privilege
- Document security assumptions
- Add tests for security fixes

### ❌ DON'T:
- Hardcode credentials or API keys
- Use eval() or new Function()
- Disable security features
- Add external dependencies without review
- Bypass permission checks
- Add tracking/telemetry code

---

## Dependency Management

**All dependencies must:**
- Be from npm registry (no git/http sources)
- Have Apache 2.0, MIT, BSD, or ISC license
- Pass npm audit (no high/critical vulnerabilities)
- Be reviewed for necessity

**Blocked licenses:**
- GPL-2.0, GPL-3.0 (copyleft)
- AGPL-3.0 (copyleft)
- Proprietary/Commercial

---

## Secrets Management

**Never commit:**
- API keys
- Access tokens
- Passwords
- Private keys
- Database credentials
- OAuth secrets

**GitHub Secret Scanning is enabled:**
- Blocks pushes with detected secrets
- Alerts on exposed credentials
- Requires resolution before merge

---

## Security Audit Trail

All security-related changes are logged:
- GitHub Actions workflow runs
- CodeQL scan results
- Dependency review results
- Secret scanning alerts
- Branch protection events

**View audit logs:**
- https://github.com/os-santiago/sc-agent-cli/security
- https://github.com/os-santiago/sc-agent-cli/actions

---

## Compliance

This project implements:
- ✅ OWASP Top 10 protections
- ✅ CWE/SANS Top 25 mitigations
- ✅ NIST Cybersecurity Framework alignment
- ✅ Secure Software Development Lifecycle (SSDLC)

---

## Versioning

Security fixes are released as:
- **Patch** (x.x.1) - Low severity
- **Minor** (x.1.0) - Medium severity
- **Major** (1.0.0) - High/Critical severity

**Update policy:**
- Security patches released within 7 days
- Critical fixes released within 24 hours
- All releases published to GitHub Releases

---

## License

Security measures and policies are part of this project's Apache 2.0 license.

Copyright 2024-2026 Sergio Canales

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
- [npm Security Guidelines](https://docs.npmjs.com/packages-and-modules/securing-your-code)

---

**Last Updated:** 2026-06-28  
**Security Policy Version:** 1.0
