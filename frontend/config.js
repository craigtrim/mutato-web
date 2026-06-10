// API base comes from runtime config (cosc-config.js, issue #175) so it can be
// re-pointed without a rebuild; the literal is only a fallback. The route path
// part is appended to the base.
const COSC_API_BASE =
  (typeof window !== 'undefined' && window.__COSC_API_BASE__) ||
  'https://byw8gzkae2.execute-api.us-west-2.amazonaws.com/prod'
export const API_URL = `${COSC_API_BASE}/mutato_extractor_post`

export const ONTOLOGIES = [
  { id: 'lotr',        label: 'Lord of the Rings' },
  { id: 'oilgas',      label: 'Oil & Gas (1,024)' },
  { id: 'healthcare',  label: 'Urgent Care (8,192)' },
  { id: 'smoketest',   label: 'Smoke test (CRUD)' },
]

export const MAX_INPUT_LEN = 2000
