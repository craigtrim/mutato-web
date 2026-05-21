import React, { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import {
  MAX_ENTITIES,
  addEntity, removeEntity, updateEntity,
  addAltLabel, removeAltLabel,
  addInflection, removeInflection,
  buildChildIndex, suggestName, entitiesToTtl,
  insertSibling,
} from './ontology-model.js'

// Stable color per kind for the small "C"/"i" badge in the tree.
const KIND_BADGE = {
  class:    { bg: '#dbeafe', fg: '#1e40af', letter: 'C' },
  instance: { bg: '#f3e8ff', fg: '#6b21a8', letter: 'i' },
}

// Fixed row height used by the virtualizer. Picked to match the inline
// row padding of the tree node (4px top + 4px bottom + 16px content).
// If you change row visuals, keep this in sync or the indicator math
// drifts and rows clip mid-text.
const TREE_ROW_HEIGHT = 26
// Render this many extra rows above and below the visible viewport so
// fast scrolls don't tear. 8 rows × 26px = ~200px of margin in each
// direction, which absorbs single wheel ticks at typical OS settings.
const TREE_ROW_OVERSCAN = 8

// A node is open by default if its depth is below this threshold. Mirrors
// the old recursive TreeNode behavior (`depth < 1`) so top-level classes
// expand on load and everything below starts collapsed.
function defaultOpenAtDepth(depth) {
  return depth < 1
}

// XOR a default with the user's toggled set. The toggled set lives in
// the editor; a name appearing in it means "the user clicked this node,
// flipping it from its default state." This is the same per-row logic
// the original recursive tree used, just hoisted up so the virtualizer
// can compute the flat visible row list in one pass.
function isOpenForRow(name, depth, toggledSet) {
  const dflt = defaultOpenAtDepth(depth)
  return toggledSet.has(name) ? !dflt : dflt
}

const DETAIL_HEIGHT_KEY = 'mutato-editor-detail-height'
const DETAIL_HEIGHT_DEFAULT = 280
const DETAIL_HEIGHT_MIN = 80
const TREE_HEIGHT_MIN = 80

// Decide whether `source` can be dropped onto `target` to make target the
// new parent. Rules:
//   - target must be a class (instances do not accept children)
//   - cannot drop on self
//   - cannot drop on a descendant of self (would create a cycle)
//   - if source is already a direct child of target, the drop is a no-op
function canDropAsParent(targetName, sourceName, entities) {
  if (!targetName || !sourceName || targetName === sourceName) return false
  const target = entities[targetName]
  const source = entities[sourceName]
  if (!target || !source) return false
  if (target.kind !== 'class') return false
  if (source.parent === targetName) return false
  let cur = target.parent
  while (cur) {
    if (cur === sourceName) return false
    cur = entities[cur]?.parent
  }
  return true
}

// Decide whether `source` can be inserted as a sibling of `target` (above
// or below it). The effective new parent is `target.parent`. Rules:
//   - target must exist
//   - cannot make source its own parent (target.parent !== source)
//   - cannot put a descendant in the ancestor's parent's sibling list
//     where the descendant's new parent would become an ancestor of itself
//   - if source is an instance, the new parent must be a class (rejects
//     attempts to insert instances between top-level classes)
//   - dropping in the slot the source already occupies is a no-op
function canDropAsSibling(targetName, sourceName, entities, position) {
  if (!targetName || !sourceName || targetName === sourceName) return false
  const target = entities[targetName]
  const source = entities[sourceName]
  if (!target || !source) return false
  const newParent = target.parent
  if (newParent === sourceName) return false
  // Instances need a class parent (root sibling-drop is disallowed; the
  // root-area drop zone still handles that case explicitly).
  if (source.kind === 'instance' && newParent === null) return false
  // Cycle: if newParent is a descendant of source, reject
  if (newParent) {
    let cur = entities[newParent]?.parent
    while (cur) {
      if (cur === sourceName) return false
      cur = entities[cur]?.parent
    }
  }
  return true
}

// Find a sensible "root" class for instances dropped on the empty area.
// Returns the alphabetically first top-level (parent-less) class name,
// or null if no such class exists.
function firstTopLevelClass(entities) {
  return Object.values(entities)
    .filter(e => e.kind === 'class' && !e.parent)
    .map(e => e.name)
    .sort()[0] || null
}

export default function OntologyEditor({
  state, setState,
  selectedName, onSelect,
  // 'shown' (default) renders the resizable detail panel below the tree.
  // 'hidden' suppresses both the panel and the resize handle so the tree
  // takes the full rail height — used when the center pane is on the
  // Entity tab, where the same fields live in a larger form.
  detailMode = 'shown',
}) {
  const detailVisible = detailMode !== 'hidden'
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [menu, setMenu] = useState(null)  // { x, y, name }
  const [drag, setDrag] = useState(null)  // { source, target, position } | null
  const treeAreaRef = useRef(null)
  const scrollRef = useRef({ dir: 0, speed: 0, rafId: 0 })
  const [detailHeight, setDetailHeight] = useState(() => {
    try {
      const saved = localStorage.getItem(DETAIL_HEIGHT_KEY)
      const n = saved ? parseInt(saved, 10) : DETAIL_HEIGHT_DEFAULT
      return Number.isFinite(n) && n >= DETAIL_HEIGHT_MIN ? n : DETAIL_HEIGHT_DEFAULT
    } catch { return DETAIL_HEIGHT_DEFAULT }
  })
  const [isResizing, setIsResizing] = useState(false)
  const shellRef = useRef(null)
  const headerRef = useRef(null)
  const childIndex = useMemo(() => buildChildIndex(state.entities), [state.entities])

  const entityCount = Object.keys(state.entities).length
  const atLimit = entityCount >= MAX_ENTITIES

  // Names the user has explicitly toggled away from the depth-default. A
  // depth-0 node listed here is closed; any other depth listed here is
  // open. The virtualizer reads this to decide which children to flatten.
  const [toggledSet, setToggledSet] = useState(() => new Set())
  const toggleOpen = (name) => {
    setToggledSet(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const matches = new Set()
    for (const e of Object.values(state.entities)) {
      const hay = [
        e.name, e.label,
        ...(e.altLabels || []),
        ...(e.inflections || []),
      ].join(' ').toLowerCase()
      if (hay.includes(q)) matches.add(e.name)
    }
    const withAncestors = new Set(matches)
    for (const name of matches) {
      let cur = state.entities[name]?.parent
      while (cur) {
        withAncestors.add(cur)
        cur = state.entities[cur]?.parent
      }
    }
    return withAncestors
  }, [query, state.entities])

  // Flatten the visible tree into a single array of rows for the
  // virtualizer. Walks the child index in display order, descending into
  // children only when the node is effectively open. Search mode replaces
  // open-state with "open if ancestor of a match" so search hits are
  // always reachable without manual expansion.
  const flatRows = useMemo(() => {
    const rows = []
    const walk = (name, depth) => {
      if (filtered && !filtered.has(name)) return
      const entity = state.entities[name]
      if (!entity) return
      const kids = childIndex[name] || []
      const hasKids = kids.length > 0
      const open = filtered ? true : isOpenForRow(name, depth, toggledSet)
      rows.push({ name, depth, hasKids, open })
      if (open && hasKids) {
        for (const k of kids) walk(k, depth + 1)
      }
    }
    for (const r of (childIndex.__roots || [])) walk(r, 0)
    return rows
  }, [childIndex, state.entities, toggledSet, filtered])

  const promptAndAdd = (kind, parent) => {
    if (atLimit) return
    const label = window.prompt(
      kind === 'class' ? 'New class label (e.g. "Goblin")' : 'New instance label (e.g. "Gollum")',
      ''
    )
    if (label == null) return
    const trimmed = label.trim()
    if (!trimmed) return
    const name = suggestName(state.entities, trimmed)
    const newEntity = kind === 'class'
      ? { name, kind: 'class', label: trimmed, parent: parent || null, altLabels: [], inflections: [] }
      : { name, kind: 'instance', label: trimmed, parent, altLabels: [] }
    setState(addEntity(state, newEntity))
    onSelect(name)
  }

  const promptAndAddAlt = (name) => {
    const v = window.prompt('Add alt label')
    if (!v) return
    setState(addAltLabel(state, name, v))
  }

  const promptAndAddInflection = (name) => {
    const v = window.prompt('Add inflection (e.g. plural)')
    if (!v) return
    setState(addInflection(state, name, v))
  }

  const promptAndRename = (name) => {
    const e = state.entities[name]
    if (!e) return
    const v = window.prompt('Rename label', e.label || e.name)
    if (v == null) return
    const trimmed = v.trim()
    if (!trimmed || trimmed === e.label) return
    setState(updateEntity(state, name, { label: trimmed }))
  }

  const openContextMenu = (event, name) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, name })
  }

  const handleMenuAction = (action) => {
    if (!menu) return
    const name = menu.name
    setMenu(null)
    switch (action) {
      case 'add-subclass':     promptAndAdd('class', name); break
      case 'add-instance':     promptAndAdd('instance', name); break
      case 'add-alt':          promptAndAddAlt(name); break
      case 'add-inflection':   promptAndAddInflection(name); break
      case 'rename':           promptAndRename(name); break
      case 'delete':           setConfirmDelete(name); break
      default: break
    }
  }

  const handleDelete = (name) => {
    setState(removeEntity(state, name))
    setConfirmDelete(null)
    if (selectedName === name) onSelect(null)
  }

  const selected = selectedName ? state.entities[selectedName] : null
  const counterColor = atLimit ? '#dc2626' : entityCount > 0.8 * MAX_ENTITIES ? '#d97706' : '#94a3b8'

  // Resize the divider between tree and detail. Pattern mirrors VS Code's
  // sidebar splits: thin handle, ns-resize cursor, persisted height.
  const startResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = detailHeight
    let lastHeight = startHeight

    const measureMax = () => {
      const shellH = shellRef.current?.clientHeight || 600
      const headerH = headerRef.current?.clientHeight || 80
      // Reserve space for the header, the handle, and a min tree area.
      return Math.max(DETAIL_HEIGHT_MIN, shellH - headerH - TREE_HEIGHT_MIN - 6)
    }

    setIsResizing(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const onMove = (mv) => {
      const delta = mv.clientY - startY
      const maxH = measureMax()
      const next = Math.max(DETAIL_HEIGHT_MIN, Math.min(maxH, startHeight - delta))
      lastHeight = next
      setDetailHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsResizing(false)
      try { localStorage.setItem(DETAIL_HEIGHT_KEY, String(Math.round(lastHeight))) } catch {}
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Double-click the handle to reset to default height (matches VS Code's
  // "reset panel size" convention).
  const resetResize = () => {
    setDetailHeight(DETAIL_HEIGHT_DEFAULT)
    try { localStorage.setItem(DETAIL_HEIGHT_KEY, String(DETAIL_HEIGHT_DEFAULT)) } catch {}
  }

  // ---- drag and drop reparenting + reordering ----
  const handleDragStart = (e, name) => {
    e.dataTransfer.setData('text/plain', name)
    e.dataTransfer.effectAllowed = 'move'
    setDrag({ source: name, target: null, position: 'on' })
  }
  const handleDragOverRow = (e, name) => {
    const source = drag?.source
    if (!source) return
    // Split the row into thirds: top 25% = above, bottom 25% = below,
    // middle 50% = on. Edges of small rows would clip the middle; the
    // 25/50/25 split is generous enough that even 24px-tall rows have
    // 12px of "on" target.
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    const h = rect.height || 1
    let position
    if (offsetY < h * 0.25) position = 'above'
    else if (offsetY > h * 0.75) position = 'below'
    else position = 'on'

    const ok = position === 'on'
      ? canDropAsParent(name, source, state.entities)
      : canDropAsSibling(name, source, state.entities, position)
    if (!ok) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (drag.target !== name || drag.position !== position) {
      setDrag({ source, target: name, position })
    }
  }
  const handleDropOnRow = (e, name) => {
    e.preventDefault()
    e.stopPropagation()
    const source = e.dataTransfer.getData('text/plain') || drag?.source
    const position = drag?.position || 'on'
    if (source) {
      if (position === 'on' && canDropAsParent(name, source, state.entities)) {
        setState(updateEntity(state, source, { parent: name }))
      } else if ((position === 'above' || position === 'below')
                 && canDropAsSibling(name, source, state.entities, position)) {
        setState(insertSibling(state, source, name, position))
      }
    }
    setDrag(null)
  }
  const handleDragOverRoot = (e) => {
    if (!drag?.source) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (drag.target !== null) setDrag({ source: drag.source, target: null, position: 'on' })
  }
  const handleDropOnRoot = (e) => {
    e.preventDefault()
    const source = e.dataTransfer.getData('text/plain') || drag?.source
    if (source) {
      const src = state.entities[source]
      if (src?.kind === 'class') {
        setState(updateEntity(state, source, { parent: null }))
      } else if (src?.kind === 'instance') {
        const root = firstTopLevelClass(state.entities)
        if (root) setState(updateEntity(state, source, { parent: root }))
      }
    }
    setDrag(null)
  }
  const handleDragEnd = () => setDrag(null)

  // Auto-scroll the tree while dragging near its top or bottom edge. This is
  // the standard "edge sensor + requestAnimationFrame" pattern recommended for
  // native HTML5 drag-and-drop. We attach a document-level dragover listener
  // (so it fires regardless of any row's stopPropagation) and bail unless the
  // cursor is horizontally within the tree's bounding rect.
  const isDragging = drag != null
  useEffect(() => {
    if (!isDragging) {
      const s = scrollRef.current
      s.dir = 0
      if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = 0 }
      return
    }

    const EDGE_PX = 60
    const MAX_SPEED = 14
    const MIN_SPEED = 2

    const tick = () => {
      const s = scrollRef.current
      const el = treeAreaRef.current
      if (s.dir === 0 || !el) { s.rafId = 0; return }
      el.scrollBy(0, s.speed * s.dir)
      s.rafId = requestAnimationFrame(tick)
    }

    const onDragOver = (e) => {
      const el = treeAreaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const s = scrollRef.current
      if (e.clientX < rect.left || e.clientX > rect.right) {
        s.dir = 0
        return
      }
      const fromTop = e.clientY - rect.top
      const fromBottom = rect.bottom - e.clientY

      if (fromTop < EDGE_PX) {
        s.dir = -1
        const eased = (EDGE_PX - Math.max(0, fromTop)) / EDGE_PX
        s.speed = Math.max(MIN_SPEED, MAX_SPEED * eased)
      } else if (fromBottom < EDGE_PX) {
        s.dir = 1
        const eased = (EDGE_PX - Math.max(0, fromBottom)) / EDGE_PX
        s.speed = Math.max(MIN_SPEED, MAX_SPEED * eased)
      } else {
        s.dir = 0
      }

      if (s.dir !== 0 && s.rafId === 0) {
        s.rafId = requestAnimationFrame(tick)
      }
    }

    // Escape cancels the drag. The browser is supposed to fire `dragend`
    // on Esc natively, but it can be flaky (especially while the cursor
    // is outside the viewport or moving fast). Listening explicitly keeps
    // the experience predictable. Nothing has been mutated yet — drop is
    // the only path that writes — so cancelling just clears the drag
    // state and the source row's parent is unchanged.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDrag(null)
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('keydown', onKey)
      const s = scrollRef.current
      s.dir = 0
      if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = 0 }
    }
  }, [isDragging])

  // Trigger a download of the current ontology as TTL. The TTL is the same
  // text the demo sends to mutato on Extract, so the user can drop it into
  // a Python script with `OntologyParser('path/to/file.owl')` and get the
  // identical compile + match result.
  const downloadTtl = () => {
    const ttl = entitiesToTtl(state.entities, state.namespace)
    const blob = new Blob([ttl], { type: 'text/turtle;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mutato-ontology.ttl'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div style={editorShell} ref={shellRef}>
      <div style={editorHeader} ref={headerRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13, color: '#0f172a' }}>Ontology</strong>
          <span style={{ fontSize: 11, color: counterColor, fontVariantNumeric: 'tabular-nums' }}>
            {entityCount} / {MAX_ENTITIES}
          </span>
        </div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search labels, alt names, inflections"
          style={searchInput}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <button
            onClick={() => promptAndAdd('class', null)}
            disabled={atLimit}
            title="Add a top-level class"
            style={miniBtn(atLimit)}
          >
            + class
          </button>
          <span style={hintText}>right-click any node for more</span>
          <button
            onClick={downloadTtl}
            title="Download the TTL the editor will send to mutato — usable as a standalone OWL file"
            style={{ ...miniBtn(false), marginLeft: 'auto' }}
          >
            ↓ TTL
          </button>
        </div>
      </div>

      <VirtualizedTree
        ref={treeAreaRef}
        rows={flatRows}
        rowHeight={TREE_ROW_HEIGHT}
        overscan={TREE_ROW_OVERSCAN}
        emptyMessage={childIndex.__roots.length === 0
          ? <p style={muted}>Empty ontology. Click <em>+ class</em> to start.</p>
          : null}
        rootDropOverlay={drag && drag.target === null
          ? (
            <div style={rootDropZone}>
              drop here to make top-level
              {state.entities[drag.source]?.kind === 'instance' && firstTopLevelClass(state.entities) && (
                <span style={rootDropHint}>
                  {' '}(instance will be retyped to <code>{firstTopLevelClass(state.entities)}</code>)
                </span>
              )}
            </div>
          )
          : null}
        onDragOverRoot={handleDragOverRoot}
        onDropOnRoot={handleDropOnRoot}
        renderRow={(row) => (
          <TreeRow
            row={row}
            state={state}
            selectedName={selectedName}
            onSelect={onSelect}
            onContextMenu={openContextMenu}
            onToggleOpen={toggleOpen}
            drag={drag}
            onDragStart={handleDragStart}
            onDragOverRow={handleDragOverRow}
            onDropRow={handleDropOnRow}
            onDragEnd={handleDragEnd}
          />
        )}
      />

      {detailVisible && (
        <>
          <div
            style={resizeHandleStyle(isResizing)}
            onMouseDown={startResize}
            onDoubleClick={resetResize}
            title="Drag to resize · double-click to reset"
            role="separator"
            aria-orientation="horizontal"
          >
            <div style={resizeHandleLineStyle(isResizing)} />
          </div>

          <div style={{ ...detailContainer, height: detailHeight }}>
            {selected ? (
              <EntityDetail
                state={state}
                setState={setState}
                entity={selected}
                onClose={() => onSelect(null)}
              />
            ) : (
              <div style={{ padding: '12px 4px', fontSize: 12, color: '#94a3b8' }}>
                Select an entity to edit its labels and synonyms.
              </div>
            )}
          </div>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entity={state.entities[menu.name]}
          atLimit={atLimit}
          onAction={handleMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${state.entities[confirmDelete]?.label || confirmDelete}"?  Its children will move up to its parent.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

// Fixed-height row virtualizer. Keeps the scrollable container shape
// identical to the old non-virtualized tree (overflowY: auto, full
// flex height) so the drag auto-scroll logic that reads
// `treeAreaRef.current` continues to work without modification.
//
// Renders a tall spacer div sized to `rows.length * rowHeight` and
// absolutely positions only the slice currently in view (plus an
// overscan margin above and below). At 8192 rows this caps the React
// reconciliation per scroll tick to ~25-30 elements regardless of the
// total list size.
const VirtualizedTree = React.forwardRef(function VirtualizedTree({
  rows, rowHeight, overscan,
  emptyMessage, rootDropOverlay,
  onDragOverRoot, onDropOnRoot,
  renderRow,
}, ref) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const innerRef = useRef(null)

  // Expose the scroll container to the parent so the drag auto-scroll
  // effect (which lives on the parent) can call scrollBy on it.
  useEffect(() => {
    if (typeof ref === 'function') ref(innerRef.current)
    else if (ref) ref.current = innerRef.current
  }, [ref])

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  const totalHeight = rows.length * rowHeight
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIdx = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  )
  const visible = rows.slice(startIdx, endIdx)

  return (
    <div
      ref={innerRef}
      style={treeArea}
      onDragOver={onDragOverRoot}
      onDrop={onDropOnRoot}
    >
      {rows.length === 0 && emptyMessage}
      <div style={{ position: 'relative', height: totalHeight, minHeight: 1 }}>
        {visible.map((row, i) => (
          <div
            key={row.name}
            style={{
              position: 'absolute',
              top: (startIdx + i) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
            }}
          >
            {renderRow(row)}
          </div>
        ))}
      </div>
      {rootDropOverlay}
    </div>
  )
})

// A single row in the virtualized tree. Indent is rendered as
// `paddingLeft` instead of a wrapping `marginLeft` so absolute
// positioning by the virtualizer stays predictable.
function TreeRow({
  row, state, selectedName,
  onSelect, onContextMenu, onToggleOpen,
  drag, onDragStart, onDragOverRow, onDropRow, onDragEnd,
}) {
  const { name, depth, hasKids, open } = row
  const entity = state.entities[name]
  const [hovered, setHovered] = useState(false)
  if (!entity) return null

  const isSelected = selectedName === name
  const badge = KIND_BADGE[entity.kind] || KIND_BADGE.class
  const isDragSource = drag?.source === name
  const isDropTargetRow = drag?.target === name
  const dropPosition = isDropTargetRow ? drag.position : null
  const isDropOn = dropPosition === 'on'
  const isDropAbove = dropPosition === 'above'
  const isDropBelow = dropPosition === 'below'

  let rowBg = 'transparent'
  if (isDropOn) rowBg = '#dbeafe'
  else if (isSelected) rowBg = '#e0f2fe'
  else if (hovered) rowBg = '#f8fafc'

  // Depth indent: 14px per level matches the old marginLeft cascade.
  const indentPx = depth * 14

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {isDropAbove && <div style={{ ...siblingDropLine, position: 'absolute', top: 0, left: indentPx + 4, right: 4 }} />}
      <div
        draggable
        onDragStart={(e) => onDragStart(e, name)}
        onDragOver={(e) => onDragOverRow(e, name)}
        onDrop={(e) => onDropRow(e, name)}
        onDragEnd={onDragEnd}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 6px', paddingLeft: 6 + indentPx,
          borderRadius: 4,
          background: rowBg,
          cursor: drag ? 'grabbing' : 'pointer',
          position: 'relative',
          opacity: isDragSource ? 0.4 : 1,
          outline: isDropOn ? '1px solid #3b82f6' : 'none',
          transition: 'background 0.08s, opacity 0.08s, outline 0.08s',
          height: '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(e) => onContextMenu(e, name)}
        onDoubleClick={() => hasKids && onToggleOpen(name)}
      >
        <span
          onClick={() => hasKids && onToggleOpen(name)}
          style={{ width: 12, fontSize: 11, color: '#64748b', userSelect: 'none' }}
        >
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <span
          onClick={() => onSelect(name)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3,
            background: badge.bg, color: badge.fg,
            fontSize: 10, fontWeight: 700, flexShrink: 0,
          }}
        >{badge.letter}</span>
        <span
          onClick={() => onSelect(name)}
          style={{
            flex: 1, fontSize: 13,
            color: isSelected ? '#0c4a6e' : '#0f172a',
            fontWeight: isSelected ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{entity.label || entity.name}</span>
        <button
          onClick={(e) => onContextMenu(e, name)}
          title="Actions (right-click also works)"
          style={{
            background: 'transparent', border: 'none',
            fontSize: 14, fontWeight: 700, color: '#64748b',
            cursor: 'pointer', padding: '0 4px',
            opacity: hovered ? 0.9 : 0, transition: 'opacity 0.12s',
          }}
        >⋮</button>
      </div>
      {isDropBelow && <div style={{ ...siblingDropLine, position: 'absolute', bottom: 0, left: indentPx + 4, right: 4 }} />}
    </div>
  )
}

function ContextMenu({ x, y, entity, atLimit, onAction, onClose }) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x, y, ready: false })

  // After mount, measure and adjust if menu overflows viewport.
  useEffect(() => {
    if (!menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    const margin = 8
    const nx = Math.min(x, window.innerWidth - r.width - margin)
    const ny = Math.min(y, window.innerHeight - r.height - margin)
    setPos({ x: Math.max(margin, nx), y: Math.max(margin, ny), ready: true })
  }, [x, y])

  // Dismiss on outside click, scroll, resize, or Escape.
  useEffect(() => {
    const onDown = (e) => {
      if (!menuRef.current || !menuRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onScroll = () => onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [onClose])

  if (!entity) return null
  const isClass = entity.kind === 'class'

  const items = isClass ? [
    { label: 'Add subclass',   action: 'add-subclass',   disabled: atLimit },
    { label: 'Add instance',   action: 'add-instance',   disabled: atLimit },
    { sep: true },
    { label: 'Add alt label',  action: 'add-alt' },
    { label: 'Add inflection', action: 'add-inflection' },
    { sep: true },
    { label: 'Rename label',   action: 'rename' },
    { label: 'Delete',         action: 'delete', danger: true },
  ] : [
    { label: 'Add alt label',  action: 'add-alt' },
    { sep: true },
    { label: 'Rename label',   action: 'rename' },
    { label: 'Delete',         action: 'delete', danger: true },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6,
        boxShadow: '0 6px 24px rgba(15, 23, 42, 0.12)',
        minWidth: 180, padding: '4px 0', zIndex: 200,
        opacity: pos.ready ? 1 : 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
      role="menu"
    >
      <div style={menuHeader}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: 3,
          background: KIND_BADGE[entity.kind].bg, color: KIND_BADGE[entity.kind].fg,
          fontSize: 9, fontWeight: 700, marginRight: 6,
        }}>{KIND_BADGE[entity.kind].letter}</span>
        {entity.label || entity.name}
      </div>
      {items.map((item, i) => item.sep
        ? <div key={`s${i}`} style={menuSeparator} />
        : (
          <MenuItem
            key={item.action}
            label={item.label}
            danger={item.danger}
            disabled={item.disabled}
            onClick={() => !item.disabled && onAction(item.action)}
          />
        )
      )}
    </div>
  )
}

// Single context-menu row. Tracks its own hover state so each item gets
// visible feedback on mouse-over (matches the convention of native OS
// context menus). Inline styles meant the original `<div>` had no
// :hover affordance; this restores that.
function MenuItem({ label, danger, disabled, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={menuItemStyle(danger, disabled, hovered)}
      role="menuitem"
      aria-disabled={disabled || false}
    >
      {label}
    </div>
  )
}

function EntityDetail({ state, setState, entity, onClose }) {
  const [labelDraft, setLabelDraft] = useState(entity.label || entity.name)
  useEffect(() => { setLabelDraft(entity.label || entity.name) }, [entity.name])

  const commitLabel = () => {
    const v = labelDraft.trim()
    if (v && v !== entity.label) {
      setState(updateEntity(state, entity.name, { label: v }))
    } else if (!v) {
      setLabelDraft(entity.label || entity.name)
    }
  }

  return (
    <div style={detailPanel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {entity.kind} {entity.parent ? `· under ${entity.parent}` : ''}
          </div>
          <code style={{ fontSize: 11, color: '#64748b' }}>:{entity.name}</code>
        </div>
        <button onClick={onClose} title="Close detail" style={closeBtn}>×</button>
      </div>

      <label style={detailLabel}>Canonical label</label>
      <input
        type="text"
        value={labelDraft}
        onChange={e => setLabelDraft(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        style={detailInput}
      />

      <label style={detailLabel}>
        Alt labels
        <span style={detailHint}>synonyms, nicknames, surface variants</span>
      </label>
      <ChipEditor
        items={entity.altLabels || []}
        onAdd={(v) => setState(addAltLabel(state, entity.name, v))}
        onRemove={(v) => setState(removeAltLabel(state, entity.name, v))}
        placeholder="add an alt label (Enter)"
        accent="#1a8917"
      />

      {entity.kind === 'class' && (
        <>
          <label style={detailLabel}>
            Inflections
            <span style={detailHint}>plurals and morphological variants</span>
          </label>
          <ChipEditor
            items={entity.inflections || []}
            onAdd={(v) => setState(addInflection(state, entity.name, v))}
            onRemove={(v) => setState(removeInflection(state, entity.name, v))}
            placeholder="add an inflection (Enter)"
            accent="#92400e"
          />
        </>
      )}
    </div>
  )
}

export function ChipEditor({ items, onAdd, onRemove, placeholder, accent, listId }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const submit = () => {
    const v = draft.trim()
    if (!v) return
    onAdd(v)
    setDraft('')
    inputRef.current?.focus()
  }

  return (
    <div style={chipBox}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {items.length === 0 && <span style={muted}>None yet.</span>}
        {items.map((v, i) => (
          <span key={`${v}-${i}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#f1f5f9', color: '#0f172a',
            border: `1px solid ${accent}33`,
            borderRadius: 3, padding: '2px 4px 2px 8px',
            fontSize: 12,
          }}>
            {v}
            <button
              onClick={() => onRemove(v)}
              title="Remove"
              style={chipX}
            >×</button>
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder={placeholder}
        list={listId}
        style={{ ...detailInput, fontSize: 12 }}
      />
    </div>
  )
}

function ConfirmDialog({ message, onCancel, onConfirm }) {
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 14, color: '#0f172a', marginBottom: 16 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={onConfirm} style={dangerBtn}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ---------------- styles ----------------

const editorShell = {
  display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
}
const editorHeader = {
  paddingBottom: 8, borderBottom: '1px solid #e2e8f0', marginBottom: 8,
}
const searchInput = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  border: '1px solid #cbd5e1', borderRadius: 4,
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
}
const miniBtn = (disabled) => ({
  background: disabled ? '#f1f5f9' : '#fff',
  color: disabled ? '#cbd5e1' : '#0f172a',
  border: '1px solid #cbd5e1',
  borderRadius: 3, padding: '3px 8px',
  fontSize: 11, fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer',
})
const hintText = {
  fontSize: 10, color: '#94a3b8', fontStyle: 'italic',
}
const treeArea = {
  flex: '1 1 auto', overflowY: 'auto', minHeight: 80,
}
const detailContainer = {
  flexShrink: 0, overflowY: 'auto', paddingTop: 6,
}
const resizeHandleStyle = (active) => ({
  flexShrink: 0, height: 7, cursor: 'ns-resize',
  display: 'flex', alignItems: 'center', justifyContent: 'stretch',
  background: active ? '#dbeafe' : 'transparent',
  transition: 'background 0.1s',
  userSelect: 'none',
})
const resizeHandleLineStyle = (active) => ({
  width: '100%',
  height: active ? 2 : 1,
  background: active ? '#3b82f6' : '#e2e8f0',
  transition: 'background 0.1s, height 0.1s',
})
const muted = { fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }
const siblingDropLine = {
  height: 2, background: '#3b82f6', margin: '1px 4px',
  borderRadius: 1, pointerEvents: 'none',
}
const rootDropZone = {
  marginTop: 8, padding: '10px 8px',
  border: '1px dashed #3b82f6',
  borderRadius: 4,
  background: '#eff6ff',
  fontSize: 11, color: '#1e40af',
  textAlign: 'center',
  pointerEvents: 'none',
}
const rootDropHint = { color: '#475569' }
const detailPanel = {
  display: 'flex', flexDirection: 'column',
}
const detailLabel = {
  display: 'block', fontSize: 11, color: '#475569',
  textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
  marginTop: 10, marginBottom: 4,
}
const detailHint = {
  marginLeft: 6, fontSize: 10, color: '#94a3b8',
  textTransform: 'none', letterSpacing: 0, fontWeight: 400,
}
const detailInput = {
  width: '100%', padding: '5px 7px', fontSize: 13,
  border: '1px solid #cbd5e1', borderRadius: 3,
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
}
const closeBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 18, color: '#94a3b8', padding: '0 4px',
}
const chipBox = {}
const chipX = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 13, color: '#475569', padding: '0 2px',
}
const menuHeader = {
  padding: '6px 12px 8px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 12, fontWeight: 600, color: '#0f172a',
  display: 'flex', alignItems: 'center',
}
const menuItemStyle = (danger, disabled, hovered) => {
  let background = 'transparent'
  if (!disabled && hovered) background = danger ? '#fef2f2' : '#f1f5f9'
  return {
    padding: '6px 14px',
    fontSize: 13,
    color: disabled ? '#cbd5e1' : (danger ? '#b91c1c' : '#0f172a'),
    cursor: disabled ? 'default' : 'pointer',
    userSelect: 'none',
    background,
    transition: 'background 0.08s',
  }
}
const menuSeparator = {
  height: 1, background: '#f1f5f9', margin: '4px 0',
}
const overlay = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: 'rgba(15, 23, 42, 0.4)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const dialog = {
  background: '#fff', borderRadius: 6, padding: 20, maxWidth: 420, width: '90%',
  boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
}
const secondaryBtn = {
  background: '#fff', color: '#0f172a',
  border: '1px solid #cbd5e1', borderRadius: 4,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const dangerBtn = {
  background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
