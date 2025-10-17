/**
 * Mock for electron-store
 * Used in tests to avoid ESM import issues
 */

class MockStore {
  private _data: Map<string, any> = new Map()

  constructor(_options?: any) {
    // Mock constructor
  }

  get(key: string, defaultValue?: any): any {
    return this._data.has(key) ? this._data.get(key) : defaultValue
  }

  set(key: string, value: any): void {
    this._data.set(key, value)
  }

  has(key: string): boolean {
    return this._data.has(key)
  }

  delete(key: string): void {
    this._data.delete(key)
  }

  clear(): void {
    this._data.clear()
  }

  get size(): number {
    return this._data.size
  }

  get store(): Record<string, any> {
    const obj: Record<string, any> = {}
    this._data.forEach((value, key) => {
      obj[key] = value
    })
    return obj
  }

  set store(value: Record<string, any>) {
    this._data.clear()
    Object.entries(value).forEach(([key, val]) => {
      this._data.set(key, val)
    })
  }
}

export default MockStore

