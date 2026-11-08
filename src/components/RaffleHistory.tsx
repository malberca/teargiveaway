import { useState } from 'react'
import { Plus, Ticket } from 'lucide-react'
import type { FinishedRaffle } from '../services/raffles'

interface Props {
  raffles: FinishedRaffle[]
  onNew: () => void
  onExport: (raffle: FinishedRaffle) => void
  onCopy: (raffle: FinishedRaffle) => void
  onDelete: (id: string) => void
  // Lets the first render show a raffle already expanded (used by tests and by the "just saved" flow).
  initiallyExpanded?: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function RaffleHistory({ raffles, onNew, onExport, onCopy, onDelete, initiallyExpanded }: Props) {
  const [expanded, setExpanded] = useState<string | null>(initiallyExpanded ?? null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (!raffles.length) {
    return <div className="empty-raffles"><Ticket size={23} /><span>Sin sorteos</span><button className="btn primary" onClick={onNew}><Plus size={15} /> NEW</button></div>
  }

  return (
    <ul className="raffle-list">
      {raffles.map((raffle) => {
        const open = expanded === raffle.id
        return (
          <li className="raffle-item" key={raffle.id}>
            <div className="raffle-head"><strong>{raffle.title || 'Sorteo sin título'}</strong><small>{formatDate(raffle.finishedAt)}</small></div>
            <p className="raffle-meta">{raffle.winners.length} de {raffle.prizesRequested} {raffle.prizesRequested === 1 ? 'ganador' : 'ganadores'} · {raffle.stats.comments.toLocaleString('es-AR')} comentarios · {raffle.stats.uniqueAccounts.toLocaleString('es-AR')} cuentas únicas</p>
            <div className="buttons raffle-actions">
              <button className="btn tiny" aria-expanded={open} onClick={() => setExpanded(open ? null : raffle.id)}>{open ? 'Ocultar ganadores' : 'Ver ganadores'}</button>
              <button className="btn tiny" onClick={() => onExport(raffle)}>Acta JSON</button>
              <button className="btn tiny" onClick={() => onCopy(raffle)}>Copiar ganadores</button>
              {confirmDelete === raffle.id
                ? <><span className="raffle-confirm">¿Eliminar este sorteo?</span><button className="btn tiny primary" onClick={() => { onDelete(raffle.id); setConfirmDelete(null) }}>Sí, eliminar</button><button className="btn tiny" onClick={() => setConfirmDelete(null)}>No</button></>
                : <button className="btn tiny" onClick={() => setConfirmDelete(raffle.id)}>Eliminar</button>}
            </div>
            {open && (
              <div className="raffle-detail">
                <ol className="raffle-winners">
                  {raffle.winners.map((winner) => <li key={winner.position}><b>PREMIO {String(winner.position).padStart(2, '0')}</b> <span>{winner.username}</span>{winner.prize && <small> · {winner.prize}</small>}</li>)}
                </ol>
                {raffle.postUrl && <p className="note">Publicación: {raffle.postUrl}</p>}
                <p className="note">{raffle.stats.tickets.toLocaleString('es-AR')} chances · {raffle.stats.excludedDuplicates.toLocaleString('es-AR')} comentarios descartados por tope · {raffle.stats.excludedByMentions.toLocaleString('es-AR')} sin las menciones mínimas.</p>
                {raffle.fingerprint && <p className="note raffle-fingerprint">Huella SHA-256 de los comentarios: <code>{raffle.fingerprint}</code></p>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
