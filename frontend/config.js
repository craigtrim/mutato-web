// Live mutato-extractor Lambda endpoint (API Gateway, prod stage).
export const API_URL = 'https://340cnsxykj.execute-api.us-west-2.amazonaws.com/prod/mutato_extractor_post'

export const ONTOLOGIES = [
  { id: 'lotr',          label: 'Lord of the Rings' },
  { id: 'animals-test',  label: 'Animals (test)' },
  { id: 'music-test',    label: 'Music (test)' },
]

export const MAX_INPUT_LEN = 2000
