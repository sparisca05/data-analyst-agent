import { useEffect, useMemo, useRef, useState } from 'react'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'

type CellValue = string | number | null
type DataRow = Record<string, CellValue>

type NumericStats = {
	name: string
	count: number
	min: number
	max: number
	mean: number
	std: number
}

type HeatmapData = {
	columns: string[]
	matrix: number[][]
}

type EdaSummary = {
	rows: number
	columns: number
	numericColumns: number
	textColumns: number
	missingCells: number
	completeness: number
	numericStats: NumericStats[]
	missingByColumn: { name: string; value: number }[]
	histogram: { labels: string[]; values: number[]; columnName: string } | null
	heatmap: HeatmapData | null
}

type ChatMessage = {
	id: number
	role: 'user' | 'assistant'
	text: string
}

const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls']

function createConversationId(): string {
	return `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function Dashboard() {
	const [datasetName, setDatasetName] = useState('')
	const [datasetLoaded, setDatasetLoaded] = useState(false)
	const [agentReady, setAgentReady] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [uploadError, setUploadError] = useState('')
	const [rows, setRows] = useState<DataRow[]>([])
	const [eda, setEda] = useState<EdaSummary | null>(null)
	const [chatInput, setChatInput] = useState('')
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
	const [thinking, setThinking] = useState(false)
	const [conversationId, setConversationId] = useState<string>(() => createConversationId())

	const histogramCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const missingCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const histogramChartRef = useRef<Chart | null>(null)
	const missingChartRef = useRef<Chart | null>(null)

	const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

	const previewRows = useMemo(() => rows.slice(0, 6), [rows])
	const previewColumns = useMemo(() => (previewRows[0] ? Object.keys(previewRows[0]) : []), [previewRows])

	useEffect(() => {
		if (!eda?.histogram || !histogramCanvasRef.current) {
			if (histogramChartRef.current) {
				histogramChartRef.current.destroy()
				histogramChartRef.current = null
			}
			return
		}

		if (histogramChartRef.current) {
			histogramChartRef.current.destroy()
		}

		histogramChartRef.current = new Chart(histogramCanvasRef.current, {
			type: 'bar',
			data: {
				labels: eda.histogram.labels,
				datasets: [
					{
						label: `Distribution for ${eda.histogram.columnName}`,
						data: eda.histogram.values,
						borderRadius: 6,
						backgroundColor: '#f97316',
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					x: {
						ticks: {
							autoSkip: true,
							maxRotation: 0,
							minRotation: 0,
							maxTicksLimit: 6,
						},
					},
					y: {
						beginAtZero: true,
						ticks: { precision: 0 },
					},
				},
			},
		})

		return () => {
			if (histogramChartRef.current) {
				histogramChartRef.current.destroy()
				histogramChartRef.current = null
			}
		}
	}, [eda])

	useEffect(() => {
		if (!eda || !missingCanvasRef.current) {
			if (missingChartRef.current) {
				missingChartRef.current.destroy()
				missingChartRef.current = null
			}
			return
		}

		if (missingChartRef.current) {
			missingChartRef.current.destroy()
		}

		missingChartRef.current = new Chart(missingCanvasRef.current, {
			type: 'bar',
			data: {
				labels: eda.missingByColumn.map((item) => item.name),
				datasets: [
					{
						label: 'Missing Values',
						data: eda.missingByColumn.map((item) => item.value),
						borderRadius: 6,
						backgroundColor: '#0f766e',
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
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
			},
		})

		return () => {
			if (missingChartRef.current) {
				missingChartRef.current.destroy()
				missingChartRef.current = null
			}
		}
	}, [eda])

	const handleDatasetUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) {
			return
		}

		let parsedLocally = false
		const nextConversationId = createConversationId()

		setUploadError('')
		setUploading(true)
		setAgentReady(false)
		setConversationId(nextConversationId)

		try {
			const extension = getFileExtension(file.name)
			if (!SUPPORTED_EXTENSIONS.includes(extension)) {
				throw new Error('Unsupported format. Please upload .csv, .xlsx, or .xls files.')
			}

			const parsedRows = await parseDatasetFile(file)
			if (parsedRows.length === 0) {
				throw new Error('The dataset is empty or could not be parsed.')
			}

			const edaSummary = buildEdaSummary(parsedRows)
			setRows(parsedRows)
			setEda(edaSummary)
			setDatasetName(file.name)
			setDatasetLoaded(true)
			parsedLocally = true

			const formData = new FormData()
			formData.append('file', file)

			const uploadResponse = await fetch(
				`${apiBaseUrl}/upload?conversation_id=${encodeURIComponent(nextConversationId)}`,
				{
					method: 'POST',
					body: formData,
				},
			)

			if (!uploadResponse.ok) {
				throw new Error('Dataset parsed locally, but the agent backend rejected the upload.')
			}

			setAgentReady(true)
			setChatMessages([
				{
					id: Date.now(),
					role: 'assistant',
					text: `Dataset loaded successfully. I detected ${edaSummary.rows} rows, ${edaSummary.columns} columns, and ${edaSummary.numericColumns} numeric columns. Ask me anything about this data.`,
				},
			])
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to read the selected file.'
			setUploadError(message)
			if (!parsedLocally) {
				setDatasetName('')
				setRows([])
				setEda(null)
				setDatasetLoaded(false)
				setChatMessages([])
				setConversationId(createConversationId())
			}
			setAgentReady(false)
		} finally {
			setUploading(false)
			event.target.value = ''
		}
	}

	const handleAsk = () => {
		if (!datasetLoaded || !agentReady || !eda || !chatInput.trim() || thinking) {
			return
		}

		const question = chatInput.trim()
		setChatInput('')
		setThinking(true)

		setChatMessages((previous) => [
			...previous,
			{ id: Date.now(), role: 'user', text: question },
		])

		void (async () => {
			try {
				const response = await fetch(`${apiBaseUrl}/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ query: question, conversation_id: conversationId }),
				})

				if (!response.ok) {
					throw new Error('Failed to get response from AI backend.')
				}

				const payload = (await response.json()) as { response?: { content?: string } }

				const assistantText =
					typeof payload.response?.content === 'string' && payload.response.content.trim()
						? payload.response.content
						: generateAssistantResponse(question, eda)

				setChatMessages((previous) => [
					...previous,
					{ id: Date.now() + 1, role: 'assistant', text: assistantText },
				])
			} catch (error) {
				console.error('Error occurred while fetching AI response:', error)
				const fallback = generateAssistantResponse(question, eda)
				setChatMessages((previous) => [
					...previous,
					{ id: Date.now() + 1, role: 'assistant', text: `${fallback} (Backend unavailable, using local insight mode.)` },
				])
			} finally {
				setThinking(false)
			}
		})()
	}

	return (
		<main className="dashboard-main">
			<div className="dashboard-shell">
				<header className="dashboard-header">
					<div>
						<p className="badge">AI Data Analyst</p>
						<h1>Interactive dataset intelligence workspace</h1>
						<p className="header-subtitle">
							Upload a file and instantly explore profile metrics, quality checks, distributions, and correlation heatmaps.
						</p>
					</div>
					<label className="upload-button" htmlFor="dataset-upload">
						<input
							id="dataset-upload"
							type="file"
							accept=".csv,.xlsx,.xls"
							onChange={handleDatasetUpload}
							disabled={uploading}
						/>
						{uploading ? 'Loading dataset...' : 'Upload dataset'}
					</label>
				</header>

				{uploadError && <p className="upload-error">{uploadError}</p>}

				{datasetLoaded && datasetName && (
					<section className="dataset-status">
						<span className="status-dot" />
						<span>{agentReady ? 'Dataset and agent ready:' : 'Dataset parsed locally:'}</span>
						<strong>{datasetName}</strong>
					</section>
				)}

				<div className="dashboard-grid">
					<section className="card chat-card">
						<h2>Ask the AI analyst</h2>
						<p className="card-subtitle">
							Questions are enabled after a dataset is loaded. Ask about trends, anomalies, missing data, or correlations.
						</p>

						<div className="chat-feed" role="log" aria-live="polite">
							{chatMessages.length === 0 ? (
								<p className="chat-placeholder">Upload your data file to start the analysis conversation.</p>
							) : (
								chatMessages.map((message) => (
									<article
										key={message.id}
										className={`chat-message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
									>
										{message.text}
									</article>
								))
							)}
							{thinking && <p className="chat-thinking">Analyzing your question...</p>}
						</div>

						<div className="chat-controls">
							<textarea
								value={chatInput}
								onChange={(event) => setChatInput(event.target.value)}
								placeholder="Example: Which variables have the most missing values?"
								disabled={!datasetLoaded || !agentReady || thinking}
								style={{ resize: 'none' }}
							/>
							<button
								type="button"
								onClick={handleAsk}
								disabled={!datasetLoaded || !agentReady || !chatInput.trim() || thinking}
							>
								Send question
							</button>
						</div>
					</section>

					<section className="card eda-card">
						<h2>Exploratory Data Analysis</h2>
						<p className="card-subtitle">The EDA panel appears immediately after file upload.</p>

						{eda ? (
							<div className="eda-content">
								<div className="metrics-grid">
									<MetricCard label="Rows" value={eda.rows.toLocaleString()} />
									<MetricCard label="Columns" value={eda.columns.toLocaleString()} />
									<MetricCard label="Missing cells" value={eda.missingCells.toLocaleString()} />
									<MetricCard label="Completeness" value={`${eda.completeness.toFixed(1)}%`} />
									<MetricCard label="Numeric columns" value={eda.numericColumns.toLocaleString()} />
									<MetricCard label="Text columns" value={eda.textColumns.toLocaleString()} />
								</div>

								<div className="charts-grid">
									<div className="chart-wrapper">
										<h3>Missing values by column</h3>
										<div className="chart-canvas-wrap">
											<canvas ref={missingCanvasRef} aria-label="Missing values chart" />
										</div>
									</div>

									<div className="chart-wrapper">
										<h3>Distribution snapshot</h3>
										<div className="chart-canvas-wrap">
											{eda.histogram ? (
												<canvas ref={histogramCanvasRef} aria-label="Histogram chart" />
											) : (
												<p className="no-chart">No numeric columns available for distribution chart.</p>
											)}
										</div>
									</div>
								</div>

								<div className="heatmap-wrapper">
									<h3>Correlation heatmap</h3>
									{eda.heatmap ? (
										<CorrelationHeatmap heatmap={eda.heatmap} />
									) : (
										<p className="no-chart">At least two numeric columns are required to build a heatmap.</p>
									)}
								</div>

								<div className="preview-wrapper">
									<h3>Preview sample</h3>
									<div className="table-wrap">
										<table>
											<thead>
												<tr>
													{previewColumns.map((column) => (
														<th key={column}>{column}</th>
													))}
												</tr>
											</thead>
											<tbody>
												{previewRows.map((row, rowIndex) => (
													<tr key={`preview-${rowIndex}`}>
														{previewColumns.map((column) => (
															<td key={`${column}-${rowIndex}`}>{formatCell(row[column])}</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						) : (
							<p className="eda-empty">
								Upload a dataset file to instantly generate EDA metrics, charts, and a correlation heatmap.
							</p>
						)}
					</section>
				</div>
			</div>
		</main>
	)
}

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<article className="metric-card">
			<p>{label}</p>
			<strong>{value}</strong>
		</article>
	)
}

function CorrelationHeatmap({ heatmap }: { heatmap: HeatmapData }) {
	const maxAbs = Math.max(
		...heatmap.matrix.flat().map((value) => Math.abs(value)),
		0.01,
	)

	return (
		<div className="heatmap-table-wrap">
			<table className="heatmap-table">
				<thead>
					<tr>
						<th />
						{heatmap.columns.map((column) => (
							<th key={`head-${column}`}>{column}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{heatmap.columns.map((column, rowIndex) => (
						<tr key={`row-${column}`}>
							<th>{column}</th>
							{heatmap.matrix[rowIndex].map((value, colIndex) => (
								<td
									key={`cell-${rowIndex}-${colIndex}`}
									style={{ backgroundColor: getHeatColor(value, maxAbs) }}
								>
									{value.toFixed(2)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function getHeatColor(value: number, maxAbs: number): string {
	const intensity = Math.min(Math.abs(value) / maxAbs, 1)
	if (value >= 0) {
		return `rgba(16, 185, 129, ${0.2 + intensity * 0.65})`
	}
	return `rgba(244, 63, 94, ${0.2 + intensity * 0.65})`
}

function formatCell(value: CellValue): string {
	if (value === null) {
		return '—'
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? value.toString() : value.toFixed(3)
	}
	return value
}

function getFileExtension(fileName: string): string {
	const dotIndex = fileName.lastIndexOf('.')
	if (dotIndex === -1) {
		return ''
	}
	return fileName.slice(dotIndex).toLowerCase()
}

async function parseDatasetFile(file: File): Promise<DataRow[]> {
	const bytes = await file.arrayBuffer()
	const workbook = XLSX.read(bytes, { type: 'array' })
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
		return value.toISOString()
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

function buildEdaSummary(inputRows: DataRow[]): EdaSummary {
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
	const numericStats = numericColumns.slice(0, 8).map((column) => {
		const values = numericByColumn.get(column) ?? []
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length
		const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
		return {
			name: column,
			count: values.length,
			min: Math.min(...values),
			max: Math.max(...values),
			mean,
			std: Math.sqrt(variance),
		}
	})

	const histogram = buildHistogram(numericColumns, numericByColumn)
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
		histogram,
		heatmap,
	}
}

function buildHistogram(
	numericColumns: string[],
	numericByColumn: Map<string, number[]>,
): { labels: string[]; values: number[]; columnName: string } | null {
	if (numericColumns.length === 0) {
		return null
	}

	const columnName = numericColumns[0]
	const values = numericByColumn.get(columnName) ?? []
	if (values.length === 0) {
		return null
	}

	const min = Math.min(...values)
	const max = Math.max(...values)
	if (min === max) {
		return {
			columnName,
			labels: [`${min.toFixed(2)}`],
			values: [values.length],
		}
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

	return {
		columnName,
		labels,
		values: counts,
	}
}

function buildHeatmap(numericColumns: string[], rows: DataRow[]): HeatmapData | null {
	const selectedColumns = numericColumns.slice(0, 6)
	if (selectedColumns.length < 2) {
		return null
	}

	const matrix = selectedColumns.map((leftColumn) =>
		selectedColumns.map((rightColumn) => correlationForColumns(rows, leftColumn, rightColumn)),
	)

	return { columns: selectedColumns, matrix }
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

function generateAssistantResponse(question: string, eda: EdaSummary): string {
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

export default Dashboard
