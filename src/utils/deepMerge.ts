/**
 * Deep merge utility for configuration objects
 * Preserves arrays and deeply merges nested objects
 */

type PlainObject = { [key: string]: any };

/**
 * Check if value is a plain object (not array, null, or other types)
 */
function isPlainObject(value: unknown): value is PlainObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

/**
 * Deep merge two objects
 * - Objects are merged recursively
 * - Arrays are concatenated (target + source)
 * - Primitives from source override target
 * - Functions from source override target
 */
export function deepMerge<T extends PlainObject>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) {
      // Skip undefined values from source
      continue;
    }

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      // For arrays, concatenate and remove duplicates
      result[key] = [...new Set([...targetValue, ...sourceValue])] as any;
    } else if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      // Recursively merge objects
      result[key] = deepMerge(targetValue, sourceValue) as any;
    } else {
      // Primitives, functions, and other types: source overrides target
      result[key] = sourceValue as any;
    }
  }

  return result;
}

/**
 * Deep merge with security-aware strategy
 * Ensures security-critical settings are never weakened
 */
export function secureDeepMerge<T extends PlainObject>(
  defaultConfig: T,
  userConfig: Partial<T>,
  securityKeys: string[] = []
): T {
  const result = deepMerge(defaultConfig, userConfig);

  // For security-critical keys, use the most restrictive value
  for (const keyPath of securityKeys) {
    const keys = keyPath.split('.');
    let defaultValue: any = defaultConfig;
    let userValue: any = userConfig;
    let resultValue: any = result;

    // Navigate to the nested value
    for (let i = 0; i < keys.length - 1; i++) {
      defaultValue = defaultValue?.[keys[i]];
      userValue = userValue?.[keys[i]];
      resultValue = resultValue?.[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    const defaultVal = defaultValue?.[lastKey];
    const userVal = userValue?.[lastKey];

    if (defaultVal !== undefined && userVal !== undefined && resultValue) {
      // For boolean flags, use logical AND (both must be true)
      if (typeof defaultVal === 'boolean' && typeof userVal === 'boolean') {
        resultValue[lastKey] = defaultVal && userVal;
      }
      // For numbers, use the smaller value (more restrictive)
      else if (typeof defaultVal === 'number' && typeof userVal === 'number') {
        resultValue[lastKey] = Math.min(defaultVal, userVal);
      }
      // For arrays, keep both (union)
      else if (Array.isArray(defaultVal) && Array.isArray(userVal)) {
        resultValue[lastKey] = [...new Set([...defaultVal, ...userVal])];
      }
    }
  }

  return result;
}
