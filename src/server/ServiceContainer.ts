/**
 * Lightweight Dependency Injection Container
 *
 * Provides service registration and resolution with:
 * - Singleton lifecycle (one instance shared across application)
 * - Transient lifecycle (new instance on each request)
 * - Instance registration (pre-created instances)
 * - Factory functions for lazy initialization
 * - Type-safe service retrieval
 *
 * @example
 * ```typescript
 * const container = new ServiceContainer();
 *
 * // Register singleton service
 * container.registerSingleton('config', () => new ConfigManager());
 *
 * // Register transient service
 * container.registerTransient('validator', () => new CommandValidator());
 *
 * // Register instance
 * container.registerInstance('logger', console);
 *
 * // Retrieve service
 * const config = container.get<ConfigManager>('config');
 * ```
 */
export class ServiceContainer {
  private singletons: Map<string, any> = new Map();
  private transients: Map<string, () => any> = new Map();
  private instances: Map<string, any> = new Map();

  /**
   * Register a singleton service with lazy initialization
   * The factory function is called once on first request, then cached
   *
   * @param name - Unique service identifier
   * @param factory - Function that creates the service instance
   */
  registerSingleton<T>(name: string, factory: () => T): void {
    if (this.hasService(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }
    this.singletons.set(name, { factory, instance: null });
  }

  /**
   * Register a transient service that creates new instance on each request
   * The factory function is called every time get() is called
   *
   * @param name - Unique service identifier
   * @param factory - Function that creates new service instances
   */
  registerTransient<T>(name: string, factory: () => T): void {
    if (this.hasService(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }
    this.transients.set(name, factory);
  }

  /**
   * Register a pre-created instance
   * Useful for configuration objects or external dependencies
   *
   * @param name - Unique service identifier
   * @param instance - Pre-created service instance
   */
  registerInstance<T>(name: string, instance: T): void {
    if (this.hasService(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }
    this.instances.set(name, instance);
  }

  /**
   * Check if a service is registered under the given name
   *
   * @param name - Service identifier to check
   * @returns True if service exists, false otherwise
   */
  hasService(name: string): boolean {
    return this.instances.has(name) ||
           this.singletons.has(name) ||
           this.transients.has(name);
  }

  /**
   * Retrieve a service by name
   * - For instances: returns the registered instance
   * - For singletons: creates instance on first call, then returns cached
   * - For transients: creates new instance on every call
   *
   * @param name - Service identifier
   * @returns The service instance
   * @throws Error if service not found
   */
  get<T>(name: string): T {
    // Check instances first (fastest lookup)
    if (this.instances.has(name)) {
      return this.instances.get(name) as T;
    }

    // Check singletons
    if (this.singletons.has(name)) {
      const singleton = this.singletons.get(name);
      if (singleton.instance === null) {
        singleton.instance = singleton.factory();
      }
      return singleton.instance as T;
    }

    // Check transients
    if (this.transients.has(name)) {
      const factory = this.transients.get(name);
      if (factory) {
        return factory() as T;
      }
    }

    throw new Error(`Service '${name}' not found in container`);
  }

  /**
   * Try to get a service, return undefined if not found
   * Useful for optional dependencies
   *
   * @param name - Service identifier
   * @returns The service instance or undefined
   */
  tryGet<T>(name: string): T | undefined {
    try {
      return this.get<T>(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Get or create a service with provided factory
   * Useful for optional services with defaults
   *
   * @param name - Service identifier
   * @param factory - Factory function to use if service not registered
   * @returns The service instance
   */
  getOrCreate<T>(name: string, factory: () => T): T {
    if (!this.hasService(name)) {
      this.registerSingleton(name, factory);
    }
    return this.get<T>(name);
  }

  /**
   * Clear all singleton instances (useful for testing)
   * Transient and instance registrations are preserved
   */
  clearSingletons(): void {
    for (const [name, singleton] of this.singletons.entries()) {
      singleton.instance = null;
    }
  }

  /**
   * Clear all registrations (complete reset)
   */
  clear(): void {
    this.instances.clear();
    this.singletons.clear();
    this.transients.clear();
  }

  /**
   * Get list of all registered service names
   */
  getServiceNames(): string[] {
    return [
      ...Array.from(this.instances.keys()),
      ...Array.from(this.singletons.keys()),
      ...Array.from(this.transients.keys())
    ];
  }
}
