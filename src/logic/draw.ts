export interface Winner {
  username: string
  ticketNumber: number
}

function secureIndex(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) throw new RangeError('El sorteo necesita al menos una chance.')
  const range = 0x1_0000_0000
  const limit = range - (range % maxExclusive)
  const value = new Uint32Array(1)
  do {
    crypto.getRandomValues(value)
  } while (value[0] >= limit)
  return value[0] % maxExclusive
}

export function drawWinners(tickets: string[], count: number): Winner[] {
  if (!tickets.length) throw new RangeError('No hay participaciones para sortear.')
  return Array.from({ length: count }, () => {
    const ticketNumber = secureIndex(tickets.length)
    return { username: tickets[ticketNumber], ticketNumber: ticketNumber + 1 }
  })
}
