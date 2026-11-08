import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Instagram, Plus, RotateCcw, Ticket, Upload } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { parseComments } from '../services/comments'
import { drawWinners, type Winner } from '../logic/draw'
import Confetti from '../components/Confetti'
import { parseSavedState, STORAGE_KEY, type SavedState } from '../services/savedState'

const example = [
  '@martin: ¡Vamos! @lucas @sofia @tomas',
  '@sofia: Me anoto @martin @luli',
  '@lucas: ¡Excelente! @agus @martin @cami',
  '@martin: Otra chance @sofia @flor',
  '@agus: Participando @luli @tomas',
  '@cami: @sofia @agus @lucas',
  '@martin: ¡Una más! @agus @agus',
  '@luli: Vamos TEAR @martin @flor',
  '@tomas: @cami @agus @sofia',
  '@flor: Quiero ganar @martin @lucas',
  '@cami: Segunda participación @sofia',
  '@sofia: @luli @flor @martin',
].join('\n')

export type View = 'home' | 'setup' | 'entries'
type Requirement = 'follow' | 'like' | 'share' | 'mention'
type DuplicatePolicy = 'all' | 'limit' | 'one'

export interface RaffleConfig {
  title: string
  postUrl: string
  prizes: string
  winnerCount: number
  duplicates: DuplicatePolicy
  maxPerAccount: number
  minMentions: number
  requirements: Requirement[]
}

interface InstagramStatus {
  connected: boolean
  username: string | null
  expiresAt: string | null
}

interface ImportProgress {
  stage: 'search' | 'comments'
  count: number
}

interface ImportResult {
  comments: Array<{ username?: string; text?: string }>
  truncated?: boolean
}

// The server streams newline-delimited JSON: progress events, then one `done` (or `error`).
async function readImportStream(body: ReadableStream<Uint8Array>, onProgress: (progress: ImportProgress) => void): Promise<ImportResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ImportResult | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as { type: string; stage?: ImportProgress['stage']; count?: number; message?: string } & Partial<ImportResult>
    if (event.type === 'progress' && event.stage) onProgress({ stage: event.stage, count: event.count ?? 0 })
    else if (event.type === 'done') result = { comments: event.comments ?? [], truncated: event.truncated }
    else if (event.type === 'error') throw new Error(event.message || 'No se pudieron cargar los comentarios.')
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      handle(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
    }
  }
  handle(buffer + decoder.decode())
  if (!result) throw new Error('La conexión se cortó antes de terminar de cargar los comentarios.')
  return result
}

const perAccountOptions = [2, 3, 5, 10, 15, 20, 25, 30, 40, 50]

function maxPerAccountOf(config: Pick<RaffleConfig, 'duplicates' | 'maxPerAccount'>): number {
  if (config.duplicates === 'one') return 1
  return config.duplicates === 'limit' ? config.maxPerAccount : Number.POSITIVE_INFINITY
}

function duplicatesLabel(config: Pick<RaffleConfig, 'duplicates' | 'maxPerAccount'>): string {
  if (config.duplicates === 'one') return 'un comentario válido por cuenta'
  return config.duplicates === 'limit' ? `hasta ${config.maxPerAccount} comentarios por cuenta` : 'comentarios repetidos aceptados'
}

function duplicatesShort(config: Pick<RaffleConfig, 'duplicates' | 'maxPerAccount'>): string {
  if (config.duplicates === 'one') return '1 X CUENTA'
  return config.duplicates === 'limit' ? `HASTA ${config.maxPerAccount}` : 'TODOS'
}

const emptyConfig: RaffleConfig = { title: '', postUrl: '', prizes: '', winnerCount: 5, duplicates: 'all', maxPerAccount: 10, minMentions: 1, requirements: [] }

// Long Instagram usernames (up to 30 characters) need a smaller size to stay on the stage.
function slotSizeClass(name: string): string {
  if (name.length > 22) return 'slot-xlong'
  return name.length > 14 ? 'slot-long' : ''
}

function loadSavedState(): SavedState | null {
  try { return parseSavedState(window.localStorage.getItem(STORAGE_KEY), emptyConfig) } catch { return null }
}

// The draw animation is not saved, so the stage text is rebuilt from the winners that are.
function stageBottomFor(config: Pick<RaffleConfig, 'winnerCount'>, winners: Winner[]): string {
  if (!winners.length) return `${config.winnerCount} PREMIOS · INFINITAS POSIBILIDADES`
  return winners.length >= config.winnerCount ? 'TODOS LOS PREMIOS FUERON ASIGNADOS' : `PREMIO ${winners.length} DE ${config.winnerCount}`
}
const requirementLabels: Record<Requirement, string> = {
  follow: 'Seguir la cuenta',
  like: 'Dar like a la publicación',
  share: 'Compartir en stories',
  mention: 'Etiquetar amistades',
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(field); field = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export default function App() {
  const [restored] = useState(loadSavedState)
  const [view, setView] = useState<View>(restored?.view ?? 'home')
  const [config, setConfig] = useState<RaffleConfig>(restored?.config ?? emptyConfig)
  const [raw, setRaw] = useState(restored?.raw ?? '')
  const [winners, setWinners] = useState<Winner[]>(restored?.winners ?? [])
  const [pendingWinner, setPendingWinner] = useState<Winner | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [rollingName, setRollingName] = useState(restored?.winners.length ? restored.winners[restored.winners.length - 1].username : '¿LISTOS?')
  const [stageTop, setStageTop] = useState('TODO LISTO PARA ARRANCAR')
  const [stageBottom, setStageBottom] = useState(restored ? stageBottomFor(restored.config, restored.winners) : '5 PREMIOS · INFINITAS POSIBILIDADES')
  const [status, setStatus] = useState(restored?.raw || restored?.winners.length ? 'Sorteo restaurado: la configuración, los comentarios y los ganadores se guardaron en este navegador.' : 'Cargá participantes para empezar.')
  const [instagram, setInstagram] = useState<InstagramStatus>({ connected: false, username: null, expiresAt: null })
  const [instagramBusy, setInstagramBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  // Set when a winner is confirmed; cleared after the celebration so it never replays on a refresh.
  const [confettiKey, setConfettiKey] = useState<number | null>(null)
  useEffect(() => {
    if (confettiKey === null) return
    const timer = window.setTimeout(() => setConfettiKey(null), 7000)
    return () => window.clearTimeout(timer)
  }, [confettiKey])
  // Saved shortly after every change, and immediately when the page is refreshed or closed.
  const latest = useRef<SavedState>({ view, config, raw, winners })
  latest.current = { view, config, raw, winners }
  useEffect(() => {
    const save = () => {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)) } catch { setStatus('No se pudo guardar el sorteo en este navegador (sin espacio o bloqueado).') }
    }
    const timer = window.setTimeout(save, 400)
    window.addEventListener('pagehide', save)
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', save) }
  }, [view, config, raw, winners])
  const reduceMotion = useReducedMotion()
  const requiresMentions = config.requirements.includes('mention')
  const parsed = useMemo(() => parseComments(raw, {
    maxPerAccount: maxPerAccountOf(config),
    requireMentions: requiresMentions,
    minMentions: config.minMentions,
  }), [raw, config.duplicates, config.maxPerAccount, requiresMentions, config.minMentions])
  const prizeList = config.prizes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)

  async function refreshInstagramStatus() {
    try {
      const response = await fetch('/api/instagram/status', { cache: 'no-store' })
      if (!response.ok) return
      setInstagram(await response.json() as InstagramStatus)
    } catch {
      setInstagram({ connected: false, username: null, expiresAt: null })
    }
  }

  useEffect(() => {
    void refreshInstagramStatus()
    const onMessage = (event: MessageEvent<{ type?: string; result?: string; message?: string }>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tear-instagram-oauth') return
      setInstagramBusy(false)
      if (event.data.result === 'connected') {
        void refreshInstagramStatus().then(() => setStatus('Instagram conectado. Ya podés cargar los comentarios.'))
      } else {
        setStatus(event.data.message || 'No se pudo conectar Instagram.')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function connectInstagram() {
    const popup = window.open('/api/instagram/connect', 'tear-instagram-oauth', 'popup,width=560,height=720')
    if (!popup) {
      setStatus('Permití las ventanas emergentes para conectar Instagram.')
      return
    }
    setInstagramBusy(true)
    setStatus('Esperando autorización de Instagram...')
  }

  async function disconnectInstagram() {
    setInstagramBusy(true)
    try {
      await fetch('/api/instagram/disconnect', { method: 'POST' })
      setInstagram({ connected: false, username: null, expiresAt: null })
      setStatus('Cuenta de Instagram desconectada.')
    } finally {
      setInstagramBusy(false)
    }
  }

  async function loadInstagramComments() {
    if (!config.postUrl.trim()) {
      setStatus('Pegá el enlace de la publicación en la configuración del sorteo.')
      return
    }
    setInstagramBusy(true)
    setImportProgress({ stage: 'search', count: 0 })
    setStatus('Buscando la publicación en Instagram...')
    try {
      const response = await fetch('/api/instagram/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl: config.postUrl, stream: true }),
      })
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(failure.error || 'No se pudieron cargar los comentarios.')
      }
      const result = await readImportStream(response.body, (progress) => {
        setImportProgress(progress)
        setStatus(progress.stage === 'search' ? 'Buscando la publicación en Instagram...' : `Cargando comentarios... ${progress.count.toLocaleString('es-AR')}`)
      })
      const commentsText = result.comments.map((comment) => `@${(comment.username || 'usuario').replace(/^@/, '')}: ${(comment.text || '').replace(/[\r\n]+/g, ' ')}`).join('\n')
      setRaw(commentsText)
      setWinners([])
      setRollingName('¿LISTOS?')
      const loaded = result.comments.length.toLocaleString('es-AR')
      setStatus(`${loaded} comentarios cargados.${result.truncated ? ' La publicación tiene más: se cargó el máximo de 10.000.' : ''} Procesalos para actualizar las participaciones.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudieron cargar los comentarios.')
    } finally {
      setInstagramBusy(false)
      setImportProgress(null)
    }
  }

  useEffect(() => {
    if (!drawing || !pendingWinner || !parsed.tickets.length) return
    let steps = 0
    const totalSteps = reduceMotion ? 1 : 27
    const interval = window.setInterval(() => {
      setRollingName(drawWinners(parsed.tickets, 1)[0].username)
      steps += 1
      if (steps >= totalSteps) {
        window.clearInterval(interval)
        setRollingName(pendingWinner.username)
        setWinners((current) => [...current, pendingWinner])
        setPendingWinner(null)
        setDrawing(false)
        setConfettiKey(Date.now())
        const prizeNumber = winners.length + 1
        setStageTop('✦ GANADOR CONFIRMADO ✦')
        setStageBottom(prizeNumber === config.winnerCount ? 'TODOS LOS PREMIOS FUERON ASIGNADOS' : `PREMIO ${prizeNumber} DE ${config.winnerCount}`)
        setStatus(prizeNumber === config.winnerCount ? 'Sorteo completado. Exportá el acta.' : `Premio ${prizeNumber} adjudicado. El ganador vuelve al bolillero.`)
      }
    }, reduceMotion ? 100 : 85)
    return () => window.clearInterval(interval)
  }, [config.winnerCount, drawing, pendingWinner, parsed.tickets, reduceMotion, winners.length])

  function startNew() {
    setConfig({ ...emptyConfig })
    setRaw('')
    setWinners([])
    setRollingName('¿LISTOS?')
    setStageTop('TODO LISTO PARA ARRANCAR')
    setStageBottom(`${emptyConfig.winnerCount} PREMIOS · INFINITAS POSIBILIDADES`)
    setStatus('Cargá participantes para empezar.')
    setView('setup')
  }

  function processComments() {
    setWinners([])
    setRollingName('¿LISTOS?')
    setStageTop('TODO LISTO PARA ARRANCAR')
    setStageBottom(`${config.winnerCount} PREMIOS · INFINITAS POSIBILIDADES`)
    setStatus(parsed.errors.length
      ? `${parsed.commentsCount} comentarios procesados · Líneas omitidas: ${parsed.errors.length}.`
      : `${parsed.commentsCount} comentarios procesados · ${parsed.tickets.length} chances activas.`)
  }

  function handleDraw() {
    if (drawing || !parsed.tickets.length || winners.length >= config.winnerCount) return
    try {
      setPendingWinner(drawWinners(parsed.tickets, 1)[0])
      setDrawing(true)
      setStageTop(`BUSCANDO GANADOR #${winners.length + 1}`)
      setStageBottom('QUE LA SUERTE DECIDA')
      setStatus('Mezclando todas las participaciones...')
    } catch {
      setStatus('Este navegador no dispone de aleatoriedad criptográfica.')
    }
  }

  function resetWinners() {
    if (drawing) return
    setWinners([])
    setRollingName('¿LISTOS?')
    setStageTop('TODO LISTO PARA ARRANCAR')
    setStageBottom(`${config.winnerCount} PREMIOS · INFINITAS POSIBILIDADES`)
    setStatus('Resultados reiniciados. Participaciones conservadas.')
  }

  function toggleRequirement(item: Requirement) {
    setConfig((current) => ({ ...current, requirements: current.requirements.includes(item)
      ? current.requirements.filter((requirement) => requirement !== item)
      : [...current.requirements, item] }))
  }

  async function importCsv(file?: File) {
    if (!file) return
    const rows = parseCsvRows(await file.text())
    const firstRow = rows[0]?.map((item) => item.trim().toLowerCase()) ?? []
    const authorIndex = firstRow.findIndex((item) => ['username', 'author', 'usuario', 'autor', 'user'].includes(item))
    const textIndex = firstRow.findIndex((item) => ['text', 'comment', 'comentario', 'texto'].includes(item))
    const commentText = authorIndex >= 0 && textIndex >= 0
      ? rows.slice(1).map((row) => `@${String(row[authorIndex] ?? '').replace(/^@/, '')}: ${String(row[textIndex] ?? '').replace(/[\r\n]+/g, ' ')}`).join('\n')
      : await file.text()
    setRaw(commentText)
    setTimeout(() => setStatus('Archivo cargado. Procesá los comentarios para continuar.'), 0)
  }

  function exportAct() {
    const source = { raffle: config, comments: parsed.commentsCount, tickets: parsed.tickets.length, uniqueAccounts: parsed.entries.length, excludedDuplicates: parsed.excludedDuplicates, excludedByMentions: parsed.excludedByMentions, winners, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `TEAR-acta-sorteo-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyWinners() {
    try {
      await navigator.clipboard.writeText(winners.map((winner, index) => `Premio ${index + 1}: ${winner.username}`).join('\n'))
      setStatus('Ganadores copiados.')
    } catch {
      setStatus('No se pudo copiar. Usá Exportar acta.')
    }
  }

  const ranked = [...parsed.entries].sort((left, right) => right.chances - left.chances || left.username.localeCompare(right.username))

  return <>
    <header className="site-header">
      <div className="brand" aria-label="TEAR">TEAR<span>.</span></div>
      <div className="header-actions">{view === 'home' ? <button className="btn primary tiny" onClick={startNew}><Plus size={14} /> NEW</button> : <button className="btn tiny" onClick={() => setView(view === 'entries' ? 'setup' : 'home')}><ArrowLeft size={14} /> {view === 'entries' ? 'CONFIGURACIÓN' : 'MIS SORTEOS'}</button>}</div>
    </header>
    <div className="brand-banner shooky-header"><img src="/shooky-cutout.png" alt="Shooky asomándose desde el borde derecho, sin fondo" /></div>

    <main className="wrap">
      {view === 'home' && <>
        <section className="hero home-hero"><div><div className="overline">TEAR STORE / SORTEOS</div><h1>SHOOKY<br /><em>GIVEAWAY.</em></h1></div><p className="hero-specs"><strong>1–20 GANADORES</strong><br />Carga manual · Selección criptográfica</p></section>
        <div className="rule" />
        <section className="stats"><div className="stat"><strong>0</strong><small>Sorteos creados</small></div><div className="stat"><strong>1–20</strong><small>Ganadores por sorteo</small></div><div className="stat"><strong>∞</strong><small>Chances posibles</small></div><div className="stat"><strong>LOCAL</strong><small>Estado</small></div></section>
        <section className="main home-main"><article className="panel"><h2>01 / Mis sorteos</h2><p className="sub">Sorteos creados en esta sesión</p><div className="empty-raffles"><Ticket size={23} /><span>Sin sorteos</span><button className="btn primary" onClick={startNew}><Plus size={15} /> NEW</button></div></article><article className="panel"><h2>02 / Reglas</h2><p className="sub">Condiciones configurables</p><p className="note"><strong>Participaciones:</strong> un ticket por comentario y uno por cada mención. Los comentarios repetidos se pueden permitir o rechazar.</p><p className="note"><strong>Ganadores:</strong> cantidad configurable por sorteo. Una cuenta puede ganar más de una vez.</p></article></section>
        <section className="bottom"><article className="panel"><h2>03 / Módulos</h2><p className="sub">Configuración · Participantes · Sorteo · Ranking</p><button className="btn primary" onClick={startNew}><Plus size={15} /> NEW</button></article><TransparencyPanel /></section>
      </>}

      {view === 'setup' && <>
        <section className="hero"><div><div className="overline">TEAR / CONFIGURACIÓN</div><h1>NUEVO<br /><em>SORTEO.</em></h1></div><p>Premios · Condiciones · Duplicados</p></section>
        <div className="rule" />
        <section className="stats"><div className="stat"><strong>01</strong><small>Configuración</small></div><div className="stat"><strong>{String(config.winnerCount).padStart(2, '0')}</strong><small>Ganadores</small></div><div className="stat"><strong>{prizeList.length}</strong><small>Premios cargados</small></div><div className="stat"><strong>{duplicatesShort(config)}</strong><small>Comentarios por cuenta</small></div></section>
        <section className="main setup-main">
          <article className="panel">
            <h2>01 / Configuración</h2><p className="sub">Datos del sorteo</p>
            <div className="group"><label className="label" htmlFor="raffle-title">Nombre del sorteo</label><input id="raffle-title" className="field" value={config.title} maxLength={70} onChange={(event) => setConfig({ ...config, title: event.target.value })} placeholder="Sorteo TEAR" /></div>
            <div className="group"><label className="label" htmlFor="winner-count">Cantidad de ganadores</label><select id="winner-count" className="field" value={config.winnerCount} onChange={(event) => setConfig({ ...config, winnerCount: Number(event.target.value) })}>{Array.from({ length: 20 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? 'ganador' : 'ganadores'}</option>)}</select></div>
            <div className="group"><label className="label" htmlFor="post-url">Publicación de Instagram</label><input id="post-url" className="field" value={config.postUrl} onChange={(event) => setConfig({ ...config, postUrl: event.target.value })} placeholder="https://www.instagram.com/p/..." /><p className="note">La conexión de la cuenta se configura en Participantes.</p></div>
            <div className="group"><label className="label" htmlFor="prizes">Premios · uno por línea</label><textarea id="prizes" className="field" rows={4} value={config.prizes} onChange={(event) => setConfig({ ...config, prizes: event.target.value })} placeholder={'1° premio · Álbum + photocards\n2° premio · Gift card TEAR\n3° premio · Pack sorpresa'} /></div>
            <div className="group"><span className="label">Condiciones</span>{(['follow', 'like', 'share', 'mention'] as Requirement[]).map((item) => <label className="switch condition-switch" key={item}><input type="checkbox" checked={config.requirements.includes(item)} onChange={() => toggleRequirement(item)} />{requirementLabels[item]}</label>)}{requiresMentions && <label className="label mention-count" htmlFor="min-mentions">Menciones mínimas por comentario<select id="min-mentions" className="field" value={config.minMentions} onChange={(event) => setConfig({ ...config, minMentions: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>}</div>
            <div className="group"><span className="label">Comentarios repetidos</span><div className="buttons"><button className={`btn ${config.duplicates === 'all' ? 'primary' : ''}`} onClick={() => setConfig({ ...config, duplicates: 'all' })}>Aceptar</button><select className={`btn per-account-select ${config.duplicates === 'limit' ? 'primary' : ''}`} aria-label="Máximo de comentarios por cuenta" value={config.duplicates === 'limit' ? String(config.maxPerAccount) : ''} onChange={(event) => setConfig({ ...config, duplicates: 'limit', maxPerAccount: Number(event.target.value) })}><option value="" disabled>Hasta…</option>{perAccountOptions.map((number) => <option key={number} value={number}>Hasta {number} por cuenta</option>)}</select><button className={`btn ${config.duplicates === 'one' ? 'primary' : ''}`} onClick={() => setConfig({ ...config, duplicates: 'one' })}>Rechazar</button></div></div>
            <p className="hint"><strong>REGLAS:</strong> {config.winnerCount} {config.winnerCount === 1 ? 'ganador' : 'ganadores'} · reposición habilitada · menciones suman chances.</p>
          </article>
          <article className="panel">
            <h2>02 / Condiciones</h2><p className="sub">Resumen para publicar</p>
            <div className="auth"><strong>◎ Verificación manual</strong><br />Likes, follows y stories se revisan en Instagram. La app no comprueba esas condiciones.</div>
            <div className="stage setup-stage"><div className="stage-top">{config.title.trim() || 'SORTEO TEAR'}</div><div className="slot">{config.winnerCount}</div><div className="bigline" /><div className="stage-bottom">{config.winnerCount === 1 ? 'GANADOR' : 'GANADORES'}</div></div>
            <p className="label">Premios</p>{prizeList.length ? prizeList.map((prize, index) => <p className="note prize-preview" key={`${prize}-${index}`}><strong>{String(index + 1).padStart(2, '0')}.</strong> {prize}</p>) : <p className="note">Sin premios cargados</p>}
            <p className="label condition-preview-label">Condiciones</p>{config.requirements.length ? config.requirements.map((item) => <p className="note condition-preview" key={item}><Check size={14} /> {item === 'mention' ? `Etiquetar ${config.minMentions} amistades como mínimo` : requirementLabels[item]}</p>) : <p className="note">Sin condiciones adicionales</p>}
            <p className="note"><strong>Comentarios repetidos:</strong> {duplicatesLabel(config)}.</p>
            <div className="buttons setup-actions"><button className="btn" onClick={() => setView('home')}><ArrowLeft size={14} /> Cancelar</button><button className="btn primary" onClick={() => { setRaw(''); setView('entries') }}>CONTINUAR <ArrowUpRight size={14} /></button></div>
          </article>
        </section>
        <section className="bottom"><article className="panel"><h2>03 / Sorteo</h2><p className="sub">Cinco extracciones independientes</p><p className="note">La misma cuenta puede ganar más de una vez.</p></article><TransparencyPanel /></section>
      </>}

      {view === 'entries' && <>
        <section className="hero"><div><div className="overline">TEAR STORE / {config.title.trim() || 'SORTEO'}</div><h1>SHOOKY<br /><em>GIVEAWAY.</em></h1></div><p><strong>{String(config.winnerCount).padStart(2, '0')} {config.winnerCount === 1 ? 'GANADOR' : 'GANADORES'}</strong><br />{duplicatesLabel(config)}</p></section>
        <div className="rule" />
        <section className="stats"><div className="stat"><strong>{parsed.commentsCount}</strong><small>Comentarios</small></div><div className="stat"><strong>{parsed.tickets.length}</strong><small>Chances totales</small></div><div className="stat"><strong>{parsed.entries.length}</strong><small>Cuentas únicas</small></div><div className="stat"><strong>{winners.length} / {config.winnerCount}</strong><small>Ganadores</small></div></section>
        <section className="main">
          <article className="panel">
            <h2>01 / Participantes</h2><p className="sub">Pegá comentarios o importá un archivo CSV.</p>
            {config.postUrl && <div className="group"><label className="label" htmlFor="post-url-display">Publicación</label><input id="post-url-display" className="field" value={config.postUrl} readOnly /></div>}
            <div className="auth instagram-bridge">
              <div className="instagram-account"><Instagram size={17} /><span>{instagram.connected ? `Conectada como @${instagram.username}` : 'Cuenta de Instagram'}</span><i className={instagram.connected ? 'connected' : ''} /></div>
              <div className="buttons instagram-actions">
                {instagram.connected
                  ? <><button className="btn primary" disabled={instagramBusy} onClick={() => void loadInstagramComments()}><Instagram size={14} /> {instagramBusy ? (importProgress?.stage === 'comments' ? `CARGANDO… ${importProgress.count.toLocaleString('es-AR')}` : 'CARGANDO…') : 'CARGAR COMENTARIOS'}</button><button className="btn tiny" disabled={instagramBusy} onClick={() => void disconnectInstagram()}>Desconectar</button></>
                  : <button className="btn primary" disabled={instagramBusy} onClick={connectInstagram}><Instagram size={14} /> {instagramBusy ? 'ESPERANDO…' : 'CONECTAR INSTAGRAM'}</button>}
              </div>
              {importProgress && <div className="import-progress" role="status"><span className="spinner" aria-hidden="true" /><span>{importProgress.stage === 'search' ? 'Buscando la publicación…' : `Cargando comentarios… ${importProgress.count.toLocaleString('es-AR')}`}</span></div>}
              <p className="note">Instagram profesional · autorización oficial de Meta. El token queda cifrado en una cookie HttpOnly.</p>
            </div>
            <div className="group"><label className="label" htmlFor="comments">Comentarios · uno por línea</label><textarea id="comments" className="field" rows={8} spellCheck={false} value={raw} disabled={drawing} onChange={(event) => { setRaw(event.target.value); setWinners([]); setRollingName('¿LISTOS?'); setStatus('Procesá los comentarios para actualizar el ranking.') }} placeholder="@usuario: texto @mención" /><p className="note">Formato: <strong>@autor: texto con @menciones</strong>. Cada comentario suma una chance y cada mención otra.</p></div>
            <div className="buttons"><button className="btn secondary" disabled={drawing || instagramBusy} onClick={() => { setRaw(example); setTimeout(processComments, 0) }}>Cargar ejemplo</button><button className="btn" disabled={drawing || instagramBusy} onClick={processComments}>Procesar comentarios</button><label className="btn csv-button">Importar CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(event) => { void importCsv(event.target.files?.[0]); event.currentTarget.value = '' }} /></label></div>
            <div className="hint"><strong>REGLAS:</strong> {requiresMentions ? `mínimo ${config.minMentions} menciones · ` : ''}{duplicatesLabel(config)} · {config.winnerCount} {config.winnerCount === 1 ? 'extracción' : 'extracciones'} con reposición.</div>
            {(parsed.excludedDuplicates > 0 || parsed.excludedByMentions > 0) && <p className="note excluded-note"><strong>Descartados:</strong> {parsed.excludedDuplicates > 0 ? `${parsed.excludedDuplicates} por superar el máximo de comentarios por cuenta` : ''}{parsed.excludedDuplicates > 0 && parsed.excludedByMentions > 0 ? ' · ' : ''}{parsed.excludedByMentions > 0 ? `${parsed.excludedByMentions} por no tener las menciones mínimas` : ''}. Cambiá la regla de comentarios repetidos para incluirlos.</p>}
            <label className="switch"><input type="checkbox" checked disabled readOnly />Permitir ganadores repetidos (regla fija)</label>
            <button className="btn tiny" disabled={drawing} onClick={resetWinners}><RotateCcw size={13} /> Reiniciar resultados</button>
          </article>

          <article className="panel draw-panel">
            <h2>02 / Sorteo</h2><p className="sub">Una extracción por vez. Los tickets vuelven al bolillero.</p>
            <div className="stage"><div className="stage-top">{stageTop}</div><div className={`slot ${slotSizeClass(rollingName)} ${drawing ? 'rolling' : ''} ${winners.length && !drawing ? 'flash' : ''}`} aria-live="polite">{rollingName}</div><div className="bigline" /><div className="stage-bottom">{stageBottom}</div>{confettiKey !== null && <Confetti key={confettiKey} reduceMotion={Boolean(reduceMotion)} />}</div>
            <button className="btn primary draw" disabled={!parsed.tickets.length || drawing || winners.length >= config.winnerCount} onClick={handleDraw}>{winners.length >= config.winnerCount ? '✓ SORTEO FINALIZADO' : `✦ SORTEAR GANADOR #${winners.length + 1}`}</button>
            <p className="status" aria-live="polite">{status}</p>
            <div className="winners">{Array.from({ length: config.winnerCount }, (_, index) => {
              const winner = winners[index]
              return <div className={`winner ${winner ? 'full' : ''}`} key={index}><b>PREMIO 0{index + 1}</b><span>{winner?.username || '—'}</span>{winner && prizeList[index] && <small>{prizeList[index]}</small>}</div>
            })}</div>
            <div className="buttons result-actions"><button className="btn tiny" disabled={!winners.length} onClick={exportAct}><Upload size={13} /> Exportar acta JSON</button><button className="btn tiny" disabled={!winners.length} onClick={() => { void copyWinners() }}>Copiar ganadores</button></div>
          </article>
        </section>
        <section className="bottom">
          <article className="panel"><h2>03 / Ranking de chances</h2><p className="sub">Participaciones ponderadas por cuenta</p><div className="table-scroll"><table><thead><tr><th>Cuenta</th><th>Chances</th><th>Probabilidad</th></tr></thead><tbody>{ranked.length ? ranked.map((participant) => <tr key={participant.id}><td>{participant.username}</td><td><span className="pill">{participant.chances}</span></td><td>{parsed.tickets.length ? `${(participant.chances * 100 / parsed.tickets.length).toFixed(2)}%` : '0%'}</td></tr>) : <tr><td colSpan={3}>Sin participantes</td></tr>}</tbody></table></div></article>
          <TransparencyPanel />
        </section>
      </>}
      <figure className="bottom-campaign"><img src="/tear-live-bottom.jpg" alt="BTS en un concierto rodeados por luces del público" /><figcaption>SHOOKY · GIVEAWAY</figcaption></figure>
      <footer className="footer"><div className="brand">TEAR<span>.</span></div><span className="footer-disclaimer">© 2026. Todos los derechos reservados. Este es un módulo de sorteos de TEAR PC SHOP.</span></footer>
    </main>
  </>
}

function TransparencyPanel() {
  return <article className="panel"><h2>04 / Transparencia</h2><p className="sub">Reglas · Fuente de datos · Resultados</p><p className="note"><strong>Selección:</strong> aleatoriedad criptográfica del navegador y cinco extracciones con reposición.</p><p className="note"><strong>Validación:</strong> likes, follows y stories requieren revisión manual. La carga de comentarios es manual.</p><p className="footnote">Prototipo local · Sin conexión con Instagram.</p></article>
}
