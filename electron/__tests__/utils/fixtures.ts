/**
 * Fixture utilities for recording and replaying API responses
 * 
 * TEST_MODE environment variable controls behavior:
 * - 'record': Make real API calls and save responses to fixtures
 * - 'replay': Use saved fixtures (default)
 * - 'live': Always make real API calls (no recording)
 */

import * as fs from 'fs'
import * as path from 'path'

const FIXTURES_DIR = path.join(__dirname, '../fixtures')

export type TestMode = 'record' | 'replay' | 'live'

export function getTestMode(): TestMode {
  const mode = process.env.TEST_MODE?.toLowerCase()
  if (mode === 'record' || mode === 'live') return mode
  return 'replay'
}

/**
 * Ensure fixtures directory exists
 */
export function ensureFixturesDir(): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true })
  }
}

/**
 * Get path to a fixture file
 */
export function getFixturePath(name: string): string {
  ensureFixturesDir()
  return path.join(FIXTURES_DIR, `${name}.json`)
}

/**
 * Save a fixture to disk
 */
export function saveFixture(name: string, data: any): void {
  const fixturePath = getFixturePath(name)
  fs.writeFileSync(fixturePath, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`[Fixture] Saved: ${name}`)
}

/**
 * Load a fixture from disk
 */
export function loadFixture<T = any>(name: string): T {
  const fixturePath = getFixturePath(name)
  
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Fixture not found: ${name}\n` +
      `Path: ${fixturePath}\n` +
      `Run tests with TEST_MODE=record to create fixtures.`
    )
  }
  
  const content = fs.readFileSync(fixturePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Check if a fixture exists
 */
export function fixtureExists(name: string): boolean {
  return fs.existsSync(getFixturePath(name))
}

/**
 * Delete a fixture (useful for forcing re-recording)
 */
export function deleteFixture(name: string): void {
  const fixturePath = getFixturePath(name)
  if (fs.existsSync(fixturePath)) {
    fs.unlinkSync(fixturePath)
    console.log(`[Fixture] Deleted: ${name}`)
  }
}

/**
 * Wrapper for async functions that supports record/replay
 * 
 * @param fixtureName - Name of the fixture file (without .json)
 * @param fn - Async function to execute (makes real API call)
 * @returns Result from fixture or real call
 */
export async function withFixture<T>(
  fixtureName: string,
  fn: () => Promise<T>
): Promise<T> {
  const mode = getTestMode()
  
  if (mode === 'live') {
    // Always make real API call
    return await fn()
  }
  
  if (mode === 'replay') {
    // Use saved fixture
    if (!fixtureExists(fixtureName)) {
      throw new Error(
        `Fixture not found: ${fixtureName}\n` +
        `Run tests with TEST_MODE=record to create this fixture.`
      )
    }
    return loadFixture<T>(fixtureName)
  }
  
  // mode === 'record'
  // Make real API call and save result
  const result = await fn()
  saveFixture(fixtureName, result)
  return result
}

