import type { GitLogCommit } from '../../../../shared/gitLog'

import { buildCommitGraphRows } from '../commitGraph'

function c(args: Partial<GitLogCommit> & { sha: string; parents?: string[] }): GitLogCommit {
  return {
    sha: args.sha,
    parents: args.parents ?? [],
    authorName: args.authorName ?? 'a',
    authorEmail: args.authorEmail ?? 'a@a',
    authorDateIso: args.authorDateIso ?? '2020-01-01T00:00:00Z',
    subject: args.subject ?? args.sha,
    body: args.body ?? '',
    refs: args.refs,
  }
}

describe('buildCommitGraphRows', () => {
  it('assigns a stable single lane for a linear history', () => {
    const commits: GitLogCommit[] = [c({ sha: 'c3', parents: ['c2'] }), c({ sha: 'c2', parents: ['c1'] }), c({ sha: 'c1' })]
    const rows = buildCommitGraphRows(commits)

    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.lanesCount)).toEqual([1, 1, 1])
    expect(rows.every((r) => r.connectors.length >= 1)).toBe(true)
  })

  it('creates additional lanes for merge commits', () => {
    // M is a merge of A and B.
    const commits: GitLogCommit[] = [c({ sha: 'M', parents: ['A', 'B'] }), c({ sha: 'A', parents: ['P'] }), c({ sha: 'B', parents: ['P'] }), c({ sha: 'P' })]
    const rows = buildCommitGraphRows(commits)

    const m = rows[0]!
    expect(m.isMerge).toBe(true)
    expect(m.lanesCount).toBeGreaterThanOrEqual(1)
    // At least one commit should be forced into a non-zero lane.
    expect(rows.some((r) => r.lane > 0)).toBe(true)
  })
})

