import { useEffect, useMemo, useRef, useState } from 'react'
import Chart from 'chart.js/auto'
import type { ChartType } from 'chart.js'
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
	histograms: { labels: string[]; values: number[]; columnName: string }[] | null
	heatmap: HeatmapData | null
}

type ChatMessage = {
	id: number
	role: 'user' | 'assistant' | 'chart'
	text: string
	datasets?: ChartDataset[]
	labels?: string[]
	type?: ChartType
}

type ChartPoint = {
	x: number | string
	y: number | string
}

type SupportedChatChartType = 'bar' | 'scatter' | 'line' | 'pie' | 'doughnut'

type ChartDataset = {
	label?: string
	data: Array<number | string | ChartPoint>
	backgroundColor?: string | string[]
	borderColor?: string | string[]
	borderWidth?: number
	pointRadius?: number
	showLine?: boolean
	[key: string]: unknown
}

const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls']
const SUGGESTED_PROMPTS = [
	'Give me a brief description of this dataset',
	'Which are the insights of the dataset I need to know?',
	'Show me the average [column] by [column]',
	'Detect outliers for the feature [column]',
	'Create a graph that shows the distribution of [column]',
	'Which features correlate with [column]',
]

const CONNECTION_RETRY_MS = 2500
const CONNECTION_TIMEOUT_MS = 12000
const MAX_CONNECTION_WAIT_MS = 120000

function createConversationId(): string {
	return `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function pickRandomPrompts(prompts: string[], count: number, exclude?: string): string[] {
	const basePool = exclude ? prompts.filter((prompt) => prompt !== exclude) : [...prompts]
	const pool = [...basePool]

	for (let index = pool.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1))
		const current = pool[index]
		pool[index] = pool[swapIndex]
		pool[swapIndex] = current
	}

	return pool.slice(0, Math.min(count, pool.length))
}

function buildColumnTooltip(columns: string[]): string {
	if (columns.length === 0) {
		return 'Load a dataset to see real column examples.'
	}

	const sample = columns.slice(0, 6).join(', ')
	if (columns.length > 6) {
		return `Examples: ${sample}, ...`
	}

	return `Examples: ${sample}`
}

function replaceColumnPlaceholders(prompt: string, columns: string[]): string {
	if (!prompt.includes('[column]') || columns.length === 0) {
		return prompt
	}

	let replacementIndex = 0
	return prompt.replaceAll('[column]', () => {
		const value = columns[Math.min(replacementIndex, columns.length - 1)]
		replacementIndex += 1
		return value
	})
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, milliseconds)
	})
}

async function pingService(url: string, timeoutMs = CONNECTION_TIMEOUT_MS): Promise<boolean> {
	const controller = new AbortController()
	const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			method: 'GET',
			signal: controller.signal,
		})
		return response.ok
	} catch {
		return false
	} finally {
		window.clearTimeout(timeoutId)
	}
}

function Dashboard() {
	const [datasetName, setDatasetName] = useState('')
	const [datasetLoaded, setDatasetLoaded] = useState(false)
	const [agentReady, setAgentReady] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [uploadError, setUploadError] = useState('')
	const [rows, setRows] = useState<DataRow[]>([])
	const [eda, setEda] = useState<EdaSummary | null>(null)
	const [selectedHistogramColumn, setSelectedHistogramColumn] = useState('')
	const [chatInput, setChatInput] = useState('')
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
	const [thinking, setThinking] = useState(false)
	const [serversChecking, setServersChecking] = useState(true)
	const [serversReady, setServersReady] = useState(false)
	const [serversError, setServersError] = useState('')
	const [serversStatusText, setServersStatusText] = useState('Checking backend and tool server...')
	const [connectionAttempt, setConnectionAttempt] = useState(0)
	const [visibleSuggestedPrompts, setVisibleSuggestedPrompts] = useState<string[]>(() =>
		pickRandomPrompts(SUGGESTED_PROMPTS, 3),
	)
	const [conversationId, setConversationId] = useState<string>(() => createConversationId())
	const previousChatCountRef = useRef(0)

	const histogramCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const missingCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const histogramChartRef = useRef<Chart | null>(null)
	const missingChartRef = useRef<Chart | null>(null)
	const chatFeedRef = useRef<HTMLDivElement | null>(null)
	const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

	const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
	const mcpBaseUrl = import.meta.env.VITE_MCP_URL ?? 'http://localhost:8001'

	const previewRows = useMemo(() => rows.slice(0, 6), [rows])
	const detectedColumns = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows])
	const columnPromptTooltip = useMemo(() => buildColumnTooltip(detectedColumns), [detectedColumns])
	const previewColumns = useMemo(() => (previewRows[0] ? Object.keys(previewRows[0]) : []), [previewRows])
	const selectedHistogram = useMemo(() => {
		if (!eda?.histograms || eda.histograms.length === 0) {
			return null
		}

		return (
			eda.histograms.find((histogram) => histogram.columnName === selectedHistogramColumn) ??
			eda.histograms[0]
		)
	}, [eda, selectedHistogramColumn])

	useEffect(() => {
		let cancelled = false

		const checkConnections = async () => {
			setServersChecking(true)
			setServersReady(false)
			setServersError('')
			setServersStatusText('Checking backend and tool server...')

			const startedAt = Date.now()

			while (!cancelled) {
				const [backendOnline, mcpOnline] = await Promise.all([
					pingService(`${apiBaseUrl}/`),
					pingService(`${mcpBaseUrl}/`),
				])

				if (cancelled) {
					return
				}

				if (backendOnline && mcpOnline) {
					setServersReady(true)
					setServersChecking(false)
					setServersStatusText('Backend and tool server are ready.')
					return
				}

				const missing: string[] = []
				if (!backendOnline) {
					missing.push('backend')
				}
				if (!mcpOnline) {
					missing.push('tool server')
				}

				setServersStatusText(`Waking up ${missing.join(' and ')}...`)

				if (Date.now() - startedAt >= MAX_CONNECTION_WAIT_MS) {
					setServersChecking(false)
					setServersReady(false)
					setServersError('Services did not respond in time. Please retry connection.')
					setServersStatusText('Connection timed out.')
					return
				}

				await sleep(CONNECTION_RETRY_MS)
			}
		}

		void checkConnections()

		return () => {
			cancelled = true
		}
	}, [apiBaseUrl, mcpBaseUrl, connectionAttempt])

	useEffect(() => {
		if (!eda?.histograms || eda.histograms.length === 0) {
			setSelectedHistogramColumn('')
			return
		}

		const exists = eda.histograms.some((histogram) => histogram.columnName === selectedHistogramColumn)
		if (!exists) {
			setSelectedHistogramColumn(eda.histograms[0].columnName)
		}
	}, [eda, selectedHistogramColumn])

	useEffect(() => {
		if (!selectedHistogram || !histogramCanvasRef.current) {
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
				labels: selectedHistogram.labels,
				datasets: [
					{
						label: `Distribution for ${selectedHistogram.columnName}`,
						data: selectedHistogram.values,
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
	}, [selectedHistogram])

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

	useEffect(() => {
		const previousCount = previousChatCountRef.current
		const currentCount = chatMessages.length
		const lastMessage = currentCount > 0 ? chatMessages[currentCount - 1] : null

		if (currentCount > previousCount && lastMessage?.role === 'chart' && chatFeedRef.current) {
			requestAnimationFrame(() => {
				if (chatFeedRef.current) {
					chatFeedRef.current.scrollTo({
						top: chatFeedRef.current.scrollHeight,
						behavior: 'smooth',
					})
				}
			})
		}

		previousChatCountRef.current = currentCount
	}, [chatMessages])

	const handleDatasetUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		if (!serversReady || serversChecking) {
			setUploadError('Services are still warming up. Please wait a moment and try again.')
			event.target.value = ''
			return
		}

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
			console.log('Selected file extension:', extension)
			if (!SUPPORTED_EXTENSIONS.includes(extension)) {
				throw new Error('Unsupported format. Please upload .csv, .xlsx, or .xls files.')
			}

			const parsedRows = await parseDatasetFile(file)
			console.log('Parsed rows:', parsedRows.length)
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
				setSelectedHistogramColumn('')
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

	const handleAsk = (presetQuestion?: string) => {
		const question = (presetQuestion ?? chatInput).trim()
		if (!serversReady || serversChecking || !datasetLoaded || !agentReady || !eda || !question || thinking) {
			return
		}

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

				const payload = (await response.json())
				if (payload?.response?.content.error) {
					throw new Error(`AI backend error: ${payload.response.content.error}`)
				}
				if (payload?.response.type === 'chart' && payload?.response.content) {
					setChatMessages((previous) => [
						...previous,
						{ id: Date.now() + 1, role: 'assistant', text: `Here is the chart based on your question:` },
						{ 
							id: Date.now() + 2,
							role: 'chart',
							text: payload.response.content.title,
							datasets: payload.response.content.data.datasets,
							labels: payload.response.content.data.labels,
							type: payload.response.content.type
						},
					])
					return
				}
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
			setVisibleSuggestedPrompts(pickRandomPrompts(SUGGESTED_PROMPTS, 3, question))
			}
		})()
	}

	const handleSuggestedPromptClick = (prompt: string) => {
		if (!serversReady || serversChecking || !datasetLoaded || !agentReady || thinking) {
			return
		}

		const draft = replaceColumnPlaceholders(prompt, detectedColumns)
		setChatInput(draft)

		requestAnimationFrame(() => {
			chatInputRef.current?.focus()
		})
	}

	const handleRetryConnections = () => {
		setConnectionAttempt((attempt) => attempt + 1)
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
					<label
						className={`upload-button${uploading || serversChecking || !serversReady ? ' disabled' : ''}`}
						htmlFor="dataset-upload"
					>
						<input
							id="dataset-upload"
							type="file"
							accept=".csv,.xlsx,.xls"
							onChange={handleDatasetUpload}
							disabled={uploading || serversChecking || !serversReady}
						/>
						{serversChecking
							? 'Waking up services...'
							: uploading
								? 'Loading dataset...'
								: 'Upload dataset'}
					</label>
				</header>

				<section
					className={`dataset-status${serversReady ? ' ready' : serversError ? ' error' : ' loading'}`}
					role="status"
					aria-live="polite"
				>
					<span className="connection-dot" aria-hidden="true" />
					<div className="connection-copy">
						<p>
							{serversReady
								? 'Services ready:'
								: serversError
									? 'Connection issue detected:'
									: 'Warming up services'}
						</p>
						<strong>{serversError || serversStatusText}</strong>
					</div>
					{serversError && (
						<button type="button" className="connection-retry" onClick={handleRetryConnections}>
							Retry connection
						</button>
					)}
				</section>

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

						<div className="suggested-prompts" aria-label="Suggested prompts">
							<p>Suggested prompts</p>
							<div className="suggested-prompts-grid">
								{visibleSuggestedPrompts.map((prompt, index) => {
									const hasColumnPlaceholder = prompt.includes('[column]')

									return (
										<button
											type="button"
											key={`${prompt}-${index}`}
											className={`suggested-prompt-chip${hasColumnPlaceholder ? ' has-tooltip' : ''}`}
											data-tooltip={hasColumnPlaceholder ? columnPromptTooltip : undefined}
											onClick={() => handleSuggestedPromptClick(prompt)}
											disabled={!serversReady || serversChecking || !datasetLoaded || !agentReady || thinking}
										>
											{prompt}
										</button>
									)
								})}
							</div>
						</div>

						<div className="chat-feed" role="log" aria-live="polite" ref={chatFeedRef}>
							{!serversReady ? (
								<p className="chat-placeholder">Waiting for backend services to become available...</p>
							) : chatMessages.length === 0 ? (
								<p className="chat-placeholder">Upload your data file to start the analysis conversation.</p>
							) : (
								chatMessages.map((message) => (
									<article
										key={message.id}
										className={`chat-message ${message.role}`}
									>
										{message.role === 'chart' ? (
											<>
												<p className="chart-title">{message.text}</p>
												{message.datasets && message.datasets.length > 0 && (
													<div className="chart-preview">
														<ChatChart message={message} />
													</div>
												)}
											</>
										) : message.text
										}
									</article>
								))
							)}
							{thinking && <p className="chat-thinking">Analyzing your question...</p>}
						</div>

						<div className="chat-controls">
							<textarea
								ref={chatInputRef}
								value={chatInput}
								onChange={(event) => setChatInput(event.target.value)}
								placeholder="Example: Which variables have the most missing values?"
								disabled={!serversReady || serversChecking || !datasetLoaded || !agentReady || thinking}
								style={{ resize: 'none' }}
							/>
							<button
								type="button"
								onClick={() => handleAsk()}
								disabled={!serversReady || serversChecking || !datasetLoaded || !agentReady || !chatInput.trim() || thinking}
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
										{eda.histograms && eda.histograms.length > 1 && (
											<div className="histogram-selector">
												<label htmlFor="histogram-column-select">Column</label>
												<select
													id="histogram-column-select"
													value={selectedHistogramColumn}
													onChange={(event) => setSelectedHistogramColumn(event.target.value)}
												>
													{eda.histograms.map((histogram) => (
														<option key={histogram.columnName} value={histogram.columnName}>
															{histogram.columnName}
														</option>
													))}
												</select>
											</div>
										)}
										<div className="chart-canvas-wrap">
											{eda.histograms && eda.histograms.length > 0 ? (
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

function ChatChart({ message }: { message: ChatMessage }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const chartRef = useRef<Chart<ChartType, unknown[], unknown> | null>(null)
	const prepared = useMemo(() => prepareChatChart(message), [message])

	useEffect(() => {
		if (!canvasRef.current || !prepared.ok) {
			if (chartRef.current) {
				chartRef.current.destroy()
				chartRef.current = null
			}
			return
		}

		if (chartRef.current) {
			chartRef.current.destroy()
		}

		chartRef.current = new Chart(canvasRef.current, {
			type: prepared.type,
			data: {
				labels: prepared.labels,
				datasets: prepared.datasets,
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: prepared.legendDisplay } },
				scales: prepared.scales as never,
				animation: {
					duration: 500,
					easing: 'easeOutQuart',
				},
			},
		})

		return () => {
			if (chartRef.current) {
				chartRef.current.destroy()
				chartRef.current = null
			}
		}
	}, [prepared])

	if (!prepared.ok) {
		return <p className="no-chart">{prepared.reason}</p>
	}

	return <canvas ref={canvasRef} aria-label={message.text} />
}

type PreparedChartResult =
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

function prepareChatChart(message: ChatMessage): PreparedChartResult {
	if (!message.datasets || message.datasets.length === 0) {
		return { ok: false, reason: 'Chart data is missing datasets.' }
	}

	const chartType = normalizeChartType(message.type, message.datasets)
	if (!chartType) {
		return { ok: false, reason: `Unsupported chart type: ${String(message.type)}.` }
	}

	if (chartType === 'scatter') {
		return prepareScatterChart(message.datasets)
	}

	if (chartType === 'line') {
		return prepareLineChart(message.datasets, message.labels)
	}

	if (chartType === 'pie' || chartType === 'doughnut') {
		return prepareRadialChart(chartType, message.datasets, message.labels)
	}

	return prepareBarChart(message.datasets, message.labels)
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
		const points = dataset.data.filter((value): value is ChartPoint => isChartPoint(value))
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

	const points = resolvedDatasets.flatMap((dataset) => dataset.data as ChartPoint[])
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

function hasPointData(data: Array<number | string | ChartPoint>): boolean {
	return data.some((value) => isChartPoint(value))
}

function isChartPoint(value: number | string | ChartPoint): value is ChartPoint {
	return typeof value === 'object' && value !== null && 'x' in value && 'y' in value
}

function inferAxisType(values: Array<number | string>): 'linear' | 'category' {
	const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
	if (numericValues.length === values.length && values.length > 0) {
		return 'linear'
	}
	return 'category'
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
		console.log(`Calculating stats for column: ${column}`)
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
	console.log('Numeric stats:', numericStats)

	const histograms = buildHistogram(numericColumns, numericByColumn)

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
		heatmap,
	}
}

function buildHistogram(
	numericColumns: string[],
	numericByColumn: Map<string, number[]>,
): { labels: string[]; values: number[]; columnName: string }[] | null {
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
