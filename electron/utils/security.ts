/**
 * Security utilities for the Electron main process
 * 
 * Provides output redaction and command risk assessment
 */

import type { CommandRiskAssessment } from '../types'

/**
 * Redact sensitive information from terminal output
 * 
 * @param input - Raw terminal output
 * @returns Redacted output and number of bytes redacted
 */
export function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  // Conservative default patterns for common secrets
  const patterns: RegExp[] = [
    /(?:sk|rk|pk|ak)-[A-Za-z0-9]{16,}/g, // generic key-like patterns
    /Bearer\s+[A-Za-z0-9\-_.=]+/gi, // Bearer tokens
    /AWS_ACCESS_KEY_ID=[A-Z0-9]{16,}/g, // AWS access keys
    /AWS_SECRET_ACCESS_KEY=[A-Za-z0-9\/+=]{32,}/g, // AWS secret keys
    /(?:(?:xox[pbar]|slack)-)[A-Za-z0-9-]{10,}/g, // Slack tokens
    /AIza[0-9A-Za-z\-_]{35}/g, // Google API keys
    /"?password"?\s*[:=]\s*"?[^\s"']{6,}"?/gi, // Password assignments
    /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH) PRIVATE KEY-----/g, // Private keys
  ]
  
  let redacted = input
  const beforeLen = input.length
  
  for (const re of patterns) {
    redacted = redacted.replace(re, '[REDACTED]')
  }
  
  return {
    redacted,
    bytesRedacted: Math.max(0, beforeLen - redacted.length)
  }
}

/**
 * Assess whether a command is risky and requires user approval
 * 
 * @param cmd - Command to assess
 * @returns Risk assessment result
 */
export function isRiskyCommand(cmd: string): CommandRiskAssessment {
  const c = cmd.trim()
  
  const checks: Array<{ re: RegExp; reason: string }> = [
    { re: /\b(pnpm|npm|yarn)\s+install\b/i, reason: 'package install' },
    { re: /\b(pip|pip3)\s+install\b/i, reason: 'pip install' },
    { re: /\brm\s+-rf\b/i, reason: 'remove recursively' },
    { re: /\brimraf\b/i, reason: 'rimraf' },
    { re: /\bdel\b.*\/(s|q)/i, reason: 'windows delete recursive' },
    { re: /\b(prisma)\s+migrate\b/i, reason: 'database migration' },
    { re: /\balembic\s+(upgrade|downgrade)\b/i, reason: 'alembic migration' },
    { re: /\bgit\s+push\s+--force\b/i, reason: 'force push' },
    { re: /\bdocker\s+compose\s+down\b.*-v/i, reason: 'docker remove volumes' },
    { re: /\bkubectl\s+delete\b/i, reason: 'k8s delete' },
  ]
  
  for (const ch of checks) {
    if (ch.re.test(c)) {
      return { risky: true, reason: ch.reason }
    }
  }
  
  return { risky: false }
}

