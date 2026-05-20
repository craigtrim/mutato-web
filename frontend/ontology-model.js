// Source-shape ontology model used by the editor.
//
// Each entity is one of:
//   { name, kind: 'class',    label, parent, altLabels, inflections, order? }
//   { name, kind: 'instance', label, parent, altLabels, order? }
//
// `parent` is the name of another entity (a class). Top-level classes have
// parent: null.
//
// `order` is optional. When present, it controls the entity's position
// among its siblings (lower = first). When absent, the entity falls into
// the alphabetic tail after any ordered siblings. Ordering is purely a
// display-and-serialization concern; it does not affect mutato's MDA
// compilation or matching behavior.
//
// The state shape kept in React is:
//   {
//     namespace: 'https://...#',
//     entities: { [name]: Entity }
//   }
//
// All edits return a new state (immutable). All functions in this module are
// pure.

export const MAX_ENTITIES = 1000
export const DEFAULT_NAMESPACE = 'https://craigtrim.com/ontologies/custom#'

// Names that the MDA dict uses internally and should not surface as entities.
const SUPPRESSED = new Set(['lotrmutatoontology', 'class', 'ontology'])

// Build the source-shape entity dict from a compiled mutato MDA dict.
export function mdaToEntities(mda) {
  if (!mda || !mda.labels) return {}
  const byPred = mda.by_predicate || {}
  const subClassOf = byPred['rdfs:subClassOf'] || {}
  const rdfType = byPred['rdf:type'] || {}
  const altLabel = byPred['skos:altLabel'] || {}
  const inflection = byPred[':inflection'] || {}

  // Index labels by lowercased name so we can recover original case.
  const properCase = {}
  for (const k of Object.keys(mda.labels)) {
    properCase[k.toLowerCase()] = k
  }

  const out = {}

  // Pass 1: classes (anything with rdfs:subClassOf, OR with rdf:type == "class").
  for (const lk of Object.keys(subClassOf)) {
    if (SUPPRESSED.has(lk)) continue
    const name = properCase[lk] || lk
    out[name] = {
      name,
      kind: 'class',
      label: mda.labels[name] || name,
      parent: subClassOf[lk] && subClassOf[lk][0] ? properCase[subClassOf[lk][0]] || subClassOf[lk][0] : null,
      altLabels: (altLabel[lk] || []).slice(),
      inflections: (inflection[lk] || []).slice(),
    }
  }
  for (const lk of Object.keys(rdfType)) {
    if (SUPPRESSED.has(lk)) continue
    const t = rdfType[lk] || []
    if (t.includes('class') && !out[properCase[lk] || lk]) {
      const name = properCase[lk] || lk
      out[name] = {
        name,
        kind: 'class',
        label: mda.labels[name] || name,
        parent: null,
        altLabels: (altLabel[lk] || []).slice(),
        inflections: (inflection[lk] || []).slice(),
      }
    }
  }

  // Pass 2: instances (rdf:type to something not in {'class','ontology'}).
  for (const lk of Object.keys(rdfType)) {
    if (SUPPRESSED.has(lk)) continue
    const t = rdfType[lk] || []
    const parentLower = t.find(v => !SUPPRESSED.has(v))
    if (!parentLower) continue
    const name = properCase[lk] || lk
    if (out[name]) continue  // already a class
    out[name] = {
      name,
      kind: 'instance',
      label: mda.labels[name] || name,
      parent: properCase[parentLower] || parentLower,
      altLabels: (altLabel[lk] || []).slice(),
    }
  }

  return out
}

// Serialize the entity dict to a TTL string suitable for OntologyParser.
//
// The ontology declaration uses the prefix-style name `:CustomOntology`
// rather than an absolute IRI in angle brackets. mutato's entity-discovery
// SPARQL (`SELECT ?x WHERE { ?x rdfs:label ?a }`) catches anything with an
// `rdfs:label`, including the ontology declaration, and then substitutes
// the entity into `:#ENTITY` for the child query. That substitution only
// works for prefixed names — full IRIs collapse into invalid SPARQL like
// `:https://craigtrim.com/...`. Keeping the ontology name short-prefixed
// keeps the discovery loop honest.
export function entitiesToTtl(entities, namespace = DEFAULT_NAMESPACE) {
  const lines = [
    `@prefix : <${namespace}> .`,
    `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
    `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .`,
    ``,
    `:CustomOntology a owl:Ontology ;`,
    `    rdfs:label "Custom Mutato Ontology" .`,
    ``,
  ]

  // Classes first, instances second (mutato is forgiving but it reads better).
  // Within each section, respect the user's display order: ordered entities
  // first, sorted by their `order` number; unordered entities alphabetical
  // by label as a tail.
  const byOrderThenLabel = (a, b) => {
    const oa = a.order ?? Number.POSITIVE_INFINITY
    const ob = b.order ?? Number.POSITIVE_INFINITY
    if (oa !== ob) return oa - ob
    return (a.label || a.name).localeCompare(b.label || b.name)
  }
  const classes = Object.values(entities)
    .filter(e => e.kind === 'class')
    .sort(byOrderThenLabel)
  const instances = Object.values(entities)
    .filter(e => e.kind === 'instance')
    .sort(byOrderThenLabel)

  for (const e of classes) {
    const parts = [`:${ttlIdent(e.name)} a owl:Class`]
    if (e.parent) parts.push(`rdfs:subClassOf :${ttlIdent(e.parent)}`)
    parts.push(`rdfs:label ${ttlString(e.label || e.name)}`)
    for (const a of e.altLabels || []) parts.push(`skos:altLabel ${ttlString(a)}`)
    for (const f of e.inflections || []) parts.push(`:inflection ${ttlString(f)}`)
    lines.push(parts.join(' ;\n    ') + ' .')
    lines.push('')
  }

  for (const e of instances) {
    const parent = e.parent ? `:${ttlIdent(e.parent)}` : `owl:NamedIndividual`
    const parts = [`:${ttlIdent(e.name)} a ${parent}`]
    parts.push(`rdfs:label ${ttlString(e.label || e.name)}`)
    for (const a of e.altLabels || []) parts.push(`skos:altLabel ${ttlString(a)}`)
    lines.push(parts.join(' ;\n    ') + ' .')
    lines.push('')
  }

  return lines.join('\n')
}

// Mutato/Turtle identifiers must match [A-Za-z_][A-Za-z0-9_]*. Replace
// anything else with underscores. Callers should also avoid leading digits.
export function ttlIdent(name) {
  let s = String(name).replace(/[^A-Za-z0-9_]/g, '_')
  if (/^[0-9]/.test(s)) s = '_' + s
  return s
}

function ttlString(s) {
  // Escape backslashes and double-quotes per Turtle spec; preserve unicode.
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

// ---------------- edit operations (pure) ----------------

export function addEntity(state, entity) {
  if (state.entities[entity.name]) return state
  if (Object.keys(state.entities).length >= MAX_ENTITIES) return state
  return { ...state, entities: { ...state.entities, [entity.name]: entity } }
}

export function removeEntity(state, name) {
  if (!state.entities[name]) return state
  const next = { ...state.entities }
  delete next[name]
  // Reparent any orphans (entities whose parent was the removed one) up to
  // the removed entity's parent. This avoids dangling references.
  const removed = state.entities[name]
  for (const k of Object.keys(next)) {
    if (next[k].parent === name) {
      next[k] = { ...next[k], parent: removed.parent }
    }
  }
  return { ...state, entities: next }
}

export function updateEntity(state, name, patch) {
  if (!state.entities[name]) return state
  return {
    ...state,
    entities: { ...state.entities, [name]: { ...state.entities[name], ...patch } },
  }
}

export function addAltLabel(state, name, value) {
  const v = String(value || '').trim()
  if (!v) return state
  const e = state.entities[name]
  if (!e) return state
  if ((e.altLabels || []).some(a => a.toLowerCase() === v.toLowerCase())) return state
  return updateEntity(state, name, { altLabels: [...(e.altLabels || []), v] })
}

export function removeAltLabel(state, name, value) {
  const e = state.entities[name]
  if (!e) return state
  return updateEntity(state, name, { altLabels: (e.altLabels || []).filter(a => a !== value) })
}

export function addInflection(state, name, value) {
  const v = String(value || '').trim()
  if (!v) return state
  const e = state.entities[name]
  if (!e || e.kind !== 'class') return state
  if ((e.inflections || []).some(f => f.toLowerCase() === v.toLowerCase())) return state
  return updateEntity(state, name, { inflections: [...(e.inflections || []), v] })
}

export function removeInflection(state, name, value) {
  const e = state.entities[name]
  if (!e) return state
  return updateEntity(state, name, { inflections: (e.inflections || []).filter(f => f !== value) })
}

// ---------------- derived views ----------------

// Build a parent -> [children names] index for tree rendering.
//
// Sort key per sibling: [order ?? Infinity, kind, label]. Ordered entities
// come first, sorted by their `order` number. Unordered entities fall to
// the alpha tail: classes before instances, alphabetical within each kind.
export function buildChildIndex(entities) {
  const idx = { __roots: [] }
  for (const name of Object.keys(entities)) {
    const e = entities[name]
    if (!e.parent) {
      idx.__roots.push(name)
    } else {
      if (!idx[e.parent]) idx[e.parent] = []
      idx[e.parent].push(name)
    }
  }
  for (const k of Object.keys(idx)) {
    idx[k].sort((a, b) => siblingCompare(entities[a], entities[b]))
  }
  return idx
}

function siblingCompare(ea, eb) {
  if (!ea || !eb) return 0
  const oa = ea.order ?? Number.POSITIVE_INFINITY
  const ob = eb.order ?? Number.POSITIVE_INFINITY
  if (oa !== ob) return oa - ob
  if (ea.kind !== eb.kind) return ea.kind === 'class' ? -1 : 1
  return (ea.label || ea.name).localeCompare(eb.label || eb.name)
}

// Move `sourceName` next to `anchorName` (above or below) and reassign
// sequential `order: 1..N` to every sibling under the resulting parent.
// The sibling order is taken from `buildChildIndex` so what-you-see is
// what-you-get: if the user dropped Ring between Maia and Orc as they
// currently appear in the tree, that exact sequence is what gets numbered.
export function insertSibling(state, sourceName, anchorName, position) {
  if (sourceName === anchorName) return state
  const source = state.entities[sourceName]
  const anchor = state.entities[anchorName]
  if (!source || !anchor) return state
  if (position !== 'above' && position !== 'below') return state

  const newParent = anchor.parent  // may be null for top-level
  // Snapshot pre-move sibling display order under the new parent.
  const pre = buildChildIndex(state.entities)
  const preSiblings = (newParent ? pre[newParent] : pre.__roots) || []
  // Remove source if it was already a sibling under newParent.
  const siblings = preSiblings.filter(n => n !== sourceName)
  const anchorIdx = siblings.indexOf(anchorName)
  if (anchorIdx === -1) return state
  const insertAt = position === 'above' ? anchorIdx : anchorIdx + 1
  siblings.splice(insertAt, 0, sourceName)

  // Apply: source.parent + sequential orders for every sibling.
  const nextEntities = { ...state.entities }
  nextEntities[sourceName] = { ...source, parent: newParent }
  siblings.forEach((n, i) => {
    nextEntities[n] = { ...nextEntities[n], order: i + 1 }
  })
  return { ...state, entities: nextEntities }
}

// Suggest a unique entity name from a label string (e.g. "Frodo Baggins" -> "FrodoBaggins").
// Avoids collisions with existing entity names.
export function suggestName(existing, base) {
  let stem = ttlIdent(String(base || 'New').replace(/\s+/g, '_'))
  if (!stem) stem = 'New'
  if (!existing[stem]) return stem
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}_${i}`
    if (!existing[candidate]) return candidate
  }
  return `${stem}_${Date.now()}`
}
