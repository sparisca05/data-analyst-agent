import type { ChartType } from 'chart.js'

export type CellValue = string | number | null
export type DataRow = Record<string, CellValue>

export type NumericStats = {
	name: string
	count: number
	min: number
	max: number
	mean: number
	std: number
}

export type HeatmapData = {
	columns: string[]
	matrix: number[][]
}

export type EdaSummary = {
	rows: number
	columns: number
	numericColumns: number
	textColumns: number
	missingCells: number
	completeness: number
	numericStats: NumericStats[]
	missingByColumn: { name: string; value: number }[]
	histograms: { labels: string[]; values: number[]; columnName: string }[] | null
	heatmap: HeatmapData | null
}

export type ChatPoint = {
	x: number | string
	y: number | string
}

export type SupportedChatChartType = 'bar' | 'scatter' | 'line' | 'pie' | 'doughnut'

export type ChartDataset = {
	label?: string
	data: Array<number | string | ChatPoint>
	backgroundColor?: string | string[]
	borderColor?: string | string[]
	borderWidth?: number
	pointRadius?: number
	showLine?: boolean
	[key: string]: unknown
}

export type ChatMessage = {
	id: number
	role: 'user' | 'assistant' | 'chart'
	text: string
	datasets?: ChartDataset[]
	labels?: string[]
	type?: ChartType
}

export type PreparedChartResult =
	| {
			ok: true
			type: SupportedChatChartType
			labels?: string[]
			datasets: ChartDataset[]
			scales?: Record<string, unknown>
			legendDisplay: boolean
	  }
	| {
			ok: false
			reason: string
	  }
