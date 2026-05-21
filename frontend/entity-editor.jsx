// Expanded editor for the selected entity. Lives in the center pane's
// "Entity" tab. Sibling to the small left-rail detail panel; only one is
// ever live at a time (the parent App swaps them via detailMode prop).
//
// The shape is a vertical stack of cards. Each card is self-contained
// so adding a new section later (sameAs, broader/narrower, custom
// relations) is just "add another card." The current v1 cards:
//
//   Identity   — kind badge, identifier, canonical label
//   Synonyms   — alt labels (+ inflections, classes only)
//   Hierarchy  — parent (read-only; reparent via drag in tree)
//   Semantics  — equivalentClass, disjointWith (classes only)
//   Notes      — rdfs:comment
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { ChipEditor } from './ontology-editor.jsx'
import {
  updateEntity,
  addAltLabel, removeAltLabel,
  addInflection, removeInflection,
  setComment,
  addEquivalentClass, removeEquivalentClass,
  addDisjointWith, removeDisjointWith,
  entityToTtlFragment, parseEntityTtlFragment,
} from './ontology-model.js'

const KIND_BADGE = {
  class:    { bg: '#dbeafe', fg: '#1e40af', letter: 'C', name: 'Class' },
  instance: { bg: '#f3e8ff', fg: '#6b21a8', letter: 'i', name: 'Instance' },
}

export default function EntityEditor({ state, setState, selectedName, onSelect }) {
  const entity = selectedName ? state.entities[selectedName] : null
  // 'form' shows the structured card stack; 'ttl' shows the entity's raw
  // Turtle fragment in a parser-backed editable textarea. Toggle lives in
  // the small header above the cards.
  const [viewMode, setViewMode] = useState('form')

  // All hooks must run unconditionally before any early return so the
  // hook count stays stable across the "no selection" -> "selected"
  // transition. Memoize the class-name picker source here even when
  // `entity` is null — the memo is cheap and the alternative (hoisting
  // the early return below all hooks) bloats the body of this function.
  const classNames = useMemo(() => {
    if (!entity) return []
    return Object.values(state.entities)
      .filter(e => e.kind === 'class' && e.name !== entity.name)
      .map(e => e.name)
      .sort()
  }, [state.entities, entity?.name, entity])

  if (!entity) {
    return (
      <div style={emptyState}>
        <p style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>No entity selected</p>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>
          Pick a class or instance from the tree on the left to edit it here.
        </p>
      </div>
    )
  }

  const badge = KIND_BADGE[entity.kind] || KIND_BADGE.class
  const parent = entity.parent ? state.entities[entity.parent] : null

  return (
    <div style={editorScroll}>
      <div style={modeBar}>
        <button
          onClick={() => setViewMode(m => m === 'form' ? 'ttl' : 'form')}
          style={modeToggleBtn}
          title={viewMode === 'form'
            ? 'Show this entity as raw Turtle (TTL)'
            : 'Show the structured form view'}
        >
          {viewMode === 'form' ? '{ } TTL' : '⟵ Form'}
        </button>
      </div>

      {viewMode === 'ttl' && (
        <EntityTtlView
          entity={entity}
          onSave={(parsed) => setState(updateEntity(state, entity.name, parsed))}
        />
      )}

      {viewMode === 'form' && (
        <>
      {/* --------------- Identity --------------- */}
      <Card title="Identity" subtitle={`${badge.name} · drag in the tree to reparent`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 4,
            background: badge.bg, color: badge.fg,
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>{badge.letter}</span>
          <code style={{ fontSize: 12, color: '#64748b' }}>:{entity.name}</code>
        </div>
        <LabelInput
          key={entity.name}
          value={entity.label || entity.name}
          onCommit={(v) => {
            const next = v.trim()
            if (next && next !== entity.label) {
              setState(updateEntity(state, entity.name, { label: next }))
            }
          }}
        />
      </Card>

      {/* --------------- Synonyms --------------- */}
      <Card
        title="Synonyms"
        subtitle="Alternative surface forms that mutato should match to this entity"
      >
        <ChipEditor
          items={entity.altLabels || []}
          onAdd={(v) => setState(addAltLabel(state, entity.name, v))}
          onRemove={(v) => setState(removeAltLabel(state, entity.name, v))}
          placeholder="add an alt label (Enter)"
          accent="#1a8917"
        />
        {entity.kind === 'class' && (
          <>
            <FieldLabel style={{ marginTop: 12 }}>Inflections</FieldLabel>
            <ChipEditor
              items={entity.inflections || []}
              onAdd={(v) => setState(addInflection(state, entity.name, v))}
              onRemove={(v) => setState(removeInflection(state, entity.name, v))}
              placeholder="add an inflection (Enter)"
              accent="#92400e"
            />
          </>
        )}
      </Card>

      {/* --------------- Hierarchy --------------- */}
      <Card
        title="Hierarchy"
        subtitle="To change the parent, drag this entity onto another class in the tree."
      >
        {parent ? (
          <div style={readonlyChip} onClick={() => onSelect(parent.name)} title="Click to open parent">
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: 3,
              background: '#dbeafe', color: '#1e40af',
              fontSize: 10, fontWeight: 700,
            }}>C</span>
            <span>{parent.label || parent.name}</span>
            <code style={{ color: '#94a3b8', fontSize: 11 }}>:{parent.name}</code>
          </div>
        ) : (
          <span style={mutedItalic}>top-level (no parent)</span>
        )}
      </Card>

      {/* --------------- Semantics (classes only) --------------- */}
      {entity.kind === 'class' && (
        <Card
          title="Semantics"
          subtitle="OWL relations between this class and other classes in the ontology."
        >
          <FieldLabel>Equivalent classes</FieldLabel>
          <ClassPickerChips
            items={entity.equivalentClasses || []}
            options={classNames}
            entities={state.entities}
            onAdd={(v) => setState(addEquivalentClass(state, entity.name, v))}
            onRemove={(v) => setState(removeEquivalentClass(state, entity.name, v))}
            placeholder="add an equivalent class (Enter)"
            accent="#2563eb"
            datalistId={`eq-${entity.name}`}
          />

          <FieldLabel style={{ marginTop: 12 }}>Disjoint with</FieldLabel>
          <ClassPickerChips
            items={entity.disjointWith || []}
            options={classNames}
            entities={state.entities}
            onAdd={(v) => setState(addDisjointWith(state, entity.name, v))}
            onRemove={(v) => setState(removeDisjointWith(state, entity.name, v))}
            placeholder="add a disjoint class (Enter)"
            accent="#dc2626"
            datalistId={`dj-${entity.name}`}
          />
        </Card>
      )}

      {/* --------------- Notes --------------- */}
      <Card
        title="Notes"
        subtitle="Freeform description (rdfs:comment). Not used by mutato matching."
      >
        <CommentArea
          key={entity.name}
          value={entity.comment || ''}
          onCommit={(v) => setState(setComment(state, entity.name, v))}
        />
      </Card>
        </>
      )}
    </div>
  )
}

// Parser-backed editable view of a single entity's Turtle fragment.
//
// Autosave model (informed by Google Docs / Notion / CodeMirror conventions):
//   - Debounce 1000ms after the last keystroke — the conventional sweet
//     spot. Tight enough to feel live; loose enough not to thrash on
//     every character.
//   - Force-flush on blur. Users who tab away or click outside expect
//     their edit to be captured immediately rather than waiting out the
//     debounce window.
//   - Force-flush on unmount. Switching the selected entity (or toggling
//     back to the Form view, or closing the tab) tears this component
//     down — we run one final parse attempt during cleanup so nothing is
//     lost.
//   - Silent validation. While the parse fails, we keep the last good
//     state in app memory and surface a small "invalid" tag in the
//     status row. No buttons, no modals — the user keeps typing and the
//     status returns to "saved" the moment the syntax is valid again.
//
// Status states: 'saved' (clean), 'pending' (debounce in flight),
// 'invalid' (parse failure on the current draft).
function EntityTtlView({ entity, onSave }) {
  const initial = useMemo(() => entityToTtlFragment(entity), [entity])
  const [draft, setDraft] = useState(initial)
  const [status, setStatus] = useState('saved')
  const [errorMsg, setErrorMsg] = useState(null)
  // useRef holds the timeout id so the cleanup effect can clear it
  // without re-running the effect on every keystroke; the latest draft
  // is also stashed here so the unmount-time flush sees the freshest
  // value instead of a closed-over stale string.
  const timerRef = useRef(null)
  const draftRef = useRef(initial)
  const entityNameRef = useRef(entity.name)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { entityNameRef.current = entity.name }, [entity.name])

  // Reset the textarea whenever the user navigates to a different
  // entity (the `initial` memo changes too). Also clear any pending
  // debounce so we don't apply edits from the previous entity.
  useEffect(() => {
    setDraft(initial)
    draftRef.current = initial
    setStatus('saved')
    setErrorMsg(null)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [initial])

  // Single source of truth for the parse-and-commit step. Returns true
  // when the commit landed, false on parse failure. Reads from the ref
  // so blur/unmount flushes see the latest text even if React state
  // hasn't propagated yet.
  const flush = useCallback(() => {
    const text = draftRef.current
    if (text === initial) {
      setStatus('saved')
      setErrorMsg(null)
      return true
    }
    const result = parseEntityTtlFragment(text, entityNameRef.current)
    if (result.error) {
      setStatus('invalid')
      setErrorMsg(result.error)
      return false
    }
    const parsed = result.entity
    onSaveRef.current({
      label: parsed.label,
      parent: parsed.parent,
      altLabels: parsed.altLabels,
      inflections: parsed.inflections || [],
      equivalentClasses: parsed.equivalentClasses || [],
      disjointWith: parsed.disjointWith || [],
      comment: parsed.comment,
    })
    setStatus('saved')
    setErrorMsg(null)
    return true
  }, [initial])

  // Final flush on unmount — covers entity-switch and view-toggle
  // teardown. The empty dep array is intentional: this should only run
  // when the component itself unmounts, not on every flush change.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      flush()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onChange = (e) => {
    const next = e.target.value
    setDraft(next)
    draftRef.current = next
    setStatus('pending')
    setErrorMsg(null)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flush()
    }, 1000)
  }

  const onBlur = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    flush()
  }

  return (
    <div style={card}>
      <div style={{ ...cardHeaderRow, cursor: 'default' }}>
        <div style={cardTitle}>Turtle</div>
        <div style={{ flex: 1 }} />
        <StatusPill status={status} title={errorMsg || ''} />
      </div>
      <div style={cardBody}>
        <textarea
          value={draft}
          onChange={onChange}
          onBlur={onBlur}
          style={ttlTextarea}
          spellCheck={false}
        />
      </div>
    </div>
  )
}

function StatusPill({ status, title }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.saved
  const label = status === 'saved' ? 'saved'
              : status === 'pending' ? 'saving…'
              : 'invalid'
  return (
    <span style={style} title={title}>{label}</span>
  )
}

// Chip list backed by a datalist of valid class names. The browser
// renders a native suggestion dropdown as the user types. Invalid names
// are silently rejected (matches the addEquivalentClass / addDisjointWith
// validators in ontology-model.js).
function ClassPickerChips({
  items, options, entities, onAdd, onRemove,
  placeholder, accent, datalistId,
}) {
  return (
    <div>
      <ChipEditor
        items={items}
        onAdd={onAdd}
        onRemove={onRemove}
        placeholder={placeholder}
        accent={accent}
        listId={datalistId}
      />
      <datalist id={datalistId}>
        {options.map(name => {
          const label = entities[name]?.label || name
          return <option key={name} value={name}>{label}</option>
        })}
      </datalist>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
        Type a class identifier (e.g. <code>Hobbit</code>). {options.length} classes available.
      </div>
    </div>
  )
}

// Controlled text input that only writes to ontology state on blur or
// Enter, so a rapid edit doesn't fire one updateEntity per keystroke.
function LabelInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
      style={textInput}
    />
  )
}

// Same lazy-commit pattern as LabelInput, but for a multi-line textarea.
function CommentArea({ value, onCommit }) {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      placeholder="Add a longer description of this entity…"
      style={textareaStyle}
    />
  )
}

// Card with a clickable header that collapses its body. Each section
// (Identity, Synonyms, Hierarchy, Semantics, Notes) wraps in one of
// these so users can fold sections away when adding more downstream.
// Open state lives in the card itself — caller doesn't need to track it.
function Card({ title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={card}>
      <div
        style={cardHeaderRow}
        onClick={() => setOpen(o => !o)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(o => !o)
          }
        }}
      >
        <span style={cardChevron}>{open ? '▾' : '▸'}</span>
        <div style={cardTitle}>{title}</div>
        {subtitle && <div style={cardSubtitleInline}>{subtitle}</div>}
      </div>
      {open && <div style={cardBody}>{children}</div>}
    </div>
  )
}

function FieldLabel({ children, style }) {
  return <label style={{ ...fieldLabel, ...(style || {}) }}>{children}</label>
}

// ---------------- styles ----------------

const editorScroll = {
  flex: 1, overflowY: 'auto', minHeight: 0,
  // Pull the cards to the top; scrolling kicks in past the pane height.
  paddingRight: 4,
}
const emptyState = {
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  padding: 40, textAlign: 'center',
}
const card = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
  marginBottom: 12,
}
const cardHeaderRow = {
  display: 'flex', alignItems: 'baseline', gap: 8,
  padding: '12px 16px',
  cursor: 'pointer', userSelect: 'none',
  borderRadius: 6,
}
const cardChevron = {
  fontSize: 12, color: '#64748b',
  width: 12, flexShrink: 0,
}
const cardBody = {
  padding: '0 16px 16px 16px',
}
const cardTitle = {
  fontSize: 13, fontWeight: 700, color: '#0f172a', flexShrink: 0,
}
const cardSubtitle = {
  fontSize: 11, color: '#94a3b8', fontStyle: 'italic',
}
const cardSubtitleInline = {
  fontSize: 11, color: '#94a3b8', fontStyle: 'italic',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  minWidth: 0, flex: 1,
}
const modeBar = {
  display: 'flex', justifyContent: 'flex-end',
  marginBottom: 8,
}
const modeToggleBtn = {
  background: '#fff', border: '1px solid #cbd5e1',
  borderRadius: 4, padding: '4px 10px',
  fontSize: 11, fontWeight: 600, color: '#0f172a',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
const ttlTextarea = {
  width: '100%', minHeight: 280,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, lineHeight: 1.55,
  border: '1px solid #cbd5e1', borderRadius: 3,
  background: '#f8fafc',
  resize: 'vertical', boxSizing: 'border-box',
  whiteSpace: 'pre',
}
const statusPillBase = {
  fontSize: 10, fontWeight: 600,
  padding: '2px 8px', borderRadius: 10,
  textTransform: 'uppercase', letterSpacing: 0.4,
  flexShrink: 0,
}
const STATUS_STYLES = {
  saved:   { ...statusPillBase, background: '#dcfce7', color: '#166534' },
  pending: { ...statusPillBase, background: '#fef3c7', color: '#92400e' },
  invalid: { ...statusPillBase, background: '#fee2e2', color: '#991b1b', cursor: 'help' },
}
const fieldLabel = {
  display: 'block', fontSize: 11, color: '#475569',
  textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
  marginBottom: 6,
}
const textInput = {
  width: '100%', padding: '6px 10px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 3,
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  boxSizing: 'border-box',
}
const textareaStyle = {
  width: '100%', minHeight: 80, padding: '8px 10px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 3,
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box',
}
const readonlyChip = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '4px 10px',
  background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 4, cursor: 'pointer',
  fontSize: 13, color: '#0f172a',
}
const mutedItalic = {
  fontSize: 12, color: '#94a3b8', fontStyle: 'italic',
}
