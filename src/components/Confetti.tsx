import { useMemo, type CSSProperties } from 'react'

// A short celebration that lives inside the draw stage (the stage clips anything that leaves it).
const COLORS = ['#ff6b9d', '#ffd166', '#06d6a0', '#4cc9f0', '#b794f6', '#ff9f1c', '#ffffff', '#ef476f']
const EMOJIS = ['🎉', '🎊', '🥳', '🎉', '🎊', '✨']
const PIECES = 90
const EMOJI_COUNT = 30

// CSS custom properties are not part of CSSProperties, so the style objects are cast once here.
const vars = (values: Record<string, string>): CSSProperties => values as CSSProperties

const random = (min: number, max: number) => min + Math.random() * (max - min)

export default function Confetti({ reduceMotion }: { reduceMotion: boolean }) {
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, id) => ({
    id,
    shape: id % 5 === 0 ? 'dot' : id % 3 === 0 ? 'ribbon' : 'rect',
    style: vars({
      '--x': `${random(0, 100).toFixed(1)}%`,
      '--drift': `${random(-90, 90).toFixed(0)}px`,
      '--rot': `${random(360, 1080).toFixed(0)}deg`,
      '--size': `${random(6, 12).toFixed(0)}px`,
      '--delay': `${random(0, 1.1).toFixed(2)}s`,
      '--dur': `${random(2.2, 3.8).toFixed(2)}s`,
      '--color': COLORS[id % COLORS.length],
    }),
  })), [])

  const emojis = useMemo(() => Array.from({ length: EMOJI_COUNT }, (_, id) => ({
    id,
    emoji: EMOJIS[id % EMOJIS.length],
    style: vars({
      '--x': `${random(2, 94).toFixed(1)}%`,
      '--drift': `${random(-70, 70).toFixed(0)}px`,
      '--rot': `${random(-40, 40).toFixed(0)}deg`,
      '--size': `${random(20, 40).toFixed(0)}px`,
      '--delay': `${random(0, 1.4).toFixed(2)}s`,
      '--dur': `${random(2.4, 3.6).toFixed(2)}s`,
    }),
  })), [])

  // Reduced motion: a still row of party emojis, nothing falls or flies.
  if (reduceMotion) return <div className="confetti confetti-static" aria-hidden="true">🎉 🎊 🥳 🎉 🎊</div>

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece) => <i key={piece.id} className={`confetti-piece ${piece.shape}`} style={piece.style} />)}
      {emojis.map((item) => <span key={item.id} className="confetti-emoji" style={item.style}>{item.emoji}</span>)}
    </div>
  )
}
