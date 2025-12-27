import { describe, it, expect } from 'vitest';
import { detectSecrets, checkFieldsForSecrets, formatSecretWarning } from '../security.js';

describe('Security: Secrets Detection', () => {
  describe('AWS Keys', () => {
    it('detects AWS Access Key ID', () => {
      const result = detectSecrets('My key is AKIAIOSFODNN7EXAMPLE');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('AWS'))).toBe(true);
    });

    it('detects AWS Access Key ID in context', () => {
      const result = detectSecrets('aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
      expect(result.containsSecret).toBe(true);
    });

    it('detects potential AWS Secret Key (40 char base64-like)', () => {
      const result = detectSecrets('secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(result.containsSecret).toBe(true);
    });
  });

  describe('GitHub Tokens', () => {
    it('detects GitHub Personal Access Token (classic)', () => {
      const result = detectSecrets('token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('GitHub'))).toBe(true);
    });

    it('detects GitHub Fine-grained PAT', () => {
      const result = detectSecrets('GITHUB_TOKEN=github_pat_11ABCDEFG_abcdefghijklmnopqrstuvwxyz');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('GitHub'))).toBe(true);
    });

    it('detects GitHub OAuth Token', () => {
      const result = detectSecrets('oauth: gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('GitHub'))).toBe(true);
    });
  });

  describe('Stripe Keys', () => {
    // Build test keys dynamically to avoid GitHub secret scanning
    const stripePrefix = 'sk_';
    const liveKey = stripePrefix + 'live_51ABCdefGHIjklMNOpqrSTUvwxyz';
    const testKey = stripePrefix + 'test_51ABCdefGHIjklMNOpqrSTUvwxyz';

    it('detects Stripe live secret key', () => {
      const result = detectSecrets(`STRIPE_SECRET_KEY=${liveKey}`);
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Stripe'))).toBe(true);
    });

    it('detects Stripe test secret key', () => {
      const result = detectSecrets(`stripe_key: ${testKey}`);
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Stripe'))).toBe(true);
    });
  });

  describe('Database Connection Strings', () => {
    it('detects PostgreSQL connection string with password', () => {
      const result = detectSecrets('DATABASE_URL=postgres://user:secretpassword@localhost:5432/mydb');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('PostgreSQL'))).toBe(true);
    });

    it('detects PostgreSQL connection string (postgresql://)', () => {
      const result = detectSecrets('postgresql://admin:p@ssw0rd@db.example.com/production');
      expect(result.containsSecret).toBe(true);
    });

    it('detects MySQL connection string with password', () => {
      const result = detectSecrets('mysql://root:supersecret@mysql.example.com:3306/app');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('MySQL'))).toBe(true);
    });

    it('detects MongoDB connection string with password', () => {
      const result = detectSecrets('mongodb://user:pass123@cluster.mongodb.net/db');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('MongoDB'))).toBe(true);
    });

    it('detects MongoDB+srv connection string', () => {
      const result = detectSecrets('mongodb+srv://admin:secret@cluster0.abc123.mongodb.net/mydb');
      expect(result.containsSecret).toBe(true);
    });
  });

  describe('Bearer Tokens', () => {
    it('detects bearer token in Authorization header format', () => {
      const result = detectSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Bearer'))).toBe(true);
    });

    it('detects bearer token inline', () => {
      const result = detectSecrets('Use bearer abc123def456ghi789jkl012mno345');
      expect(result.containsSecret).toBe(true);
    });
  });

  describe('Private Keys', () => {
    it('detects RSA private key header', () => {
      const result = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Private key'))).toBe(true);
    });

    it('detects generic private key header', () => {
      const result = detectSecrets('-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG');
      expect(result.containsSecret).toBe(true);
    });

    it('detects OpenSSH private key header', () => {
      const result = detectSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1r');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('SSH'))).toBe(true);
    });
  });

  describe('Generic Secrets', () => {
    it('detects password assignments', () => {
      const result = detectSecrets('password = "mySuperSecretPass123"');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Password'))).toBe(true);
    });

    it('detects password with colon separator', () => {
      const result = detectSecrets('password: verysecretpassword');
      expect(result.containsSecret).toBe(true);
    });

    it('detects secret/token assignments', () => {
      const result = detectSecrets('api_secret = "abcdef1234567890abcdef"');
      expect(result.containsSecret).toBe(true);
    });

    it('detects API key patterns', () => {
      const result = detectSecrets('My api_key is abc123def456ghi789jkl');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('API key'))).toBe(true);
    });
  });

  describe('Credit Card Numbers', () => {
    it('detects Visa card number', () => {
      const result = detectSecrets('Card: 4111111111111111');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Credit card'))).toBe(true);
    });

    it('detects Mastercard number', () => {
      const result = detectSecrets('Payment with 5500000000000004');
      expect(result.containsSecret).toBe(true);
    });

    it('detects American Express number', () => {
      const result = detectSecrets('Amex: 378282246310005');
      expect(result.containsSecret).toBe(true);
    });
  });

  describe('Social Security Numbers', () => {
    it('detects SSN format (XXX-XX-XXXX)', () => {
      const result = detectSecrets('SSN: 123-45-6789');
      expect(result.containsSecret).toBe(true);
      expect(result.warnings.some(w => w.includes('Social Security'))).toBe(true);
    });
  });

  describe('Safe Content (No False Positives)', () => {
    it('does not flag normal text', () => {
      const result = detectSecrets('We decided to use PostgreSQL for the database');
      expect(result.containsSecret).toBe(false);
    });

    it('does not flag code patterns', () => {
      const result = detectSecrets('function getUser(id: string) { return users[id]; }');
      expect(result.containsSecret).toBe(false);
    });

    it('does not flag short strings', () => {
      const result = detectSecrets('key = "abc"');
      expect(result.containsSecret).toBe(false);
    });

    it('does not flag file paths', () => {
      const result = detectSecrets('Located at /app/components/user_component.rb');
      expect(result.containsSecret).toBe(false);
    });

    it('does not flag database connection without password', () => {
      const result = detectSecrets('postgres://localhost:5432/mydb');
      expect(result.containsSecret).toBe(false);
    });

    it('does not flag UUIDs', () => {
      const result = detectSecrets('id: 550e8400-e29b-41d4-a716-446655440000');
      expect(result.containsSecret).toBe(false);
    });
  });
});

describe('Security: checkFieldsForSecrets', () => {
  // Build test key dynamically to avoid GitHub secret scanning
  const stripeKey = 'sk_' + 'live_51ABCdefGHIjklMNOpqrSTUvwxyz';

  it('checks multiple fields and reports which field contains secret', () => {
    const result = checkFieldsForSecrets({
      topic: 'authentication',
      decision: `Use API key: ${stripeKey}`,
      rationale: 'It works well',
    });
    expect(result.containsSecret).toBe(true);
    expect(result.warnings.some(w => w.includes('decision'))).toBe(true);
  });

  it('returns no warnings for safe content', () => {
    const result = checkFieldsForSecrets({
      topic: 'database',
      decision: 'Use PostgreSQL',
      rationale: 'Better for our use case',
    });
    expect(result.containsSecret).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles undefined and null values', () => {
    const result = checkFieldsForSecrets({
      topic: 'test',
      decision: undefined,
      rationale: undefined,
    });
    expect(result.containsSecret).toBe(false);
  });
});

describe('Security: formatSecretWarning', () => {
  it('formats warning message with detected secrets', () => {
    const result = detectSecrets('password: secret123456');
    const message = formatSecretWarning(result);

    expect(message).toContain('SECURITY WARNING');
    expect(message).toContain('NOT saved');
    expect(message).toContain('Password');
  });

  it('returns empty string for safe content', () => {
    const result = detectSecrets('normal text here');
    const message = formatSecretWarning(result);
    expect(message).toBe('');
  });
});
