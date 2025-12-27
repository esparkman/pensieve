/**
 * Security utilities for Pensieve
 * Detects potential secrets and sensitive data
 */

// Patterns that indicate potential secrets
const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // API Keys (generic)
  { pattern: /\b[A-Za-z0-9_-]{20,}\b.*(?:api[_-]?key|apikey)/i, name: 'API key' },
  { pattern: /(?:api[_-]?key|apikey).*\b[A-Za-z0-9_-]{20,}\b/i, name: 'API key' },

  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/i, name: 'AWS Access Key ID' },
  { pattern: /\b[A-Za-z0-9/+=]{40}\b/i, name: 'Potential AWS Secret Key' },

  // GitHub
  { pattern: /ghp_[A-Za-z0-9]{36}/i, name: 'GitHub Personal Access Token' },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/i, name: 'GitHub Fine-grained PAT' },
  { pattern: /gho_[A-Za-z0-9]{36}/i, name: 'GitHub OAuth Token' },

  // Stripe
  { pattern: /sk_live_[A-Za-z0-9]{24,}/i, name: 'Stripe Secret Key' },
  { pattern: /sk_test_[A-Za-z0-9]{24,}/i, name: 'Stripe Test Key' },

  // Database URLs
  { pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/i, name: 'PostgreSQL connection string with password' },
  { pattern: /mysql:\/\/[^:]+:[^@]+@/i, name: 'MySQL connection string with password' },
  { pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/i, name: 'MongoDB connection string with password' },

  // Generic secrets
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/i, name: 'Password' },
  { pattern: /(?:secret|token)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i, name: 'Secret/Token' },
  { pattern: /bearer\s+[A-Za-z0-9_-]{20,}/i, name: 'Bearer token' },

  // Private keys
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i, name: 'Private key' },
  { pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/i, name: 'SSH Private key' },

  // Credit cards (basic pattern)
  { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/, name: 'Credit card number' },

  // SSN
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, name: 'Social Security Number' },
];

export interface SecretDetectionResult {
  containsSecret: boolean;
  warnings: string[];
}

/**
 * Check if text contains potential secrets
 */
export function detectSecrets(text: string): SecretDetectionResult {
  const warnings: string[] = [];

  for (const { pattern, name } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`Potential ${name} detected`);
    }
  }

  return {
    containsSecret: warnings.length > 0,
    warnings
  };
}

/**
 * Check multiple fields for secrets
 */
export function checkFieldsForSecrets(fields: Record<string, string | undefined>): SecretDetectionResult {
  const allWarnings: string[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (value) {
      const result = detectSecrets(value);
      if (result.containsSecret) {
        allWarnings.push(`In field "${fieldName}": ${result.warnings.join(', ')}`);
      }
    }
  }

  return {
    containsSecret: allWarnings.length > 0,
    warnings: allWarnings
  };
}

/**
 * Generate warning message for detected secrets
 */
export function formatSecretWarning(result: SecretDetectionResult): string {
  if (!result.containsSecret) return '';

  return `⚠️  SECURITY WARNING: Potential sensitive data detected!\n` +
    result.warnings.map(w => `   • ${w}`).join('\n') + '\n' +
    `\n   Pensieve stores data in plaintext. Do NOT store secrets, API keys,\n` +
    `   passwords, or other sensitive credentials. This data was NOT saved.`;
}
