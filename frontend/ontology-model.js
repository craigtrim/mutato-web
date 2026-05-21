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

export const MAX_ENTITIES = 10000
export const DEFAULT_NAMESPACE = 'https://craigtrim.com/ontologies/custom#'

// Subject names that the MDA dict uses internally and should not surface as
// editable entities. 'class' and 'ontology' are predicate-value names that
// re-appear as subjects of `rdf:type` in the compiled dict.
const SUPPRESSED_SUBJECTS = new Set(['class', 'ontology'])

// The ontology declaration (e.g. `:LotrMutatoOntology a owl:Ontology`) lands
// in the MDA dict with a label and `rdf:type ontology`. Filter any subject
// whose rdf:type set names it as an ontology, regardless of the name. This
// avoids hard-coding "lotrmutatoontology" / "oilgasmutatoontology" / etc.
function isOntologyMeta(lk, rdfType) {
  if (SUPPRESSED_SUBJECTS.has(lk)) return true
  const types = rdfType[lk] || []
  return types.includes('ontology')
}

// Build the source-shape entity dict from a compiled mutato MDA dict.
export function mdaToEntities(mda) {
  if (!mda || !mda.labels) return {}
  const byPred = mda.by_predicate || {}
  const subClassOf = byPred['rdfs:subClassOf'] || {}
  const rdfType = byPred['rdf:type'] || {}
  const altLabel = byPred['skos:altLabel'] || {}
  const inflection = byPred[':inflection'] || {}
  // Semantic enrichments. Most baked ontologies won't have these; default
  // to absent. The mutato compiler retains them in by_predicate when the
  // source TTL declares them, so loading a user-saved TTL round-trips.
  const comment = byPred['rdfs:comment'] || {}
  const equivalentClass = byPred['owl:equivalentClass'] || {}
  const disjointWith = byPred['owl:disjointWith'] || {}

  // Index labels by lowercased name so we can recover original case.
  const properCase = {}
  for (const k of Object.keys(mda.labels)) {
    properCase[k.toLowerCase()] = k
  }
  const restoreNames = (arr) => (arr || []).map(v => properCase[v] || v)

  const out = {}

  // Pass 1: classes (anything with rdfs:subClassOf, OR with rdf:type == "class").
  for (const lk of Object.keys(subClassOf)) {
    if (isOntologyMeta(lk, rdfType)) continue
    const name = properCase[lk] || lk
    out[name] = {
      name,
      kind: 'class',
      label: mda.labels[name] || name,
      parent: subClassOf[lk] && subClassOf[lk][0] ? properCase[subClassOf[lk][0]] || subClassOf[lk][0] : null,
      altLabels: (altLabel[lk] || []).slice(),
      inflections: (inflection[lk] || []).slice(),
      comment: (comment[lk] || [])[0] || '',
      equivalentClasses: restoreNames(equivalentClass[lk]),
      disjointWith: restoreNames(disjointWith[lk]),
    }
  }
  for (const lk of Object.keys(rdfType)) {
    if (isOntologyMeta(lk, rdfType)) continue
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
        comment: (comment[lk] || [])[0] || '',
        equivalentClasses: restoreNames(equivalentClass[lk]),
        disjointWith: restoreNames(disjointWith[lk]),
      }
    }
  }

  // Pass 2: instances (rdf:type to something not in {'class','ontology'}).
  for (const lk of Object.keys(rdfType)) {
    if (isOntologyMeta(lk, rdfType)) continue
    const t = rdfType[lk] || []
    const parentLower = t.find(v => !SUPPRESSED_SUBJECTS.has(v))
    if (!parentLower) continue
    const name = properCase[lk] || lk
    if (out[name]) continue  // already a class
    out[name] = {
      name,
      kind: 'instance',
      label: mda.labels[name] || name,
      parent: properCase[parentLower] || parentLower,
      altLabels: (altLabel[lk] || []).slice(),
      comment: (comment[lk] || [])[0] || '',
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
    for (const t of e.equivalentClasses || []) parts.push(`owl:equivalentClass :${ttlIdent(t)}`)
    for (const t of e.disjointWith || []) parts.push(`owl:disjointWith :${ttlIdent(t)}`)
    if (e.comment && e.comment.trim()) parts.push(`rdfs:comment ${ttlString(e.comment.trim())}`)
    lines.push(parts.join(' ;\n    ') + ' .')
    lines.push('')
  }

  for (const e of instances) {
    const parent = e.parent ? `:${ttlIdent(e.parent)}` : `owl:NamedIndividual`
    const parts = [`:${ttlIdent(e.name)} a ${parent}`]
    parts.push(`rdfs:label ${ttlString(e.label || e.name)}`)
    for (const a of e.altLabels || []) parts.push(`skos:altLabel ${ttlString(a)}`)
    if (e.comment && e.comment.trim()) parts.push(`rdfs:comment ${ttlString(e.comment.trim())}`)
    lines.push(parts.join(' ;\n    ') + ' .')
    lines.push('')
  }

  return lines.join('\n')
}

// Serialize a single entity to a TTL fragment (no prefix or ontology
// header). Mirrors the per-entity emission in `entitiesToTtl` so that
// round-tripping a fragment through `parseEntityTtlFragment` and back
// produces the same text.
export function entityToTtlFragment(entity) {
  if (!entity) return ''
  const parts = []
  if (entity.kind === 'class') {
    parts.push(`:${ttlIdent(entity.name)} a owl:Class`)
    if (entity.parent) parts.push(`rdfs:subClassOf :${ttlIdent(entity.parent)}`)
  } else {
    const parent = entity.parent ? `:${ttlIdent(entity.parent)}` : 'owl:NamedIndividual'
    parts.push(`:${ttlIdent(entity.name)} a ${parent}`)
  }
  parts.push(`rdfs:label ${ttlString(entity.label || entity.name)}`)
  for (const a of entity.altLabels || []) parts.push(`skos:altLabel ${ttlString(a)}`)
  if (entity.kind === 'class') {
    for (const f of entity.inflections || []) parts.push(`:inflection ${ttlString(f)}`)
    for (const t of entity.equivalentClasses || []) parts.push(`owl:equivalentClass :${ttlIdent(t)}`)
    for (const t of entity.disjointWith || []) parts.push(`owl:disjointWith :${ttlIdent(t)}`)
  }
  if (entity.comment && entity.comment.trim()) {
    parts.push(`rdfs:comment ${ttlString(entity.comment.trim())}`)
  }
  return parts.join(' ;\n    ') + ' .'
}

// Parse a per-entity TTL fragment back into an Entity object. Constrained
// to the predicates we emit ourselves — this is not a general Turtle
// parser. Returns `{ entity }` on success, `{ error: string }` on failure.
//
// The fragment is expected to look like the output of
// `entityToTtlFragment`: subject + predicate-object pairs separated by
// `;`, terminated by `.`. Comments (`#...`) and whitespace are tolerated.
// The identifier in the TTL must match `originalName` — we don't allow
// renaming an entity via this surface (that would orphan child references
// and break the React key contract).
export function parseEntityTtlFragment(ttl, originalName) {
  if (typeof ttl !== 'string') return { error: 'TTL must be a string.' }
  const clean = ttl.replace(/#.*$/gm, '').trim()
  if (!clean) return { error: 'TTL is empty.' }

  // Extract the leading subject: `:Name` followed by whitespace.
  const subjectMatch = /^:([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(clean)
  if (!subjectMatch) {
    return { error: 'Expected a subject like `:Name` at the start of the fragment.' }
  }
  const name = subjectMatch[1]
  if (originalName && name !== originalName) {
    return { error: `Identifier mismatch: TTL says :${name} but this entity is :${originalName}. Renaming an entity from the TTL view isn't supported here.` }
  }
  const rest = clean.slice(subjectMatch[0].length)

  // Split rest into clauses on `;` and `.` while respecting quoted
  // strings. We deliberately don't use a single regex — the escape rules
  // are easier to get right with a char loop.
  const clauses = []
  let buf = ''
  let inString = false
  let escape = false
  let sawTerminator = false
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (escape) { buf += ch; escape = false; continue }
    if (inString) {
      if (ch === '\\') { buf += ch; escape = true; continue }
      if (ch === '"') { buf += ch; inString = false; continue }
      buf += ch
      continue
    }
    if (ch === '"') { buf += ch; inString = true; continue }
    if (ch === ';') {
      if (buf.trim()) clauses.push(buf.trim())
      buf = ''
      continue
    }
    if (ch === '.') {
      if (buf.trim()) clauses.push(buf.trim())
      buf = ''
      sawTerminator = true
      break
    }
    buf += ch
  }
  if (inString) return { error: 'Unterminated quoted string.' }
  if (!sawTerminator) return { error: 'Missing terminating `.`' }

  const next = {
    name,
    kind: 'instance',
    label: '',
    parent: null,
    altLabels: [],
    inflections: [],
    equivalentClasses: [],
    disjointWith: [],
    comment: '',
  }
  let hadType = false

  for (const c of clauses) {
    const m = /^(\S+)\s+([\s\S]+)$/.exec(c)
    if (!m) return { error: `Could not split clause into predicate + object: "${c}"` }
    const pred = m[1]
    const obj = m[2].trim()

    if (pred === 'a' || pred === 'rdf:type') {
      hadType = true
      if (obj === 'owl:Class') next.kind = 'class'
      else if (obj === 'owl:NamedIndividual') next.kind = 'instance'
      else if (obj.startsWith(':')) {
        next.kind = 'instance'
        next.parent = obj.slice(1).trim()
      } else {
        return { error: `Unsupported type object: ${obj}` }
      }
    } else if (pred === 'rdfs:subClassOf') {
      if (!obj.startsWith(':')) return { error: `subClassOf must be a prefixed name: ${obj}` }
      next.parent = obj.slice(1).trim()
    } else if (pred === 'rdfs:label') {
      next.label = unquoteTtlString(obj)
    } else if (pred === 'skos:altLabel') {
      next.altLabels.push(unquoteTtlString(obj))
    } else if (pred === ':inflection') {
      next.inflections.push(unquoteTtlString(obj))
    } else if (pred === 'owl:equivalentClass') {
      if (!obj.startsWith(':')) return { error: `owl:equivalentClass must be a prefixed name: ${obj}` }
      next.equivalentClasses.push(obj.slice(1).trim())
    } else if (pred === 'owl:disjointWith') {
      if (!obj.startsWith(':')) return { error: `owl:disjointWith must be a prefixed name: ${obj}` }
      next.disjointWith.push(obj.slice(1).trim())
    } else if (pred === 'rdfs:comment') {
      next.comment = unquoteTtlString(obj)
    }
    // Unknown predicates are silently dropped — keeps the surface forgiving
    // when users paste in TTL that has annotations we don't model.
  }

  if (!hadType) return { error: 'Missing `a <type>` clause.' }
  if (!next.label) next.label = name

  // Drop class-only fields when the entity is an instance, to keep the
  // resulting object minimal.
  if (next.kind === 'instance') {
    delete next.inflections
    delete next.equivalentClasses
    delete next.disjointWith
  }
  return { entity: next }
}

function unquoteTtlString(raw) {
  const s = raw.trim()
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return s
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

export function setComment(state, name, value) {
  const e = state.entities[name]
  if (!e) return state
  const v = String(value || '')
  return updateEntity(state, name, { comment: v })
}

// Shared add/remove for class-target chip lists (equivalentClasses,
// disjointWith). Validates that the target exists, is a class, and is
// not the entity itself. Case-insensitive de-dup on add.
function addClassRef(state, name, target, field) {
  const t = String(target || '').trim()
  if (!t || t === name) return state
  const e = state.entities[name]
  const tgt = state.entities[t]
  if (!e || e.kind !== 'class' || !tgt || tgt.kind !== 'class') return state
  const current = e[field] || []
  if (current.some(x => x.toLowerCase() === t.toLowerCase())) return state
  return updateEntity(state, name, { [field]: [...current, t] })
}

function removeClassRef(state, name, target, field) {
  const e = state.entities[name]
  if (!e) return state
  return updateEntity(state, name, {
    [field]: (e[field] || []).filter(x => x !== target),
  })
}

export function addEquivalentClass(state, name, target) {
  return addClassRef(state, name, target, 'equivalentClasses')
}
export function removeEquivalentClass(state, name, target) {
  return removeClassRef(state, name, target, 'equivalentClasses')
}
export function addDisjointWith(state, name, target) {
  return addClassRef(state, name, target, 'disjointWith')
}
export function removeDisjointWith(state, name, target) {
  return removeClassRef(state, name, target, 'disjointWith')
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
