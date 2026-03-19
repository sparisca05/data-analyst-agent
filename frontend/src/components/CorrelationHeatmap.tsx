import type { HeatmapData } from '../utils/types'

function getHeatColor(value: number, maxAbs: number): string {
	const intensity = Math.min(Math.abs(value) / maxAbs, 1)
	if (value >= 0) {
		return `rgba(16, 185, 129, ${0.2 + intensity * 0.65})`
	}
	return `rgba(244, 63, 94, ${0.2 + intensity * 0.65})`
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

export default CorrelationHeatmap
