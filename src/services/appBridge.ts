export async function setAppView(view: string): Promise<void> {
  try {
    await window.ipcRenderer?.invoke('app:set-view', view as any)
  } catch {
    // ignore
  }
}

