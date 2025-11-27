export function computeLineDelta(before?: string, after?: string): { added: number; removed: number } {
    const a = (before ?? '').split(/\r?\n/)
    const b = (after ?? '').split(/\r?\n/)
    const n = a.length
    const m = b.length
    if (n === 0 && m === 0) return { added: 0, removed: 0 }
    const LIMIT = 1_000_000
    if (n * m > LIMIT) {
        let i = 0, j = 0
        while (i < n && j < m && a[i] === b[j]) { i++; j++ }
        return { added: (m - j), removed: (n - i) }
    }
    let prev = new Uint32Array(m + 1)
    let curr = new Uint32Array(m + 1)
    for (let i = 1; i <= n; i++) {
        const ai = a[i - 1]
        for (let j = 1; j <= m; j++) {
            curr[j] = ai === b[j - 1] ? (prev[j - 1] + 1) : (prev[j] > curr[j - 1] ? prev[j] : curr[j - 1])
        }
        const tmp = prev; prev = curr; curr = tmp
        curr.fill(0)
    }
    const lcs = prev[m]
    return { added: m - lcs, removed: n - lcs }
}
