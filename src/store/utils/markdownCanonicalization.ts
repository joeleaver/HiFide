export const MARKDOWN_CANONICALIZATION_WINDOW_MS = 1500

export function nextMarkdownCanonicalizationExpiry(now: number = Date.now()): number {
  return now + MARKDOWN_CANONICALIZATION_WINDOW_MS
}

export function shouldCanonicalizeMarkdownChange(
  tab: { isMarkdown: boolean; markdownCanonicalizationExpiry?: number | null; isDirty?: boolean },
  now: number = Date.now()
): boolean {
  if (!tab.isMarkdown) return false
  if (tab.isDirty) return false
  if (typeof tab.markdownCanonicalizationExpiry !== 'number') return false
  return now <= tab.markdownCanonicalizationExpiry
}
