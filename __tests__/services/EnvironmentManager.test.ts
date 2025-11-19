import { describe, test, expect, beforeEach } from '@jest/globals';
import { EnvironmentManager } from '../../src/services/EnvironmentManager.js';

describe('EnvironmentManager', () => {
  describe('Environment Variable Validation', () => {
    let envManager: EnvironmentManager;

    beforeEach(() => {
      // Use default blocked vars
      envManager = new EnvironmentManager(
        null as any,
        EnvironmentManager.getDefaultBlockedEnvVars()
      );
    });

    describe('validateEnvVarName()', () => {
      test('should block known sensitive variables', () => {
        const sensitiveVars = ['AWS_SECRET_KEY', 'PASSWORD', 'API_KEY', 'TOKEN', 'SECRET'];

        for (const varName of sensitiveVars) {
          expect(() => {
            envManager.validateEnvVarName(varName);
          }).toThrow(/blocked/i);
        }
      });

      test('should block PATH variable by default', () => {
        expect(() => {
          envManager.validateEnvVarName('PATH');
        }).toThrow(/blocked/i);
      });

      test('should block LD_PRELOAD for security', () => {
        expect(() => {
          envManager.validateEnvVarName('LD_PRELOAD');
        }).toThrow(/blocked/i);
      });

      test('should allow safe variables', () => {
        const safeVars = ['PYTHONIOENCODING', 'PYTHONUTF8', 'NODE_ENV', 'DEBUG'];

        for (const varName of safeVars) {
          expect(() => {
            envManager.validateEnvVarName(varName);
          }).not.toThrow();
        }
      });

      test('should be case-insensitive', () => {
        expect(() => {
          envManager.validateEnvVarName('aws_secret_key');
        }).toThrow(/blocked/i);

        expect(() => {
          envManager.validateEnvVarName('AWS_SECRET_KEY');
        }).toThrow(/blocked/i);
      });

      test('should block variables containing blocked patterns', () => {
        expect(() => {
          envManager.validateEnvVarName('MY_API_KEY_VAR');
        }).toThrow(/blocked pattern/i);

        expect(() => {
          envManager.validateEnvVarName('CUSTOM_PASSWORD_STORE');
        }).toThrow(/blocked pattern/i);
      });
    });

    describe('validateEnvVarValue()', () => {
      test('should reject values with null bytes', () => {
        expect(() => {
          envManager.validateEnvVarValue('TEST', 'value\x00with\x00nulls');
        }).toThrow(/null bytes/i);
      });

      test('should reject values exceeding max length', () => {
        const longValue = 'a'.repeat(33000);

        expect(() => {
          envManager.validateEnvVarValue('TEST', longValue);
        }).toThrow(/exceeds maximum length/i);
      });

      test('should reject values with dangerous control characters', () => {
        expect(() => {
          envManager.validateEnvVarValue('TEST', 'value\x01with\x02control');
        }).toThrow(/control characters/i);
      });

      test('should allow values with newlines and tabs', () => {
        expect(() => {
          envManager.validateEnvVarValue('TEST', 'value\nwith\tnormal\nchars');
        }).not.toThrow();
      });

      test('should allow normal UTF-8 values', () => {
        expect(() => {
          envManager.validateEnvVarValue('TEST', 'utf-8');
        }).not.toThrow();

        expect(() => {
          envManager.validateEnvVarValue('TEST', 'Hello 世界');
        }).not.toThrow();
      });
    });

    describe('validateEnvVars()', () => {
      test('should reject too many variables', () => {
        const tooManyVars: Record<string, string> = {};
        for (let i = 0; i < 25; i++) {
          tooManyVars[`VAR_${i}`] = 'value';
        }

        expect(() => {
          envManager.validateEnvVars(tooManyVars);
        }).toThrow(/Too many environment variables/i);
      });

      test('should validate all names and values', () => {
        const vars = {
          GOOD_VAR: 'good',
          API_KEY: 'bad' // This should be blocked
        };

        expect(() => {
          envManager.validateEnvVars(vars);
        }).toThrow(/blocked/i);
      });

      test('should allow valid variables within limit', () => {
        const vars = {
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          NODE_ENV: 'production'
        };

        expect(() => {
          envManager.validateEnvVars(vars);
        }).not.toThrow();
      });
    });
  });

  describe('Allowlist Mode', () => {
    let envManager: EnvironmentManager;

    beforeEach(() => {
      // Create with allowlist
      envManager = new EnvironmentManager(
        null as any,
        EnvironmentManager.getDefaultBlockedEnvVars(),
        ['PYTHONIOENCODING', 'PYTHONUTF8', 'NODE_ENV'] // Allowlist
      );
    });

    test('should allow variables in allowlist', () => {
      expect(() => {
        envManager.validateEnvVarName('PYTHONIOENCODING');
      }).not.toThrow();

      expect(() => {
        envManager.validateEnvVarName('NODE_ENV');
      }).not.toThrow();
    });

    test('should reject variables not in allowlist', () => {
      expect(() => {
        envManager.validateEnvVarName('DEBUG');
      }).toThrow(/not in allowlist/i);

      expect(() => {
        envManager.validateEnvVarName('CUSTOM_VAR');
      }).toThrow(/not in allowlist/i);
    });

    test('should report allowlist mode correctly', () => {
      expect(envManager.isAllowlistMode()).toBe(true);
    });
  });

  describe('mergeEnvironmentVariables()', () => {
    let envManager: EnvironmentManager;

    beforeEach(() => {
      envManager = new EnvironmentManager(
        null as any,
        EnvironmentManager.getDefaultBlockedEnvVars()
      );
    });

    test('should merge shell defaults with user overrides', () => {
      const shellDefaults = { VAR1: 'default1', VAR2: 'default2' };
      const userOverrides = { VAR2: 'override2', VAR3: 'user3' };

      const merged = envManager.mergeEnvironmentVariables(shellDefaults, userOverrides);

      expect(merged['VAR1']).toBe('default1');
      expect(merged['VAR2']).toBe('override2');
      expect(merged['VAR3']).toBe('user3');
    });

    test('should include system environment variables', () => {
      const merged = envManager.mergeEnvironmentVariables();

      // Should include some system env vars
      expect(Object.keys(merged).length).toBeGreaterThan(0);
    });

    test('should give user overrides highest priority', () => {
      const systemValue = process.env.PATH;
      const merged = envManager.mergeEnvironmentVariables(
        { CUSTOM: 'shell' },
        { CUSTOM: 'user' }
      );

      expect(merged['CUSTOM']).toBe('user');
    });
  });

  describe('Static Helper Methods', () => {
    test('getDefaultBlockedEnvVars should return array with expected patterns', () => {
      const blocked = EnvironmentManager.getDefaultBlockedEnvVars();

      expect(blocked).toContain('AWS_SECRET_ACCESS_KEY');
      expect(blocked).toContain('DB_PASSWORD');
      expect(blocked).toContain('PATH');
      expect(blocked).toContain('LD_PRELOAD');
      expect(blocked.length).toBeGreaterThan(20);
    });

    test('getDefaultMaxCustomEnvVars should return 20', () => {
      expect(EnvironmentManager.getDefaultMaxCustomEnvVars()).toBe(20);
    });

    test('getDefaultMaxEnvVarValueLength should return 32768', () => {
      expect(EnvironmentManager.getDefaultMaxEnvVarValueLength()).toBe(32768);
    });
  });
});
