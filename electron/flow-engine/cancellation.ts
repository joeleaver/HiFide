export function isCancellationError(error: unknown): boolean {
  if (!error) {
    return false
  }

  const message = typeof error === 'object' && error !== null
    ? ((error as any).message ?? ((error as any).toString ? (error as any).toString() : ''))
    : String(error)

  return (
    (typeof error === 'object' && error !== null && (error as any).name === 'AbortError') ||
    /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(String(message))
  )
}
