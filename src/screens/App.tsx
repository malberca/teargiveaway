import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Plus, RotateCcw, Ticket, Upload } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { parseComments } from '../services/comments'
import { drawWinners, type Winner } from '../logic/draw'

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

type View = 'home' | 'setup' | 'entries'
type Requirement = 'follow' | 'like' | 'share' | 'mention'

interface RaffleConfig {
  title: string
  postUrl: string
  prizes: string
  winnerCount: number
  allowDuplicates: boolean
  minMentions: number
  requirements: Requirement[]
}

const emptyConfig: RaffleConfig = { title: '', postUrl: '', prizes: '', winnerCount: 5, allowDuplicates: true, minMentions: 1, requirements: [] }
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
  const [view, setView] = useState<View>('home')
  const [config, setConfig] = useState<RaffleConfig>(emptyConfig)
  const [raw, setRaw] = useState('')
  const [winners, setWinners] = useState<Winner[]>([])
  const [pendingWinner, setPendingWinner] = useState<Winner | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [rollingName, setRollingName] = useState('¿LISTOS?')
  const [stageTop, setStageTop] = useState('TODO LISTO PARA ARRANCAR')
  const [stageBottom, setStageBottom] = useState('5 PREMIOS · INFINITAS POSIBILIDADES')
  const [status, setStatus] = useState('Cargá participantes para empezar.')
  const reduceMotion = useReducedMotion()
  const requiresMentions = config.requirements.includes('mention')
  const parsed = useMemo(() => parseComments(raw, {
    allowDuplicates: config.allowDuplicates,
    requireMentions: requiresMentions,
    minMentions: config.minMentions,
  }), [raw, config.allowDuplicates, requiresMentions, config.minMentions])
  const prizeList = config.prizes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)

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
    const source = { raffle: config, comments: parsed.commentsCount, tickets: parsed.tickets.length, uniqueAccounts: parsed.entries.length, winners, exportedAt: new Date().toISOString() }
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
        <section className="stats"><div className="stat"><strong>01</strong><small>Configuración</small></div><div className="stat"><strong>{String(config.winnerCount).padStart(2, '0')}</strong><small>Ganadores</small></div><div className="stat"><strong>{prizeList.length}</strong><small>Premios cargados</small></div><div className="stat"><strong>{config.allowDuplicates ? 'SÍ' : 'NO'}</strong><small>Comentarios repetidos</small></div></section>
        <section className="main setup-main">
          <article className="panel">
            <h2>01 / Configuración</h2><p className="sub">Datos del sorteo</p>
            <div className="group"><label className="label" htmlFor="raffle-title">Nombre del sorteo</label><input id="raffle-title" className="field" value={config.title} maxLength={70} onChange={(event) => setConfig({ ...config, title: event.target.value })} placeholder="Sorteo TEAR" /></div>
            <div className="group"><label className="label" htmlFor="winner-count">Cantidad de ganadores</label><select id="winner-count" className="field" value={config.winnerCount} onChange={(event) => setConfig({ ...config, winnerCount: Number(event.target.value) })}>{Array.from({ length: 20 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? 'ganador' : 'ganadores'}</option>)}</select></div>
            <div className="group"><label className="label" htmlFor="post-url">Publicación de Instagram</label><input id="post-url" className="field" value={config.postUrl} onChange={(event) => setConfig({ ...config, postUrl: event.target.value })} placeholder="https://instagram.com/p/..." /><p className="note">Referencia manual · Instagram no está conectado.</p></div>
            <div className="group"><label className="label" htmlFor="prizes">Premios · uno por línea</label><textarea id="prizes" className="field" rows={4} value={config.prizes} onChange={(event) => setConfig({ ...config, prizes: event.target.value })} placeholder={'1° premio · Álbum + photocards\n2° premio · Gift card TEAR\n3° premio · Pack sorpresa'} /></div>
            <div className="group"><span className="label">Condiciones</span>{(['follow', 'like', 'share', 'mention'] as Requirement[]).map((item) => <label className="switch condition-switch" key={item}><input type="checkbox" checked={config.requirements.includes(item)} onChange={() => toggleRequirement(item)} />{requirementLabels[item]}</label>)}{requiresMentions && <label className="label mention-count" htmlFor="min-mentions">Menciones mínimas por comentario<select id="min-mentions" className="field" value={config.minMentions} onChange={(event) => setConfig({ ...config, minMentions: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>}</div>
            <div className="group"><span className="label">Comentarios repetidos</span><div className="buttons"><button className={`btn ${config.allowDuplicates ? 'primary' : ''}`} onClick={() => setConfig({ ...config, allowDuplicates: true })}>Aceptar</button><button className={`btn ${!config.allowDuplicates ? 'primary' : ''}`} onClick={() => setConfig({ ...config, allowDuplicates: false })}>Rechazar</button></div></div>
            <p className="hint"><strong>REGLAS:</strong> {config.winnerCount} {config.winnerCount === 1 ? 'ganador' : 'ganadores'} · reposición habilitada · menciones suman chances.</p>
          </article>
          <article className="panel">
            <h2>02 / Condiciones</h2><p className="sub">Resumen para publicar</p>
            <div className="auth"><strong>◎ Verificación manual</strong><br />Likes, follows y stories se revisan en Instagram. La app no comprueba esas condiciones.</div>
            <div className="stage setup-stage"><div className="stage-top">{config.title.trim() || 'SORTEO TEAR'}</div><div className="slot">{config.winnerCount}</div><div className="bigline" /><div className="stage-bottom">{config.winnerCount === 1 ? 'GANADOR' : 'GANADORES'}</div></div>
            <p className="label">Premios</p>{prizeList.length ? prizeList.map((prize, index) => <p className="note prize-preview" key={`${prize}-${index}`}><strong>{String(index + 1).padStart(2, '0')}.</strong> {prize}</p>) : <p className="note">Sin premios cargados</p>}
            <p className="label condition-preview-label">Condiciones</p>{config.requirements.length ? config.requirements.map((item) => <p className="note condition-preview" key={item}><Check size={14} /> {item === 'mention' ? `Etiquetar ${config.minMentions} amistades como mínimo` : requirementLabels[item]}</p>) : <p className="note">Sin condiciones adicionales</p>}
            <p className="note"><strong>Comentarios repetidos:</strong> {config.allowDuplicates ? 'aceptados' : 'rechazados'}.</p>
            <div className="buttons setup-actions"><button className="btn" onClick={() => setView('home')}><ArrowLeft size={14} /> Cancelar</button><button className="btn primary" onClick={() => { setRaw(''); setView('entries') }}>CONTINUAR <ArrowUpRight size={14} /></button></div>
          </article>
        </section>
        <section className="bottom"><article className="panel"><h2>03 / Sorteo</h2><p className="sub">Cinco extracciones independientes</p><p className="note">La misma cuenta puede ganar más de una vez.</p></article><TransparencyPanel /></section>
      </>}

      {view === 'entries' && <>
        <section className="hero"><div><div className="overline">TEAR STORE / {config.title.trim() || 'SORTEO'}</div><h1>SHOOKY<br /><em>GIVEAWAY.</em></h1></div><p><strong>{String(config.winnerCount).padStart(2, '0')} {config.winnerCount === 1 ? 'GANADOR' : 'GANADORES'}</strong><br />{config.allowDuplicates ? 'Comentarios repetidos aceptados' : 'Un comentario por cuenta'}</p></section>
        <div className="rule" />
        <section className="stats"><div className="stat"><strong>{parsed.commentsCount}</strong><small>Comentarios</small></div><div className="stat"><strong>{parsed.tickets.length}</strong><small>Chances totales</small></div><div className="stat"><strong>{parsed.entries.length}</strong><small>Cuentas únicas</small></div><div className="stat"><strong>{winners.length} / {config.winnerCount}</strong><small>Ganadores</small></div></section>
        <section className="main">
          <article className="panel">
            <h2>01 / Participantes</h2><p className="sub">Pegá comentarios o importá un archivo CSV.</p>
            {config.postUrl && <div className="group"><label className="label" htmlFor="post-url-display">Publicación</label><input id="post-url-display" className="field" value={config.postUrl} readOnly /></div>}
            <div className="auth"><strong>◎ Modo local</strong><br />La lectura automática de Instagram aún no está conectada.</div>
            <div className="group"><label className="label" htmlFor="comments">Comentarios · uno por línea</label><textarea id="comments" className="field" rows={8} spellCheck={false} value={raw} disabled={drawing} onChange={(event) => { setRaw(event.target.value); setWinners([]); setRollingName('¿LISTOS?'); setStatus('Procesá los comentarios para actualizar el ranking.') }} placeholder="@usuario: texto @mención" /><p className="note">Formato: <strong>@autor: texto con @menciones</strong>. Cada comentario suma una chance y cada mención otra.</p></div>
            <div className="buttons"><button className="btn secondary" disabled={drawing} onClick={() => { setRaw(example); setTimeout(processComments, 0) }}>Cargar ejemplo</button><button className="btn" disabled={drawing} onClick={processComments}>Procesar comentarios</button><label className="btn csv-button">Importar CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(event) => { void importCsv(event.target.files?.[0]); event.currentTarget.value = '' }} /></label></div>
            <div className="hint"><strong>REGLAS:</strong> {requiresMentions ? `mínimo ${config.minMentions} menciones · ` : ''}{config.allowDuplicates ? 'comentarios repetidos aceptados' : 'un comentario válido por cuenta'} · {config.winnerCount} {config.winnerCount === 1 ? 'extracción' : 'extracciones'} con reposición.</div>
            <label className="switch"><input type="checkbox" checked disabled readOnly />Permitir ganadores repetidos (regla fija)</label>
            <button className="btn tiny" disabled={drawing} onClick={resetWinners}><RotateCcw size={13} /> Reiniciar resultados</button>
          </article>

          <article className="panel draw-panel">
            <h2>02 / Sorteo</h2><p className="sub">Una extracción por vez. Los tickets vuelven al bolillero.</p>
            <div className="stage"><div className="stage-top">{stageTop}</div><div className={`slot ${drawing ? 'rolling' : ''} ${winners.length && !drawing ? 'flash' : ''}`} aria-live="polite">{rollingName}</div><div className="bigline" /><div className="stage-bottom">{stageBottom}</div></div>
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
