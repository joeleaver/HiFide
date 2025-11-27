/**
 * Service Registry
 * 
 * Singleton registry for all services.
 * Provides dependency injection and service lookup.
 */

export class ServiceRegistry {
  private static instance: ServiceRegistry | null = null
  private services = new Map<string, any>()

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry()
    }
    return ServiceRegistry.instance
  }

  /**
   * Register a service
   */
  register<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      console.warn(`[ServiceRegistry] Service ${name} is already registered. Overwriting.`)
    }
    this.services.set(name, service)
  }

  /**
   * Get a service by name
   */
  get<T>(name: string): T {
    const service = this.services.get(name)
    if (!service) {
      throw new Error(`[ServiceRegistry] Service ${name} not found. Available services: ${Array.from(this.services.keys()).join(', ')}`)
    }
    return service as T
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name)
  }

  /**
   * Unregister a service
   */
  unregister(name: string): void {
    this.services.delete(name)
  }

  /**
   * Get all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Clear all services (useful for testing)
   */
  clear(): void {
    this.services.clear()
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    ServiceRegistry.instance = null
  }
}

