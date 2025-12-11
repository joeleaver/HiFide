export function uriToFsPath(uri?: string | null): string | null {
  if (!uri) return null
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') return null
    let pathname = parsed.pathname || ''
    if (parsed.hostname && parsed.hostname !== 'localhost') {
      pathname = `//${parsed.hostname}${pathname}`
    }
    pathname = decodeURIComponent(pathname)
    if (/^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1)
    }
    return pathname.replace(/\\/g, '/')
  } catch {
    return null
  }
}
