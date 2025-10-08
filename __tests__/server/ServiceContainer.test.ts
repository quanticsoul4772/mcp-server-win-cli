import { describe, test, expect, beforeEach } from '@jest/globals';
import { ServiceContainer } from '../../src/server/ServiceContainer.js';

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('Instance Registration', () => {
    test('should register and retrieve an instance', () => {
      const instance = { value: 42 };
      container.registerInstance('test', instance);

      const retrieved = container.get<typeof instance>('test');
      expect(retrieved).toBe(instance);
      expect(retrieved.value).toBe(42);
    });

    test('should throw when registering duplicate instance', () => {
      container.registerInstance('test', {});
      expect(() => container.registerInstance('test', {})).toThrow('already registered');
    });
  });

  describe('Singleton Registration', () => {
    test('should create singleton instance on first access', () => {
      let callCount = 0;
      container.registerSingleton('singleton', () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.get<{ id: number }>('singleton');
      const second = container.get<{ id: number }>('singleton');

      expect(callCount).toBe(1); // Factory called only once
      expect(first).toBe(second); // Same instance returned
      expect(first.id).toBe(1);
    });

    test('should throw when registering duplicate singleton', () => {
      container.registerSingleton('test', () => ({}));
      expect(() => container.registerSingleton('test', () => ({}))).toThrow('already registered');
    });
  });

  describe('Transient Registration', () => {
    test('should create new instance on each access', () => {
      let callCount = 0;
      container.registerTransient('transient', () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.get<{ id: number }>('transient');
      const second = container.get<{ id: number }>('transient');

      expect(callCount).toBe(2); // Factory called twice
      expect(first).not.toBe(second); // Different instances
      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });

    test('should throw when registering duplicate transient', () => {
      container.registerTransient('test', () => ({}));
      expect(() => container.registerTransient('test', () => ({}))).toThrow('already registered');
    });
  });

  describe('Service Retrieval', () => {
    test('should throw when service not found', () => {
      expect(() => container.get('nonexistent')).toThrow('not found');
    });

    test('should check if service exists', () => {
      expect(container.hasService('test')).toBe(false);

      container.registerInstance('test', {});
      expect(container.hasService('test')).toBe(true);
    });

    test('should return undefined for tryGet when service not found', () => {
      const result = container.tryGet('nonexistent');
      expect(result).toBeUndefined();
    });

    test('should return service for tryGet when service exists', () => {
      const instance = { value: 42 };
      container.registerInstance('test', instance);

      const result = container.tryGet<typeof instance>('test');
      expect(result).toBe(instance);
    });
  });

  describe('getOrCreate', () => {
    test('should create service if not exists', () => {
      const service = container.getOrCreate('new', () => ({ value: 123 }));
      expect(service.value).toBe(123);
      expect(container.hasService('new')).toBe(true);
    });

    test('should return existing service if already registered', () => {
      const original = { value: 1 };
      container.registerInstance('existing', original);

      const retrieved = container.getOrCreate('existing', () => ({ value: 2 }));
      expect(retrieved).toBe(original);
      expect(retrieved.value).toBe(1); // Original value, not factory value
    });
  });

  describe('Management', () => {
    test('should list all service names', () => {
      container.registerInstance('instance1', {});
      container.registerSingleton('singleton1', () => ({}));
      container.registerTransient('transient1', () => ({}));

      const names = container.getServiceNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('instance1');
      expect(names).toContain('singleton1');
      expect(names).toContain('transient1');
    });

    test('should clear singleton instances', () => {
      let callCount = 0;
      container.registerSingleton('test', () => {
        callCount++;
        return { id: callCount };
      });

      const first = container.get<{ id: number }>('test');
      expect(callCount).toBe(1);
      expect(first.id).toBe(1);

      container.clearSingletons();

      const second = container.get<{ id: number }>('test');
      expect(callCount).toBe(2); // Factory called again
      expect(second.id).toBe(2);
    });

    test('should clear all registrations', () => {
      container.registerInstance('instance', {});
      container.registerSingleton('singleton', () => ({}));
      container.registerTransient('transient', () => ({}));

      expect(container.getServiceNames()).toHaveLength(3);

      container.clear();

      expect(container.getServiceNames()).toHaveLength(0);
      expect(container.hasService('instance')).toBe(false);
      expect(container.hasService('singleton')).toBe(false);
      expect(container.hasService('transient')).toBe(false);
    });
  });

  describe('Type Safety', () => {
    test('should work with typed services', () => {
      interface ILogger {
        log(message: string): void;
      }

      class ConsoleLogger implements ILogger {
        log(message: string): void {
          console.log(message);
        }
      }

      container.registerSingleton<ILogger>('logger', () => new ConsoleLogger());

      const logger = container.get<ILogger>('logger');
      expect(typeof logger.log).toBe('function');
    });
  });
});
