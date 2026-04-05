import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Chart from 'chart.js/auto'
import { CONNECTION_RETRY_MS, MAX_CONNECTION_WAIT_MS, SUGGESTED_PROMPTS, SUPPORTED_EXTENSIONS } from './utils/constants'
import {
	buildColumnTooltip,
	createConversationId,
	pickRandomPrompts,
	pingService,
	replaceColumnPlaceholders,
	sleep,
} from './utils/connectionUtils'
import { buildEdaSummary, buildEdaSummaryFromBackend, formatCell, generateAssistantResponse, getFileExtension, parseDatasetFile } from './utils/dataUtils'
import ChatChart from './components/ChatChart'
import CorrelationHeatmap from './components/CorrelationHeatmap'
import MetricCard from './components/MetricCard'
import type { ChatMessage, CleaningReport, DataRow, EdaSummary } from './utils/types'

const QUALITY_LABELS: Array<{ key: keyof CleaningReport['quality_before']['dimensions']; label: string }> = [
	{ key: 'completitud', label: 'Completitud' },
	{ key: 'consistencia', label: 'Consistencia' },
	{ key: 'exactitud', label: 'Exactitud' },
	{ key: 'unicidad', label: 'Unicidad' },
	{ key: 'validez', label: 'Validez' },
	{ key: 'integridad_referencial', label: 'Integridad referencial' },
	{ key: 'uniformidad_formato', label: 'Uniformidad de formato' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function normalizePreviewRows(value: unknown): DataRow[] {
	if (!Array.isArray(value)) {
		return []
	}

	const normalized: DataRow[] = []

	for (const row of value) {
		if (!isRecord(row)) {
			continue
		}

		const next: DataRow = {}
		for (const [key, cell] of Object.entries(row)) {
			if (cell === null || typeof cell === 'string' || typeof cell === 'number') {
				next[key] = cell
			} else {
				next[key] = cell === undefined ? null : String(cell)
			}
		}

		normalized.push(next)
	}

	return normalized
}

function parseCleaningReport(value: unknown): CleaningReport | null {
	if (!isRecord(value)) {
		return null
	}

	const qualityBefore = value.quality_before
	const qualityAfter = value.quality_after
	if (!isRecord(qualityBefore) || !isRecord(qualityAfter)) {
		return null
	}

	return value as CleaningReport
}

function Dashboard() {
	const [datasetName, setDatasetName] = useState('')
	const [datasetLoaded, setDatasetLoaded] = useState(false)
	const [agentReady, setAgentReady] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [uploadError, setUploadError] = useState('')
	const [rows, setRows] = useState<DataRow[]>([])
	const [cleanPreviewRows, setCleanPreviewRows] = useState<DataRow[]>([])
	const [dirtyEda, setDirtyEda] = useState<EdaSummary | null>(null)
	const [cleanEda, setCleanEda] = useState<EdaSummary | null>(null)
	const [cleaningReport, setCleaningReport] = useState<CleaningReport | null>(null)

	const [activeEdaTab, setActiveEdaTab] = useState<'dirty' | 'clean'>('dirty')
	const [selectedHistogramColumn, setSelectedHistogramColumn] = useState('')
	const [selectedCategoricalColumn, setSelectedCategoricalColumn] = useState('')
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
	const categoricalCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const missingCanvasRef = useRef<HTMLCanvasElement | null>(null)
	const histogramChartRef = useRef<Chart | null>(null)
	const categoricalChartRef = useRef<Chart | null>(null)
	const missingChartRef = useRef<Chart | null>(null)
	const chatFeedRef = useRef<HTMLDivElement | null>(null)
	const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

	const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
	const mcpBaseUrl = import.meta.env.VITE_MCP_URL ?? 'http://localhost:8001'
	const sampleDatasetUrl =
		import.meta.env.VITE_SAMPLE_DATASET_URL ??
		'https://jffveitzaqlqrpypjtov.supabase.co/storage/v1/object/public/datasets/sample.csv'

	const eda = useMemo(() => {
		if (activeEdaTab === 'clean') {
			return cleanEda ?? dirtyEda
		}

		return dirtyEda ?? cleanEda
	}, [activeEdaTab, dirtyEda, cleanEda])

	const canCompareEda = Boolean(dirtyEda && cleanEda)
	const workflowSteps = useMemo(
		() => [
			{ id: 1, title: 'Dataset loaded', done: datasetLoaded },
			{ id: 2, title: 'Raw EDA generated', done: Boolean(dirtyEda) },
			{ id: 3, title: 'Backend cleaning completed', done: Boolean(cleanEda && cleaningReport) },
			{ id: 4, title: 'Visual exploration enabled', done: Boolean(eda) },
			{ id: 5, title: 'AI chat enabled', done: agentReady },
		],
		[datasetLoaded, dirtyEda, cleanEda, cleaningReport, eda, agentReady],
	)

	const previewRows = useMemo(
		() => (activeEdaTab === 'clean' ? (cleanPreviewRows.length > 0 ? cleanPreviewRows : rows) : rows).slice(0, 6),
		[activeEdaTab, cleanPreviewRows, rows],
	)
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

	const selectedCategoricalChart = useMemo(() => {
		if (!eda?.categoricalPieCharts || eda.categoricalPieCharts.length === 0) {
			return null
		}

		return (
			eda.categoricalPieCharts.find((chart) => chart.columnName === selectedCategoricalColumn) ??
			eda.categoricalPieCharts[0]
		)
	}, [eda, selectedCategoricalColumn])

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
		if (!eda?.categoricalPieCharts || eda.categoricalPieCharts.length === 0) {
			setSelectedCategoricalColumn('')
			return
		}

		const exists = eda.categoricalPieCharts.some((chart) => chart.columnName === selectedCategoricalColumn)
		if (!exists) {
			setSelectedCategoricalColumn(eda.categoricalPieCharts[0].columnName)
		}
	}, [eda, selectedCategoricalColumn])

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
		if (!selectedCategoricalChart || !categoricalCanvasRef.current) {
			if (categoricalChartRef.current) {
				categoricalChartRef.current.destroy()
				categoricalChartRef.current = null
			}
			return
		}

		if (categoricalChartRef.current) {
			categoricalChartRef.current.destroy()
		}

		const baseColors = [
			'#0f766e',
			'#f97316',
			'#1d4ed8',
			'#dc2626',
			'#7c3aed',
			'#ca8a04',
			'#0ea5e9',
			'#14b8a6',
			'#475569',
		]

		categoricalChartRef.current = new Chart(categoricalCanvasRef.current, {
			type: 'pie',
			data: {
				labels: selectedCategoricalChart.labels,
				datasets: [
					{
						label: `Categories for ${selectedCategoricalChart.columnName}`,
						data: selectedCategoricalChart.values,
						backgroundColor: selectedCategoricalChart.labels.map(
							(_, index) => baseColors[index % baseColors.length],
						),
						borderColor: '#ffffff',
						borderWidth: 1,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: true,
						position: 'bottom',
					},
				},
			},
		})

		return () => {
			if (categoricalChartRef.current) {
				categoricalChartRef.current.destroy()
				categoricalChartRef.current = null
			}
		}
	}, [selectedCategoricalChart])

	useEffect(() => {
		if (activeEdaTab !== 'dirty' || !dirtyEda || !missingCanvasRef.current) {
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
				labels: dirtyEda.missingByColumn.map((item) => item.name),
				datasets: [
					{
						label: 'Missing Values',
						data: dirtyEda.missingByColumn.map((item) => item.value),
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
	}, [activeEdaTab, dirtyEda])

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

	const handleDatasetUpload = async (event: ChangeEvent<HTMLInputElement>) => {
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
		setCleanEda(null)
		setCleaningReport(null)
		setCleanPreviewRows([])
		setActiveEdaTab('dirty')
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

			const localEdaSummary = buildEdaSummary(parsedRows)
			setRows(parsedRows)
			setDirtyEda(localEdaSummary)
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

			const uploadPayload = await uploadResponse.json()
			const backendEdaSummary = buildEdaSummaryFromBackend(uploadPayload?.dataset, parsedRows)
			const resolvedCleanEda = backendEdaSummary ?? localEdaSummary
			const parsedReport = parseCleaningReport(uploadPayload?.cleaning)
			setCleanEda(resolvedCleanEda)
			setActiveEdaTab('clean')
			setCleaningReport(parsedReport)
			setCleanPreviewRows(normalizePreviewRows(parsedReport?.cleaned_preview))

			setAgentReady(true)
			setChatMessages([
				{
					id: Date.now(),
					role: 'assistant',
					text: `Dataset loaded successfully. I detected ${resolvedCleanEda.rows} rows, ${resolvedCleanEda.columns} columns, and ${resolvedCleanEda.numericColumns} numeric columns after cleaning. You can compare dirty vs clean EDA in the tabs.`,
				},
			])
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to read the selected file.'
			setUploadError(message)
			if (!parsedLocally) {
				setDatasetName('')
				setRows([])
				setCleanPreviewRows([])
				setDirtyEda(null)
				setCleanEda(null)
				setCleaningReport(null)
				setActiveEdaTab('dirty')
				setSelectedHistogramColumn('')
				setSelectedCategoricalColumn('')
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

	const handleUseSampleDataset = async () => {
		if (!serversReady || serversChecking || uploading) {
			setUploadError('Services are still warming up. Please wait a moment and try again.')
			return
		}

		const nextConversationId = createConversationId()

		setUploadError('')
		setUploading(true)
		setAgentReady(false)
		setCleanEda(null)
		setCleaningReport(null)
		setCleanPreviewRows([])
		setActiveEdaTab('dirty')
		setConversationId(nextConversationId)

		try {
			const sampleResponse = await fetch(sampleDatasetUrl)
			if (!sampleResponse.ok) {
				throw new Error('Could not download the sample dataset file.')
			}

			const sampleBlob = await sampleResponse.blob()
			const sampleFile = new File([sampleBlob], 'sample.csv', {
				type: sampleBlob.type || 'text/csv',
			})

			const parsedRows = await parseDatasetFile(sampleFile)
			if (parsedRows.length === 0) {
				throw new Error('The sample dataset appears to be empty.')
			}

			const localEdaSummary = buildEdaSummary(parsedRows)
			setRows(parsedRows)
			setDirtyEda(localEdaSummary)
			setDatasetName('sample.csv (example)')
			setDatasetLoaded(true)

			const backendResponse = await fetch(
				`${apiBaseUrl}/load-sample?conversation_id=${encodeURIComponent(nextConversationId)}`,
				{ method: 'POST' },
			)

			if (!backendResponse.ok) {
				throw new Error('Sample dataset parsed locally, but backend setup failed.')
			}

			const backendPayload = await backendResponse.json()
			const backendEdaSummary = buildEdaSummaryFromBackend(backendPayload?.dataset, parsedRows)
			const resolvedCleanEda = backendEdaSummary ?? localEdaSummary
			const parsedReport = parseCleaningReport(backendPayload?.cleaning)

			setCleanEda(resolvedCleanEda)
			setActiveEdaTab('clean')
			setCleaningReport(parsedReport)
			setCleanPreviewRows(normalizePreviewRows(parsedReport?.cleaned_preview))

			setAgentReady(true)
			setChatMessages([
				{
					id: Date.now(),
					role: 'assistant',
					text: `Sample dataset loaded successfully. I detected ${resolvedCleanEda.rows} rows, ${resolvedCleanEda.columns} columns, and ${resolvedCleanEda.numericColumns} numeric columns after cleaning. You can compare dirty vs clean EDA in the tabs.`,
				},
			])
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to load the sample dataset.'
			setUploadError(message)
			setDatasetName('')
			setRows([])
			setCleanPreviewRows([])
			setDirtyEda(null)
			setCleanEda(null)
			setCleaningReport(null)
			setActiveEdaTab('dirty')
			setSelectedHistogramColumn('')
			setSelectedCategoricalColumn('')
			setDatasetLoaded(false)
			setChatMessages([])
			setConversationId(createConversationId())
			setAgentReady(false)
		} finally {
			setUploading(false)
		}
	}

	const handleAsk = (presetQuestion?: string) => {
		const question = (presetQuestion ?? chatInput).trim()
		if (!serversReady || serversChecking || !datasetLoaded || !agentReady || !eda || !question || thinking) {
			return
		}

		setChatInput('')
		setThinking(true)

		setChatMessages((previous) => [...previous, { id: Date.now(), role: 'user', text: question }])

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

				const payload = await response.json()
				if (payload?.response?.content.error) {
					throw new Error(`AI backend error: ${payload.response.content.error}`)
				}
				if (payload?.response.type === 'chart' && payload?.response.content) {
					setChatMessages((previous) => [
						...previous,
						{ id: Date.now() + 1, role: 'assistant', text: 'Here is the chart based on your question:' },
						{
							id: Date.now() + 2,
							role: 'chart',
							text: payload.response.content.title,
							datasets: payload.response.content.data.datasets,
							labels: payload.response.content.data.labels,
							type: payload.response.content.type,
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
					<div className="header-actions">
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
						<button
							type="button"
							className="sample-button"
							onClick={handleUseSampleDataset}
							disabled={uploading || serversChecking || !serversReady}
						>
							{uploading ? 'Loading dataset...' : 'Use sample dataset'}
						</button>
					</div>
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

					{datasetLoaded && (
						<section className="workflow-strip" aria-label="Dataset analysis workflow">
							{workflowSteps.map((step) => (
								<div key={step.id} className={`workflow-step${step.done ? ' done' : ''}`}>
									<span className="workflow-step-index">{step.id}</span>
									<p>{step.title}</p>
								</div>
							))}
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
									<article key={message.id} className={`chat-message ${message.role}`}>
										{message.role === 'chart' ? (
											<>
												<p className="chart-title">{message.text}</p>
												{message.datasets && message.datasets.length > 0 && (
													<div className="chart-preview">
														<ChatChart message={message} />
													</div>
												)}
											</>
										) : (
											message.text
										)}
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
						<p className="card-subtitle">Navigate raw and cleaned dataset states, then inspect what changed during cleaning.</p>

						{dirtyEda && (
							<div className="eda-tabs" role="tablist" aria-label="EDA comparison tabs">
								<button
									type="button"
									className={`eda-tab${activeEdaTab === 'dirty' ? ' active' : ''}`}
									onClick={() => setActiveEdaTab('dirty')}
									role="tab"
									aria-selected={activeEdaTab === 'dirty'}
								>
									Dirty dataset (local)
								</button>
								<button
									type="button"
									className={`eda-tab${activeEdaTab === 'clean' ? ' active' : ''}`}
									onClick={() => setActiveEdaTab('clean')}
									disabled={!cleanEda}
									role="tab"
									aria-selected={activeEdaTab === 'clean'}
								>
									Clean dataset (backend)
								</button>
							</div>
						)}

						{canCompareEda && dirtyEda && cleanEda && (
							<div className="eda-quick-compare" role="status" aria-live="polite">
								<span>Rows: {dirtyEda.rows.toLocaleString()} → {cleanEda.rows.toLocaleString()}</span>
								<span>Missing cells: {dirtyEda.missingCells.toLocaleString()} → {cleanEda.missingCells.toLocaleString()}</span>
								<span>Completeness: {dirtyEda.completeness.toFixed(1)}% → {cleanEda.completeness.toFixed(1)}%</span>
							</div>
						)}

						{cleaningReport && (
							<div className="cleaning-report-panel">
								<div className="quality-status-grid">
									{QUALITY_LABELS.map((dimension) => {
										const beforeOk = cleaningReport.quality_before.dimensions[dimension.key]
										const afterOk = cleaningReport.quality_after.dimensions[dimension.key]

										return (
											<div key={dimension.key} className="quality-status-item">
												<p>{dimension.label}</p>
												<span className={beforeOk ? 'quality-ok' : 'quality-fail'}>
													Before: {beforeOk ? 'OK' : 'Issue'}
												</span>
												<span className={afterOk ? 'quality-ok' : 'quality-fail'}>
													After: {afterOk ? 'OK' : 'Issue'}
												</span>
											</div>
										)
									})}
								</div>
								{cleaningReport.transformations.length > 0 && (
									<div className="transformation-log">
										<h3>Cleaning transformations applied</h3>
										<ul>
											{cleaningReport.transformations.slice(0, 10).map((item) => (
												<li key={item}>{item}</li>
											))}
										</ul>
									</div>
								)}
							</div>
						)}

						{eda ? (
							<div className="eda-content">
								<p className="active-view-label">
									Viewing: {activeEdaTab === 'dirty' ? 'Before cleaning (raw dataset)' : 'After cleaning (backend output)'}
								</p>
								<div className="metrics-grid">
									<MetricCard label="Rows" value={eda.rows.toLocaleString()} />
									<MetricCard label="Columns" value={eda.columns.toLocaleString()} />
									<MetricCard label="Missing cells" value={eda.missingCells.toLocaleString()} />
									<MetricCard label="Completeness" value={`${eda.completeness.toFixed(1)}%`} />
									<MetricCard label="Numeric columns" value={eda.numericColumns.toLocaleString()} />
									<MetricCard label="Text columns" value={eda.textColumns.toLocaleString()} />
								</div>

								<div className="charts-grid">
									{activeEdaTab === 'dirty' ? (
										<div className="chart-wrapper">
											<h3>Missing values by column</h3>
											<div className="chart-canvas-wrap">
												<canvas ref={missingCanvasRef} aria-label="Missing values chart" />
											</div>
										</div>
									) : (
										<div className="chart-wrapper chart-note-wrapper">
											<h3>Missing values by column</h3>
											<p className="no-chart">This chart is shown only for the raw dataset (before cleaning).</p>
										</div>
									)}

									<div className="chart-wrapper">
										<h3>Numeric distributions</h3>
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

									<div className="chart-wrapper">
										<h3>Categorical composition</h3>
										{eda.categoricalPieCharts && eda.categoricalPieCharts.length > 1 && (
											<div className="histogram-selector">
												<label htmlFor="categorical-column-select">Column</label>
												<select
													id="categorical-column-select"
													value={selectedCategoricalColumn}
													onChange={(event) => setSelectedCategoricalColumn(event.target.value)}
												>
													{eda.categoricalPieCharts.map((chart) => (
														<option key={chart.columnName} value={chart.columnName}>
															{chart.columnName}
														</option>
													))}
												</select>
											</div>
										)}
										<div className="chart-canvas-wrap">
											{eda.categoricalPieCharts && eda.categoricalPieCharts.length > 0 ? (
												<canvas ref={categoricalCanvasRef} aria-label="Categorical pie chart" />
											) : (
												<p className="no-chart">No categorical columns available for pie chart.</p>
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

export default Dashboard
