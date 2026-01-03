import { buildShaToDecorations, parseForEachRefOutput } from '../gitRefs'

describe('gitRefs', () => {
  test('parseForEachRefOutput parses sha + name', () => {
    const stdout = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tmain',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tv1.0.0',
      '',
    ].join('\n')

    const heads = parseForEachRefOutput(stdout, 'head')
    expect(heads).toEqual([
      { kind: 'head', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'main' },
      { kind: 'head', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'v1.0.0' },
    ])
  })

  test('buildShaToDecorations adds HEAD and tag prefix', () => {
    const refs = [
      { kind: 'head' as const, sha: 'a', name: 'main' },
      { kind: 'tag' as const, sha: 'a', name: 'v1.0.0' },
    ]

    const map = buildShaToDecorations(refs, 'a')
    expect(map.get('a')).toEqual(['HEAD', 'main', 'tag:v1.0.0'])
  })
})
