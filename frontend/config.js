// Live mutato-extractor Lambda endpoint (API Gateway, prod stage).
export const API_URL = 'https://340cnsxykj.execute-api.us-west-2.amazonaws.com/prod/mutato_extractor_post'

export const ONTOLOGIES = [
  { id: 'lotr',        label: 'Lord of the Rings' },
  { id: 'oilgas',      label: 'Oil & Gas (1,024)' },
  { id: 'healthcare',  label: 'Urgent Care (8,192)' },
  { id: 'smoketest',   label: 'Smoke test (CRUD)' },
]

export const MAX_INPUT_LEN = 2000
