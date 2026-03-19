import { CONNECTION_TIMEOUT_MS } from './constants'

export function createConversationId(): string {
	return `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function pickRandomPrompts(prompts: string[], count: number, exclude?: string): string[] {
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

export function buildColumnTooltip(columns: string[]): string {
	if (columns.length === 0) {
		return 'Load a dataset to see real column examples.'
	}

	const sample = columns.slice(0, 6).join(', ')
	if (columns.length > 6) {
		return `Examples: ${sample}, ...`
	}

	return `Examples: ${sample}`
}

export function replaceColumnPlaceholders(prompt: string, columns: string[]): string {
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

export function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, milliseconds)
	})
}

export async function pingService(url: string, timeoutMs = CONNECTION_TIMEOUT_MS): Promise<boolean> {
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
