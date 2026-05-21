import React, { useEffect, useMemo, useState } from 'react'
import { API_URL, ONTOLOGIES, MAX_INPUT_LEN } from './config.js'
import { SAMPLES } from './sample-texts.js'
import OntologyEditor from './ontology-editor.jsx'
import EntityEditor from './entity-editor.jsx'
import {
  DEFAULT_NAMESPACE,
  mdaToEntities, entitiesToTtl,
} from './ontology-model.js'

// Color per match-pass for the highlighted spans and ledger badges.
// Mutato returns `spans` (plural) for span-pass matches; we keep `span`
// as an alias in case the contract ever shifts.
const MATCH_TYPE_COLORS = {
  exact:     { bg: '#dcfce7', fg: '#166534', label: 'exact'     },
  span:      { bg: '#dbeafe', fg: '#1e40af', label: 'span'      },
  spans:     { bg: '#dbeafe', fg: '#1e40af', label: 'span'      },
  hierarchy: { bg: '#fef3c7', fg: '#92400e', label: 'hierarchy' },
}
const UNKNOWN_COLOR = { bg: '#f1f5f9', fg: '#475569', label: 'unknown' }
const colorFor = (type) => MATCH_TYPE_COLORS[type] || UNKNOWN_COLOR

// Collapse all whitespace runs to single spaces. Mutato/spaCy normalizes
// internal whitespace before computing token offsets, but the x/y values
// it returns are then off by N when the original text has runs of N+1
// whitespace characters. Pre-normalizing on the client keeps the offsets
// aligned with the text we render.
const normalizeWhitespace = (s) => s.replace(/\s+/g, ' ').trim()

// ---------------- App ----------------

export default function App() {
  const [ontologyId, setOntologyId] = useState('lotr')
  const [baseMda, setBaseMda] = useState(null)
  const [ontology, setOntology] = useState({
    namespace: DEFAULT_NAMESPACE,
    entities: {},
  })
  const [pristineSnapshot, setPristineSnapshot] = useState(null)
  const [selectedName, setSelectedName] = useState(null)
  const [text, setText] = useState(SAMPLES['lotr'][0])
  const [extractedText, setExtractedText] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showSlowHint, setShowSlowHint] = useState(false)
  const [error, setError] = useState(null)
  // Center pane tab. 'test' shows the NLP Testing workflow; 'entity' shows
  // the expanded entity editor. Resets to 'test' on ontology change.
  const [activeTab, setActiveTab] = useState('test')
  const samples = SAMPLES[ontologyId] || []

  // Mutato returns canonical names lowercased (e.g. "onering", "shire").
  // The editor keeps proper-case labels per entity; surface those in the
  // ledger and tooltips instead of the internal normalized form.
  const canonToLabel = useMemo(() => {
    const m = {}
    for (const [name, e] of Object.entries(ontology.entities)) {
      m[name.toLowerCase()] = e.label || name
    }
    return m
  }, [ontology.entities])

  // After a short delay during loading, show a hint about the cold-compile
  // cost. Warm requests finish well under the delay and never flash it.
  useEffect(() => {
    if (!loading) { setShowSlowHint(false); return }
    const t = setTimeout(() => setShowSlowHint(true), 600)
    return () => clearTimeout(t)
  }, [loading])

  // Load the base MDA dict and derive a source-shape entities map.
  useEffect(() => {
    setSelectedName(null)
    setResult(null)
    setActiveTab('test')
    fetch(`data/${ontologyId}.json`)
      .then(r => r.ok ? r.json() : null)
      .then((d) => {
        setBaseMda(d)
        const entities = d ? mdaToEntities(d) : {}
        setOntology({ namespace: DEFAULT_NAMESPACE, entities })
        setPristineSnapshot(JSON.stringify(entities))
      })
      .catch(() => setBaseMda(null))
  }, [ontologyId])

  const remaining = MAX_INPUT_LEN - text.length
  const entityCount = Object.keys(ontology.entities).length
  const isEdited = pristineSnapshot != null && pristineSnapshot !== JSON.stringify(ontology.entities)

  const handleReset = () => {
    if (!baseMda) return
    const entities = mdaToEntities(baseMda)
    setOntology({ namespace: DEFAULT_NAMESPACE, entities })
    setPristineSnapshot(JSON.stringify(entities))
    setSelectedName(null)
    setResult(null)
  }

  const runExtraction = async () => {
    setError(null)
    if (!text.trim()) { setError('Enter some text first.'); return }
    if (!API_URL) {
      setError('Extraction backend not configured. Set API_URL in config.js.')
      return
    }
    setLoading(true)
    try {
      const normalized = normalizeWhitespace(text)
      // If the user has edited the ontology away from the pristine snapshot,
      // send the full TTL. Otherwise use the pre-baked id (cheaper, same
      // result).
      const body = isEdited
        ? { text: normalized, ontology_ttl: entitiesToTtl(ontology.entities, ontology.namespace) }
        : { text: normalized, ontology: ontologyId }
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(errBody.error || `HTTP ${res.status}`)
      }
      setExtractedText(normalized)
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={shell}>
      <header style={header}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Mutato Entity Extraction</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Ontology-driven NLP, no LLM. Edit the ontology on the left, then extract entities on the right.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isEdited && (
            <span style={editedBadge} title="The ontology has unsaved edits relative to the pristine snapshot">
              edited · {entityCount} entities
            </span>
          )}
          <button
            onClick={handleReset}
            disabled={!isEdited}
            style={isEdited ? secondaryBtn : disabledBtn}
            title="Revert to the pristine ontology"
          >reset</button>
          <select
            value={ontologyId}
            onChange={e => setOntologyId(e.target.value)}
            style={select}
          >
            {ONTOLOGIES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </header>

      <main style={threePane}>
        <aside style={leftRail}>
          <OntologyEditor
            state={ontology}
            setState={setOntology}
            selectedName={selectedName}
            onSelect={setSelectedName}
            detailMode={activeTab === 'entity' ? 'hidden' : 'shown'}
          />
        </aside>

        <section style={center}>
          <div style={tabStrip} role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'test'}
              onClick={() => setActiveTab('test')}
              style={tabBtn(activeTab === 'test')}
            >NLP Testing</button>
            <button
              role="tab"
              aria-selected={activeTab === 'entity'}
              onClick={() => setActiveTab('entity')}
              style={tabBtn(activeTab === 'entity')}
            >Entity {selectedName ? `· ${ontology.entities[selectedName]?.label || selectedName}` : ''}</button>
          </div>

          {activeTab === 'test' && (
            <div style={tabPanel}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  NLP Testing
                </label>
                <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 12px' }}>
                  {samples.map((s, i) => (
                    <li key={i}>
                      <button onClick={() => { setText(s); setResult(null) }} style={sampleBtn}>{s}</button>
                    </li>
                  ))}
                </ul>
              </div>

              <textarea
                value={text}
                onChange={e => setText(e.target.value.slice(0, MAX_INPUT_LEN))}
                placeholder="Paste a sentence about your domain..."
                style={textarea}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 4px' }}>
                <span style={{ fontSize: 11, color: remaining < 100 ? '#dc2626' : '#94a3b8' }}>
                  {text.length} / {MAX_INPUT_LEN}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {isEdited && !loading && (
                    <span style={{ fontSize: 11, color: '#94a3b8' }} title="The next extraction will compile your edited ontology server-side">
                      using edited ontology
                    </span>
                  )}
                  <button onClick={runExtraction} disabled={loading} style={primaryBtn(loading)}>
                    {loading ? (
                      <>
                        <span className="mutato-spinner" aria-hidden="true" />
                        <span>Extracting…</span>
                      </>
                    ) : (
                      'Extract entities'
                    )}
                  </button>
                </div>
              </div>

              <div style={{ minHeight: 16, marginBottom: 8, textAlign: 'right' }}>
                {loading && showSlowHint && (
                  <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                    {isEdited
                      ? 'compiling new ontology, then extracting (cold runs take a few seconds)…'
                      : 'extracting…'}
                  </span>
                )}
              </div>

              {error && <div style={errorBox}>{error}</div>}
              {result && <HighlightedText original={extractedText} tokens={result.tokens} canonToLabel={canonToLabel} />}
              {result && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                  {result.stats.match_count} entities found across {result.stats.token_count} tokens.
                </div>
              )}
            </div>
          )}

          {activeTab === 'entity' && (
            <div style={tabPanel}>
              <EntityEditor
                state={ontology}
                setState={setOntology}
                selectedName={selectedName}
                onSelect={setSelectedName}
              />
            </div>
          )}
        </section>

        <aside style={rightRail}>
          <h2 style={sideHeading}>Provenance</h2>
          <Ledger matches={result?.matches} canonToLabel={canonToLabel} />
        </aside>
      </main>

      <footer style={footer}>
        Source ontology: <code>{isEdited ? 'edited (custom)' : `${ontologyId}-mutato.owl`}</code>. Engine:{' '}
        <a href="https://github.com/craigtrim/mutato" target="_blank" rel="noopener" style={link}>mutato</a>.
      </footer>
    </div>
  )
}

// ---------------- supporting components ----------------

function HighlightedText({ original, tokens, canonToLabel = {} }) {
  if (!tokens || tokens.length === 0) {
    return <pre style={resultPre}>{original}</pre>
  }
  const spans = []
  for (const t of tokens) {
    if (t.swaps && typeof t.x === 'number' && typeof t.y === 'number') {
      spans.push({ start: t.x, end: t.y, token: t })
    }
  }
  spans.sort((a, b) => a.start - b.start)
  const out = []
  let cursor = 0
  spans.forEach((s, i) => {
    if (s.start > cursor) out.push(<span key={`g${i}`}>{original.slice(cursor, s.start)}</span>)
    const color = colorFor(s.token.swaps.type)
    const canon = s.token.swaps.canon
    const labelled = canonToLabel[canon] || canon
    out.push(
      <mark
        key={`m${i}`}
        title={`${labelled} (${s.token.swaps.type}, ${s.token.swaps.confidence}%)`}
        style={{ background: color.bg, color: color.fg, padding: '1px 4px', borderRadius: 3, fontWeight: 500 }}
      >
        {original.slice(s.start, s.end)}
      </mark>
    )
    cursor = s.end
  })
  if (cursor < original.length) out.push(<span key="g_last">{original.slice(cursor)}</span>)
  return <pre style={resultPre}>{out}</pre>
}

function Ledger({ matches, canonToLabel = {} }) {
  if (!matches || matches.length === 0) {
    return <p style={muted}>No matches yet. Submit a sentence to see the provenance trail.</p>
  }
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {matches.map((m, i) => {
        const color = colorFor(m.type)
        const labelled = canonToLabel[m.canon] || m.canon
        return (
          <li key={i} style={ledgerRow}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{m.surface}</div>
            <div style={{ fontSize: 12, color: '#475569', margin: '2px 0' }}>
              <span style={{ color: '#94a3b8' }}>canon:</span> {labelled}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                background: color.bg, color: color.fg, padding: '2px 6px', borderRadius: 3,
              }}>{color.label}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {Math.round(m.confidence)}%
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------- styles ----------------

const shell = {
  display: 'flex', flexDirection: 'column', minHeight: '100vh',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  color: '#0f172a',
  background: '#f8fafc',
}
const header = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0',
  flexWrap: 'wrap', gap: 12,
}
const threePane = {
  display: 'grid', gridTemplateColumns: '340px 1fr 280px', gap: 16,
  padding: 16, flex: 1, minHeight: 0,
}
const leftRail = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12,
  display: 'flex', flexDirection: 'column',
  maxHeight: 'calc(100vh - 130px)', minHeight: 400,
}
const center = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
  display: 'flex', flexDirection: 'column', minHeight: 0,
  overflow: 'hidden',
}
const tabStrip = {
  display: 'flex', gap: 0, flexShrink: 0,
  borderBottom: '1px solid #e2e8f0',
  background: '#f8fafc',
  paddingLeft: 8, paddingRight: 8, paddingTop: 8,
}
const tabBtn = (active) => ({
  background: active ? '#fff' : 'transparent',
  color: active ? '#0f172a' : '#64748b',
  border: '1px solid #e2e8f0',
  borderBottom: active ? '1px solid #fff' : '1px solid #e2e8f0',
  borderTopLeftRadius: 4, borderTopRightRadius: 4,
  borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  padding: '6px 14px', marginBottom: -1,
  fontSize: 12, fontWeight: active ? 600 : 500,
  cursor: 'pointer',
  marginRight: 2,
})
const tabPanel = {
  flex: 1, display: 'flex', flexDirection: 'column',
  padding: 16, minHeight: 0,
}
const rightRail = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12,
  overflowY: 'auto', maxHeight: 'calc(100vh - 130px)',
}
const sideHeading = {
  fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
  fontWeight: 600, marginBottom: 10,
}
const muted = { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }
const editedBadge = {
  fontSize: 11, color: '#92400e', background: '#fef3c7',
  border: '1px solid #fcd34d', borderRadius: 4, padding: '3px 8px',
}
const select = {
  fontSize: 13, padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#fff',
}
const textarea = {
  width: '100%', minHeight: 120, padding: 12, fontSize: 14,
  fontFamily: 'Georgia, serif', lineHeight: 1.5,
  border: '1px solid #cbd5e1', borderRadius: 4, resize: 'vertical',
}
const sampleBtn = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: 4,
  padding: '6px 10px', margin: '4px 0', cursor: 'pointer',
  fontSize: 12, color: '#475569', fontFamily: 'Georgia, serif',
}
const primaryBtn = (loading) => ({
  background: '#0f172a', color: '#fff', border: 'none', borderRadius: 4,
  padding: '8px 16px', fontSize: 13, fontWeight: 600,
  cursor: loading ? 'wait' : 'pointer',
  opacity: loading ? 0.85 : 1,
  display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center',
  minWidth: 148,
  transition: 'opacity 0.15s',
})
const secondaryBtn = {
  background: '#fff', color: '#0f172a',
  border: '1px solid #cbd5e1', borderRadius: 4,
  padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const disabledBtn = {
  background: '#f1f5f9', color: '#cbd5e1',
  border: '1px solid #e2e8f0', borderRadius: 4,
  padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'default',
}
const resultPre = {
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 1.7,
  background: '#f8fafc', padding: 12, borderRadius: 4, border: '1px solid #e2e8f0',
  margin: 0,
}
const ledgerRow = {
  padding: '8px 0', borderBottom: '1px solid #f1f5f9',
}
const errorBox = {
  fontSize: 13, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d',
  borderRadius: 4, padding: '8px 12px', marginBottom: 8,
}
const footer = {
  padding: '12px 24px', fontSize: 11, color: '#94a3b8',
  borderTop: '1px solid #e2e8f0', background: '#fff',
}
const link = { color: '#0f172a', textDecoration: 'underline' }
