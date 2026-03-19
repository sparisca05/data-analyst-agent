export const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls']

export const SUGGESTED_PROMPTS = [
	'Give me a brief description of this dataset',
	'Which are the insights of the dataset I need to know?',
	'Show me the average [column] by [column]',
	'Detect outliers for the feature [column]',
	'Create a graph that shows the distribution of [column]',
	'Which features correlate with [column]',
]

export const CONNECTION_RETRY_MS = 2500
export const CONNECTION_TIMEOUT_MS = 12000
export const MAX_CONNECTION_WAIT_MS = 120000
