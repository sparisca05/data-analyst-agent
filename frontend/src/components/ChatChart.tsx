import { useEffect, useMemo, useRef } from 'react'
import Chart from 'chart.js/auto'
import type { ChartType } from 'chart.js'
import { prepareChatChart } from '../utils/chartUtils'
import type { ChatMessage } from '../utils/types'

function ChatChart({ message }: { message: ChatMessage }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const chartRef = useRef<Chart<ChartType, unknown[], unknown> | null>(null)
	const prepared = useMemo(
		() => prepareChatChart(message.datasets, message.labels, message.type),
		[message.datasets, message.labels, message.type],
	)

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

export default ChatChart