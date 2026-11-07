export interface Participant {
  id: string
  username: string
  chances: number
}

export interface ParsedComments {
  entries: Participant[]
  tickets: string[]
  errors: string[]
  commentsCount: number
  excludedDuplicates: number
  excludedByMentions: number
}

export interface CommentRules {
  allowDuplicates: boolean
  requireMentions: boolean
  minMentions: number
}

const commentPattern = /^\s*(@[\p{L}\p{N}._]+)\s*:\s*(.*)$/u
const mentionPattern = /@[\p{L}\p{N}._]+/gu

export function parseComments(input: string, rules: CommentRules = {
  allowDuplicates: true,
  requireMentions: false,
  minMentions: 1,
}): ParsedComments {
  const byUser = new Map<string, Participant>()
  const tickets: string[] = []
  const errors: string[] = []
  const acceptedUsers = new Set<string>()
  let commentsCount = 0
  let excludedDuplicates = 0
  let excludedByMentions = 0

  input.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return
    const match = line.match(commentPattern)
    if (!match) {
      errors.push(line)
      return
    }

    const username = match[1].toLocaleLowerCase()
    const body = match[2]
    const mentions = body.match(mentionPattern)?.length ?? 0
    if (rules.requireMentions && mentions < rules.minMentions) {
      excludedByMentions += 1
      return
    }
    if (!rules.allowDuplicates && acceptedUsers.has(username)) {
      excludedDuplicates += 1
      return
    }
    const chances = 1 + mentions
    const participant = byUser.get(username) ?? { id: username, username, chances: 0 }
    participant.chances += chances
    byUser.set(username, participant)
    acceptedUsers.add(username)
    commentsCount += 1
    for (let chance = 0; chance < chances; chance += 1) tickets.push(username)
  })

  return { entries: [...byUser.values()], tickets, errors, commentsCount, excludedDuplicates, excludedByMentions }
}
