export async function setAppView(view: string): Promise<void> {
  try {
    await window.app?.setView?.(view as any)
  } catch {
    // ignore
  }
}

