import type { ChartType } from 'chart.js'
import type { ChartDataset, ChatPoint, PreparedChartResult, SupportedChatChartType } from './types'

export function prepareChatChart(
	datasets: ChartDataset[] | undefined,
	labels: string[] | undefined,
	type: ChartType | undefined,
): PreparedChartResult {
	if (!datasets || datasets.length === 0) {
		return { ok: false, reason: 'Chart data is missing datasets.' }
	}

	const chartType = normalizeChartType(type, datasets)
	if (!chartType) {
		return { ok: false, reason: `Unsupported chart type: ${String(type)}.` }
	}

	if (chartType === 'scatter') {
		return prepareScatterChart(datasets)
	}

	if (chartType === 'line') {
		return prepareLineChart(datasets, labels)
	}

	if (chartType === 'pie' || chartType === 'doughnut') {
		return prepareRadialChart(chartType, datasets, labels)
	}

	return prepareBarChart(datasets, labels)
}

function normalizeChartType(type: ChartType | undefined, datasets: ChartDataset[]): SupportedChatChartType | null {
	if (!type) {
		return inferChartType(datasets)
	}

	if (type === 'bar' || type === 'scatter' || type === 'line' || type === 'pie' || type === 'doughnut') {
		return type
	}

	return null
}

function prepareBarChart(datasets: ChartDataset[], labels: string[] | undefined): PreparedChartResult {
	const parsed = parseSeriesDatasets(datasets)
	if (!parsed.ok) {
		return parsed
	}

	const datasetLength = parsed.datasets[0]?.data.length ?? 0
	const safeLabels = labels && labels.length > 0 ? labels : buildDefaultLabels(datasetLength)

	if (safeLabels.length !== datasetLength) {
		return { ok: false, reason: 'Bar chart labels length must match dataset values length.' }
	}

	return {
		ok: true,
		type: 'bar',
		labels: safeLabels,
		datasets: parsed.datasets.map((dataset) => ({
			...dataset,
			borderRadius: 6,
		})),
		scales: {
			x: {
				ticks: {
					autoSkip: true,
					maxRotation: 0,
					minRotation: 0,
					maxTicksLimit: 7,
				},
			},
			y: {
				beginAtZero: true,
				ticks: { precision: 0 },
			},
		},
		legendDisplay: parsed.datasets.length > 1,
	}
}

function prepareScatterChart(datasets: ChartDataset[]): PreparedChartResult {
	const resolvedDatasets: ChartDataset[] = []

	for (const dataset of datasets) {
		const points = dataset.data.filter((value): value is ChatPoint => isChartPoint(value))
		if (points.length !== dataset.data.length || points.length === 0) {
			return { ok: false, reason: 'Scatter chart requires each dataset item to be an {x, y} point.' }
		}

		resolvedDatasets.push({
			...dataset,
			data: points,
			showLine: dataset.showLine ?? false,
			pointRadius: dataset.pointRadius ?? 4,
		})
	}

	const points = resolvedDatasets.flatMap((dataset) => dataset.data as ChatPoint[])
	const xType = inferAxisType(points.map((point) => point.x))
	const yType = inferAxisType(points.map((point) => point.y))

	return {
		ok: true,
		type: 'scatter',
		datasets: resolvedDatasets,
		scales: {
			x: {
				type: xType,
				ticks: {
					autoSkip: true,
					maxRotation: 0,
					minRotation: 0,
					maxTicksLimit: 8,
				},
			},
			y: {
				type: yType,
				ticks: {
					autoSkip: true,
					maxRotation: 0,
					minRotation: 0,
					maxTicksLimit: 8,
				},
			},
		},
		legendDisplay: resolvedDatasets.length > 1,
	}
}

function prepareLineChart(datasets: ChartDataset[], labels: string[] | undefined): PreparedChartResult {
	const hasPointSeries = datasets.some((dataset) => hasPointData(dataset.data))

	if (hasPointSeries) {
		const scatterLike = prepareScatterChart(datasets)
		if (!scatterLike.ok) {
			return { ok: false, reason: 'Line chart point mode requires each item to be a valid {x, y} point.' }
		}

		return {
			...scatterLike,
			type: 'line',
			datasets: scatterLike.datasets.map((dataset) => ({
				...dataset,
				showLine: true,
				pointRadius: dataset.pointRadius ?? 3,
			})),
		}
	}

	const parsed = parseSeriesDatasets(datasets)
	if (!parsed.ok) {
		return parsed
	}

	const datasetLength = parsed.datasets[0]?.data.length ?? 0
	const safeLabels = labels && labels.length > 0 ? labels : buildDefaultLabels(datasetLength)
	if (safeLabels.length !== datasetLength) {
		return { ok: false, reason: 'Line chart labels length must match dataset values length.' }
	}

	return {
		ok: true,
		type: 'line',
		labels: safeLabels,
		datasets: parsed.datasets.map((dataset) => ({
			...dataset,
			pointRadius: dataset.pointRadius ?? 3,
			showLine: dataset.showLine ?? true,
		})),
		scales: {
			x: {
				ticks: {
					autoSkip: true,
					maxRotation: 0,
					minRotation: 0,
					maxTicksLimit: 8,
				},
			},
			y: {
				ticks: { precision: 2 },
			},
		},
		legendDisplay: parsed.datasets.length > 1,
	}
}

function prepareRadialChart(
	type: 'pie' | 'doughnut',
	datasets: ChartDataset[],
	labels: string[] | undefined,
): PreparedChartResult {
	const parsed = parseSeriesDatasets(datasets)
	if (!parsed.ok) {
		return { ok: false, reason: `${type} chart requires numeric series data.` }
	}

	const datasetLength = parsed.datasets[0]?.data.length ?? 0
	const safeLabels = labels && labels.length > 0 ? labels : buildDefaultLabels(datasetLength)
	if (safeLabels.length !== datasetLength) {
		return { ok: false, reason: `${type} chart labels length must match dataset values length.` }
	}

	return {
		ok: true,
		type,
		labels: safeLabels,
		datasets: parsed.datasets,
		legendDisplay: true,
	}
}

function parseSeriesDatasets(
	datasets: ChartDataset[],
): { ok: true; datasets: ChartDataset[] } | { ok: false; reason: string } {
	const parsedDatasets: ChartDataset[] = []

	for (const dataset of datasets) {
		if (dataset.data.length === 0) {
			return { ok: false, reason: 'One of the chart datasets is empty.' }
		}

		const values: number[] = []
		for (const value of dataset.data) {
			if (isChartPoint(value)) {
				return { ok: false, reason: 'Point data was provided where numeric series data was expected.' }
			}

			const parsed = toFiniteNumber(value)
			if (parsed === null) {
				return { ok: false, reason: 'Found non-numeric series values that cannot be plotted.' }
			}
			values.push(parsed)
		}

		parsedDatasets.push({
			...dataset,
			data: values,
		})
	}

	const expectedLength = parsedDatasets[0]?.data.length ?? 0
	if (!parsedDatasets.every((dataset) => dataset.data.length === expectedLength)) {
		return { ok: false, reason: 'All datasets for this chart must have the same number of values.' }
	}

	return { ok: true, datasets: parsedDatasets }
}

function buildDefaultLabels(length: number): string[] {
	return Array.from({ length }, (_, index) => `Item ${index + 1}`)
}

function toFiniteNumber(value: number | string): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}

	const trimmed = value.trim()
	if (!trimmed) {
		return null
	}

	const numeric = Number(trimmed)
	return Number.isFinite(numeric) ? numeric : null
}

function inferChartType(datasets: ChartDataset[]): SupportedChatChartType {
	if (datasets.some((dataset) => hasPointData(dataset.data))) {
		return 'scatter'
	}
	return 'bar'
}

function hasPointData(data: Array<number | string | ChatPoint>): boolean {
	return data.some((value) => isChartPoint(value))
}

function isChartPoint(value: number | string | ChatPoint): value is ChatPoint {
	return typeof value === 'object' && value !== null && 'x' in value && 'y' in value
}

function inferAxisType(values: Array<number | string>): 'linear' | 'category' {
	const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
	if (numericValues.length === values.length && values.length > 0) {
		return 'linear'
	}
	return 'category'
}
