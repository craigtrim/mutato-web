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
import React, { useMemo, useState, useEffect } from 'react'
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

  // Sorted snapshot of every other class name, used as the datalist source
  // for the equivalent-class and disjoint-with pickers. Recomputed on every
  // state edit; size is small (≤ entity count) so the work is trivial.
  const classNames = useMemo(() => (
    Object.values(state.entities)
      .filter(e => e.kind === 'class' && e.name !== entity.name)
      .map(e => e.name)
      .sort()
  ), [state.entities, entity.name])

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
// On Save, we parse the textarea and apply the diff to ontology state
// via the `onSave` callback. Parse failures surface inline; nothing is
// mutated until the user clicks Save and the parse succeeds.
function EntityTtlView({ entity, onSave }) {
  const initial = useMemo(() => entityToTtlFragment(entity), [entity])
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  // Reset the textarea whenever the user navigates to a different entity
  // (or external edits change the underlying entity shape).
  useEffect(() => {
    setDraft(initial)
    setError(null)
    setDirty(false)
  }, [initial])

  const save = () => {
    const result = parseEntityTtlFragment(draft, entity.name)
    if (result.error) { setError(result.error); return }
    setError(null)
    setDirty(false)
    // Apply only the parsed fields, leaving `name` alone (the parser
    // rejected renames upstream).
    const parsed = result.entity
    onSave({
      label: parsed.label,
      parent: parsed.parent,
      altLabels: parsed.altLabels,
      inflections: parsed.inflections || [],
      equivalentClasses: parsed.equivalentClasses || [],
      disjointWith: parsed.disjointWith || [],
      comment: parsed.comment,
    })
  }

  const reset = () => {
    setDraft(initial)
    setError(null)
    setDirty(false)
  }

  return (
    <div style={card}>
      <div style={{ ...cardHeaderRow, cursor: 'default' }}>
        <div style={{ flex: 1 }}>
          <div style={cardTitle}>Turtle (this entity only)</div>
          <div style={cardSubtitle}>
            Edit the TTL directly. Saving rewrites this entity's label, synonyms, parent, semantics, and notes.
            Renaming the identifier (<code>:{entity.name}</code>) isn't supported here.
          </div>
        </div>
      </div>
      <div style={cardBody}>
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); setError(null) }}
          style={ttlTextarea}
          spellCheck={false}
        />
        {error && <div style={ttlError}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={save}
            disabled={!dirty}
            style={dirty ? ttlSaveBtn : ttlSaveBtnDisabled}
          >Save</button>
          <button
            onClick={reset}
            disabled={!dirty}
            style={dirty ? ttlResetBtn : ttlResetBtnDisabled}
          >Revert</button>
        </div>
      </div>
    </div>
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
  width: '100%', minHeight: 240,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, lineHeight: 1.55,
  border: '1px solid #cbd5e1', borderRadius: 3,
  background: '#f8fafc',
  resize: 'vertical', boxSizing: 'border-box',
  whiteSpace: 'pre',
}
const ttlError = {
  marginTop: 8, padding: '6px 10px',
  fontSize: 12, color: '#92400e',
  background: '#fef3c7', border: '1px solid #fcd34d',
  borderRadius: 3,
}
const ttlSaveBtn = {
  background: '#0f172a', color: '#fff', border: 'none',
  borderRadius: 4, padding: '6px 14px',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const ttlSaveBtnDisabled = {
  ...{
    background: '#f1f5f9', color: '#cbd5e1', border: 'none',
    borderRadius: 4, padding: '6px 14px',
    fontSize: 12, fontWeight: 600, cursor: 'default',
  },
}
const ttlResetBtn = {
  background: '#fff', color: '#0f172a',
  border: '1px solid #cbd5e1', borderRadius: 4,
  padding: '6px 14px',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const ttlResetBtnDisabled = {
  ...{
    background: '#f1f5f9', color: '#cbd5e1',
    border: '1px solid #e2e8f0', borderRadius: 4,
    padding: '6px 14px',
    fontSize: 12, fontWeight: 600, cursor: 'default',
  },
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
