import * as XLSX from 'xlsx'
import type { CellValue, DataRow, EdaSummary, HeatmapData, HistogramChart, CategoricalPieChart, NumericStats } from './types'

type BackendDatasetSummary = {
	rows?: unknown
	columns?: unknown
	summary?: {
		numeric?: Record<string, Record<string, unknown>>
		categorical?: Record<string, Record<string, unknown>>
	}
	missing_values?: {
		total?: unknown
		by_column?: Record<string, unknown>
	}
	correlation_chart?: {
		labels?: unknown
		data?: unknown
	}
	histograms?: Array<{
		column?: unknown
		labels?: unknown
		data?: unknown
	}>
	categorical_pie_charts?: Array<{
		column?: unknown
		labels?: unknown
		data?: unknown
	}>
}

export function formatCell(value: CellValue): string {
	if (value === null) {
		return '—'
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? value.toString() : value.toFixed(2)
	}
	return value
}

export function getFileExtension(fileName: string): string {
	const dotIndex = fileName.lastIndexOf('.')
	if (dotIndex === -1) {
		return ''
	}
	return fileName.slice(dotIndex).toLowerCase()
}

export async function parseDatasetFile(file: File): Promise<DataRow[]> {
	const bytes = await file.arrayBuffer()
	const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
	const firstSheetName = workbook.SheetNames[0]
	if (!firstSheetName) {
		return []
	}

	const sheet = workbook.Sheets[firstSheetName]
	const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
		defval: null,
		raw: true,
	})

	if (records.length === 0) {
		return []
	}

	const columns = new Set<string>()
	for (const record of records) {
		for (const key of Object.keys(record)) {
			columns.add(key)
		}
	}

	const orderedColumns = Array.from(columns)

	return records.map((record) => {
		const normalized: DataRow = {}
		for (const column of orderedColumns) {
			normalized[column] = normalizeCell(record[column])
		}
		return normalized
	})
}

function normalizeCell(value: unknown): CellValue {
	if (value === null || value === undefined) {
		return null
	}

	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}

	if (typeof value === 'boolean') {
		return value ? 'true' : 'false'
	}

	if (value instanceof Date) {
		const year = value.getUTCFullYear()
		const month = String(value.getUTCMonth() + 1).padStart(2, '0')
		const day = String(value.getUTCDate()).padStart(2, '0')
		// Keep date-only representation stable regardless of local timezone.
		return `${year}-${month}-${day}`
	}

	const text = String(value).trim()
	if (!text) {
		return null
	}

	const numericCandidate = Number(text)
	if (Number.isFinite(numericCandidate) && /^[-+]?\d*\.?\d+$/.test(text)) {
		return numericCandidate
	}

	return text
}

export function buildEdaSummary(inputRows: DataRow[]): EdaSummary {
	const columns = Object.keys(inputRows[0] ?? {})
	const totalRows = inputRows.length
	const totalColumns = columns.length
	const totalCells = totalRows * totalColumns

	let missingCells = 0
	const numericByColumn = new Map<string, number[]>()
	const textColumns = new Set<string>()
	const missingByColumn: { name: string; value: number }[] = []

	for (const column of columns) {
		numericByColumn.set(column, [])
		let columnMissing = 0

		for (const row of inputRows) {
			const value = row[column]
			if (value === null) {
				missingCells += 1
				columnMissing += 1
				continue
			}
			if (typeof value === 'number' && Number.isFinite(value)) {
				numericByColumn.get(column)?.push(value)
			} else {
				textColumns.add(column)
			}
		}

		missingByColumn.push({ name: column, value: columnMissing })
	}
	const numericColumns = columns.filter((column) => (numericByColumn.get(column)?.length ?? 0) > 0)
	const numericStats = numericColumns.map((column) => {
		const values = numericByColumn.get(column) ?? []
		const summary = summarizeNumericValues(values)
		return {
			name: column,
			count: values.length,
			min: summary.min,
			max: summary.max,
			mean: summary.mean,
			std: summary.std,
		}
	})

	const histograms = buildHistogram(numericColumns, numericByColumn)
	const categoricalPieCharts = buildCategoricalPieCharts(columns, inputRows, numericColumns)
	const heatmap = buildHeatmap(numericColumns, inputRows)

	return {
		rows: totalRows,
		columns: totalColumns,
		numericColumns: numericColumns.length,
		textColumns: Math.max(totalColumns - numericColumns.length, textColumns.size),
		missingCells,
		completeness: totalCells > 0 ? ((totalCells - missingCells) / totalCells) * 100 : 0,
		numericStats,
		missingByColumn,
		histograms: histograms ?? null,
		categoricalPieCharts,
		heatmap,
	}
}

export function buildEdaSummaryFromBackend(dataset: unknown, inputRows: DataRow[]): EdaSummary | null {
	if (!isObject(dataset)) {
		return null
	}

	const payload = dataset as BackendDatasetSummary
	const fallback = buildEdaSummary(inputRows)

	const rows = toSafeInteger(payload.rows, fallback.rows)
	const columnsList = Array.isArray(payload.columns)
		? payload.columns.filter((value): value is string => typeof value === 'string')
		: Object.keys(inputRows[0] ?? {})
	const columns = columnsList.length > 0 ? columnsList.length : fallback.columns

	const numericStats = mapNumericStats(payload.summary?.numeric)
	const numericColumns = numericStats.length > 0 ? numericStats.length : fallback.numericColumns

	const missingByColumn = mapMissingByColumn(payload.missing_values?.by_column, columnsList)
	const missingCells = toSafeInteger(payload.missing_values?.total, fallback.missingCells)

	const histograms = mapHistograms(payload.histograms)
	const categoricalPieCharts = mapCategoricalPieCharts(payload.categorical_pie_charts)
	const heatmap = mapHeatmap(payload.correlation_chart)

	return {
		rows,
		columns,
		numericColumns,
		textColumns: Math.max(columns - numericColumns, fallback.textColumns),
		missingCells,
		completeness: rows * columns > 0 ? ((rows * columns - missingCells) / (rows * columns)) * 100 : 0,
		numericStats: numericStats.length > 0 ? numericStats : fallback.numericStats,
		missingByColumn: missingByColumn.length > 0 ? missingByColumn : fallback.missingByColumn,
		histograms: histograms ?? fallback.histograms,
		categoricalPieCharts: categoricalPieCharts ?? fallback.categoricalPieCharts,
		heatmap: heatmap ?? fallback.heatmap,
	}
}

function buildHistogram(
	numericColumns: string[],
	numericByColumn: Map<string, number[]>,
): HistogramChart[] | null {
	if (numericColumns.length === 0) {
		return null
	}

	const histograms = []

	for (const columnName of numericColumns) {
		const values = numericByColumn.get(columnName) ?? []
		if (values.length === 0) {
			return null
		}

		const { min, max } = summarizeNumericValues(values)
		if (min === max) {
			histograms.push({
				columnName,
				labels: [`${min.toFixed(2)}`],
				values: [values.length],
			})
			continue
		}

		const bins = 8
		const width = (max - min) / bins
		const counts = new Array<number>(bins).fill(0)

		for (const value of values) {
			const index = Math.min(Math.floor((value - min) / width), bins - 1)
			counts[index] += 1
		}

		const labels = counts.map((_, index) => {
			const start = min + index * width
			const end = start + width
			return `${start.toFixed(1)} - ${end.toFixed(1)}`
		})

		histograms.push({ columnName, labels, values: counts })
	}

	return histograms
}

function buildCategoricalPieCharts(
	columns: string[],
	rows: DataRow[],
	numericColumns: string[],
): CategoricalPieChart[] | null {
	const numericSet = new Set(numericColumns)
	const charts: CategoricalPieChart[] = []

	for (const column of columns) {
		if (numericSet.has(column)) {
			continue
		}

		const counts = new Map<string, number>()
		for (const row of rows) {
			const value = row[column]
			if (value === null) {
				continue
			}
			const label = String(value)
			counts.set(label, (counts.get(label) ?? 0) + 1)
		}

		if (counts.size === 0 || counts.size > 20) {
			continue
		}

		const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1])
		const top = sorted.slice(0, 8)
		const otherTotal = sorted.slice(8).reduce((sum, [, value]) => sum + value, 0)

		const labels = top.map(([label]) => label)
		const values = top.map(([, value]) => value)

		if (otherTotal > 0) {
			labels.push('Other')
			values.push(otherTotal)
		}

		charts.push({ columnName: column, labels, values })
	}

	return charts.length > 0 ? charts.slice(0, 5) : null
}

function summarizeNumericValues(values: number[]): { min: number; max: number; mean: number; std: number } {
	if (values.length === 0) {
		return { min: 0, max: 0, mean: 0, std: 0 }
	}

	let min = values[0]
	let max = values[0]
	let mean = 0
	let m2 = 0

	for (let index = 0; index < values.length; index += 1) {
		const value = values[index]
		if (value < min) {
			min = value
		}
		if (value > max) {
			max = value
		}

		const delta = value - mean
		mean += delta / (index + 1)
		const delta2 = value - mean
		m2 += delta * delta2
	}

	const variance = m2 / values.length
	return {
		min,
		max,
		mean,
		std: Math.sqrt(variance),
	}
}

function buildHeatmap(numericColumns: string[], rows: DataRow[]): HeatmapData | null {
	if (numericColumns.length < 2) {
		return null
	}

	const matrix = numericColumns.map((leftColumn) =>
		numericColumns.map((rightColumn) => correlationForColumns(rows, leftColumn, rightColumn)),
	)

	return { columns: numericColumns, matrix }
}

function correlationForColumns(rows: DataRow[], leftColumn: string, rightColumn: string): number {
	const pairs: Array<[number, number]> = []

	for (const row of rows) {
		const left = row[leftColumn]
		const right = row[rightColumn]
		if (typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)) {
			pairs.push([left, right])
		}
	}

	if (pairs.length < 2) {
		return 0
	}

	const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length
	const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length

	let numerator = 0
	let leftDenominator = 0
	let rightDenominator = 0

	for (const [left, right] of pairs) {
		const leftDelta = left - leftMean
		const rightDelta = right - rightMean
		numerator += leftDelta * rightDelta
		leftDenominator += leftDelta ** 2
		rightDenominator += rightDelta ** 2
	}

	const denominator = Math.sqrt(leftDenominator * rightDenominator)
	if (denominator === 0) {
		return 0
	}

	return numerator / denominator
}

function mapNumericStats(summaryNumeric: Record<string, Record<string, unknown>> | undefined): NumericStats[] {
	if (!summaryNumeric) {
		return []
	}

	const stats: NumericStats[] = []

	for (const [name, values] of Object.entries(summaryNumeric)) {
		const count = toSafeNumber(values.count, 0)
		const min = toSafeNumber(values.min, 0)
		const max = toSafeNumber(values.max, 0)
		const mean = toSafeNumber(values.mean, 0)
		const std = toSafeNumber(values.std, 0)

		stats.push({
			name,
			count,
			min,
			max,
			mean,
			std,
		})
	}

	return stats
}

function mapMissingByColumn(
	missingByColumn: Record<string, unknown> | undefined,
	orderedColumns: string[],
): { name: string; value: number }[] {
	const mapped = new Map<string, number>()

	if (missingByColumn) {
		for (const [column, value] of Object.entries(missingByColumn)) {
			mapped.set(column, toSafeInteger(value, 0))
		}
	}

	if (orderedColumns.length === 0) {
		return Array.from(mapped.entries()).map(([name, value]) => ({ name, value }))
	}

	return orderedColumns.map((name) => ({
		name,
		value: mapped.get(name) ?? 0,
	}))
}

function mapHistograms(source: BackendDatasetSummary['histograms']): HistogramChart[] | null {
	if (!Array.isArray(source) || source.length === 0) {
		return null
	}

	const charts: HistogramChart[] = source
		.map((item) => {
			if (!item || typeof item.column !== 'string' || !Array.isArray(item.labels) || !Array.isArray(item.data)) {
				return null
			}

			const labels = item.labels.map((label) => String(label))
			const values = item.data.map((value) => toSafeInteger(value, 0))

			if (labels.length === 0 || labels.length !== values.length) {
				return null
			}

			return {
				columnName: item.column,
				labels,
				values,
			}
		})
		.filter((chart): chart is HistogramChart => chart !== null)

	return charts.length > 0 ? charts : null
}

function mapCategoricalPieCharts(source: BackendDatasetSummary['categorical_pie_charts']): CategoricalPieChart[] | null {
	if (!Array.isArray(source) || source.length === 0) {
		return null
	}

	const charts: CategoricalPieChart[] = source
		.map((item) => {
			if (!item || typeof item.column !== 'string' || !Array.isArray(item.labels) || !Array.isArray(item.data)) {
				return null
			}

			const labels = item.labels.map((label) => String(label))
			const values = item.data.map((value) => toSafeInteger(value, 0))

			if (labels.length === 0 || labels.length !== values.length) {
				return null
			}

			return {
				columnName: item.column,
				labels,
				values,
			}
		})
		.filter((chart): chart is CategoricalPieChart => chart !== null)

	return charts.length > 0 ? charts : null
}

function mapHeatmap(correlationChart: BackendDatasetSummary['correlation_chart']): HeatmapData | null {
	if (!correlationChart || !Array.isArray(correlationChart.labels) || !Array.isArray(correlationChart.data)) {
		return null
	}

	const columns = correlationChart.labels.filter((label): label is string => typeof label === 'string')
	if (columns.length < 2) {
		return null
	}

	const matrix = correlationChart.data
		.map((row) => {
			if (!Array.isArray(row)) {
				return null
			}
			return row.map((value) => toSafeNumber(value, 0))
		})
		.filter((row): row is number[] => row !== null)

	if (matrix.length !== columns.length || matrix.some((row) => row.length !== columns.length)) {
		return null
	}

	return { columns, matrix }
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function toSafeNumber(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	if (typeof value === 'string') {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) {
			return parsed
		}
	}
	return fallback
}

function toSafeInteger(value: unknown, fallback: number): number {
	const numeric = toSafeNumber(value, fallback)
	return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback
}

export function generateAssistantResponse(question: string, eda: EdaSummary): string {
	const normalizedQuestion = question.toLowerCase()

	if (normalizedQuestion.includes('missing')) {
		const highestMissing = [...eda.missingByColumn].sort((a, b) => b.value - a.value).slice(0, 3)
		return `Top columns with missing values: ${highestMissing.map((item) => `${item.name} (${item.value})`).join(', ')}. Overall completeness is ${eda.completeness.toFixed(1)}%.`
	}

	if (normalizedQuestion.includes('correlation') || normalizedQuestion.includes('heatmap')) {
		if (!eda.heatmap) {
			return 'I cannot compute correlation patterns yet because there are fewer than two numeric columns.'
		}

		let bestPair = 'no strong relationship detected'
		let bestValue = 0

		for (let i = 0; i < eda.heatmap.columns.length; i += 1) {
			for (let j = i + 1; j < eda.heatmap.columns.length; j += 1) {
				const value = eda.heatmap.matrix[i][j]
				if (Math.abs(value) > Math.abs(bestValue)) {
					bestValue = value
					bestPair = `${eda.heatmap.columns[i]} and ${eda.heatmap.columns[j]}`
				}
			}
		}

		return `Strongest linear relationship appears between ${bestPair} with correlation ${bestValue.toFixed(2)}.`
	}

	if (normalizedQuestion.includes('summary') || normalizedQuestion.includes('overview')) {
		return `The dataset has ${eda.rows} rows and ${eda.columns} columns. Numeric columns: ${eda.numericColumns}. Text columns: ${eda.textColumns}. Missing cells: ${eda.missingCells}. Completeness: ${eda.completeness.toFixed(1)}%.`
	}

	if (eda.numericStats.length > 0) {
		const topStat = eda.numericStats[0]
		return `A quick read: ${topStat.name} has mean ${topStat.mean.toFixed(2)}, min ${topStat.min.toFixed(2)}, max ${topStat.max.toFixed(2)}, and standard deviation ${topStat.std.toFixed(2)}. You can ask for anomalies, outliers, or feature relationships.`
	}

	return 'The file was loaded correctly, but I found very limited numeric structure. Ask me to inspect missing values, categorical patterns, or quality checks.'
}
