import { useEffect, useState } from 'react'

type GeneratedProposal = {
	proposal_id: string
	job_id: string
	title: string
	proposal_text: string
	timeline_estimate: string
	questions: string[]
	difficulty_level: string
	match_score: string
	key_skills: string[]
	estimated_budget_range: string
}

function Dashboard() {
	const [jobTitle, setJobTitle] = useState('')
	const [jobDescription, setJobDescription] = useState('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedProposal, setGeneratedProposal] = useState<GeneratedProposal | null>(null)
	const [proposalHistory, setProposalHistory] = useState<GeneratedProposal[]>([])
	const [showHistory, setShowHistory] = useState(false)
	const [copied, setCopied] = useState(false)

	useEffect(() => {

	}, [window.location.href]) // Reload history when the component mounts or when the URL changes

	const handleGenerateProposal = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		try {
			setIsGenerating(true)

			const savedJob = await fetch('/save_job', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: jobTitle, description: jobDescription }),
			})

			const result = await fetch('/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ job_id: savedJob.job_id }),
			})

			const proposal: GeneratedProposal = {
				proposal_id: result.id,
				job_id: savedJob.job_id,
				title: jobTitle,
				proposal_text: result.proposal_text,
				timeline_estimate: result.timeline_estimate,
				questions: result.questions,
				difficulty_level: result.difficulty_level,
				match_score: result.match_score,
				key_skills: result.key_skills,
				estimated_budget_range: result.estimated_budget_range,
			}

			setGeneratedProposal(proposal)
			setProposalHistory([proposal, ...proposalHistory])
			setJobDescription('')
			setJobTitle('')
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Failed to generate proposal'
			setFetchError(errorMsg)
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopy = async () => {
		if (!generatedProposal) return
		await navigator.clipboard.writeText(generatedProposal.proposal_text)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	const getDifficultyColor = (level: string) => {
		const l = level.toLowerCase()
		if (l.includes('easy') || l.includes('low') || l.includes('beginner')) return { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' }
		if (l.includes('hard') || l.includes('high') || l.includes('expert') || l.includes('advanced')) return { bg: '#fce4ec', text: '#c62828', border: '#ef9a9a' }
		return { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' }
	}

	const getMatchColor = (score: string) => {
		const num = parseInt(score)
		if (num >= 80) return { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' }
		if (num >= 50) return { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' }
		return { bg: '#fce4ec', text: '#c62828', border: '#ef9a9a' }
	}

	return (
		<main className="dashboard-main">
			<div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>

				{/* Header */}
				<header className="dashboard-header">
					<div>
						<h1 style={{ margin: 0, fontSize: '1.6rem' }}>Proposal Generator</h1>
						<p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.9rem' }}>
							Welcome, Create AI-powered proposals for freelance opportunities
						</p>
					</div>
					<div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
						<button
							type="button"
							style={{
								padding: '0.5rem 1.15rem',
								fontSize: '0.9rem',
								border: '1px solid #d6d6d6',
								borderRadius: '8px',
								backgroundColor: '#fff',
								cursor: 'pointer',
								fontWeight: 500,
							}}
						>
							Profile
						</button>
						<button
							className="button"
							type="button"
							style={{ width: 'auto', padding: '0.5rem 1.15rem', fontSize: '0.9rem' }}
						>
							Sign out
						</button>
					</div>
				</header>

				{/* Main Content: Form + Results */}
				<div className={`dashboard-content${generatedProposal ? '' : ' single-col'}`}>

					{/* Input Form */}
					<section style={{
						background: '#fff',
						borderRadius: '14px',
						border: '1px solid #d6d6d6',
						padding: '2rem',
						boxShadow: '0 4px 16px -8px rgba(0,0,0,0.1)',
						minWidth: 0,
					}}>
						<h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', textAlign: 'left' }}>New Proposal</h2>
						<p style={{ margin: '0 0 1.25rem 0', color: '#888', fontSize: '0.85rem', textAlign: 'left' }}>
							Fill in the job details and let AI craft your proposal
						</p>
						<form onSubmit={handleGenerateProposal} style={{ display: 'grid', gap: '1rem' }}>
							<div>
								<label htmlFor="jobTitle" style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', textAlign: 'left', fontSize: '0.9rem' }}>
									Job Title
								</label>
								<input
									type="text"
									id="jobTitle"
									value={jobTitle}
									onChange={(e) => setJobTitle(e.target.value)}
									placeholder="e.g. Full-Stack Developer for SaaS Platform"
									style={{
										width: '100%',
										border: '1px solid #d0d0d0',
										borderRadius: '8px',
										padding: '0.75rem 1rem',
										fontSize: '0.95rem',
										fontFamily: 'inherit',
										boxSizing: 'border-box',
										transition: 'border-color 0.2s',
									}}
									onFocus={(e) => e.target.style.borderColor = '#1f5eff'}
									onBlur={(e) => e.target.style.borderColor = '#d0d0d0'}
									required
								/>
							</div>
							<div>
								<label htmlFor="jobDescription" style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', textAlign: 'left', fontSize: '0.9rem' }}>
									Job Description
								</label>
								<textarea
									id="jobDescription"
									value={jobDescription}
									onChange={(e) => setJobDescription(e.target.value)}
									placeholder="Paste the full job description or requirements here..."
									minLength={10}
									rows={10}
									style={{
										width: '100%',
										border: '1px solid #d0d0d0',
										borderRadius: '8px',
										padding: '0.75rem 1rem',
										fontSize: '0.95rem',
										fontFamily: 'inherit',
										resize: 'vertical',
										boxSizing: 'border-box',
										transition: 'border-color 0.2s',
									}}
									onFocus={(e) => e.target.style.borderColor = '#1f5eff'}
									onBlur={(e) => e.target.style.borderColor = '#d0d0d0'}
									required
								/>
							</div>
							<button
								className="button"
								type="submit"
								disabled={isGenerating}
								style={{ marginTop: '0.5rem', padding: '0.85rem', fontSize: '1rem' }}
							>
								{isGenerating ? '⏳ Generating proposal...' : '✨ Generate Proposal'}
							</button>
						</form>
					</section>

					{/* Generated Proposal Result */}
					{generatedProposal && (
						<section style={{
							background: '#fff',
							borderRadius: '14px',
							border: '1px solid #d6d6d6',
							padding: '2rem',
							boxShadow: '0 4px 16px -8px rgba(0,0,0,0.1)',
							overflow: 'hidden',
							minWidth: 0,
						}}>
							{/* Title */}
							<h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1.35rem', textAlign: 'left' }}>
								{generatedProposal.title}
							</h2>

							{/* Metric Cards */}
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
								{/* Match Score */}
								<div style={{
									background: getMatchColor(generatedProposal.match_score).bg,
									border: `1px solid ${getMatchColor(generatedProposal.match_score).border}`,
									borderRadius: '10px',
									padding: '1rem',
									textAlign: 'center',
								}}>
									<div style={{ fontSize: '0.75rem', fontWeight: 600, color: getMatchColor(generatedProposal.match_score).text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
										Match Score
									</div>
									<div style={{ fontSize: '1.5rem', fontWeight: 700, color: getMatchColor(generatedProposal.match_score).text, marginTop: '0.25rem' }}>
										{generatedProposal.match_score}
									</div>
								</div>
								{/* Difficulty */}
								<div style={{
									background: getDifficultyColor(generatedProposal.difficulty_level).bg,
									border: `1px solid ${getDifficultyColor(generatedProposal.difficulty_level).border}`,
									borderRadius: '10px',
									padding: '1rem',
									textAlign: 'center',
								}}>
									<div style={{ fontSize: '0.75rem', fontWeight: 600, color: getDifficultyColor(generatedProposal.difficulty_level).text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
										Difficulty
									</div>
									<div style={{ fontSize: '1.1rem', fontWeight: 700, color: getDifficultyColor(generatedProposal.difficulty_level).text, marginTop: '0.25rem' }}>
										{generatedProposal.difficulty_level}
									</div>
								</div>
								{/* Budget */}
								<div style={{
									background: '#e8eaf6',
									border: '1px solid #9fa8da',
									borderRadius: '10px',
									padding: '1rem',
									textAlign: 'center',
								}}>
									<div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#283593', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
										Budget Range
									</div>
									<div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#283593', marginTop: '0.25rem' }}>
										{generatedProposal.estimated_budget_range}
									</div>
								</div>
								{/* Timeline */}
								<div style={{
									background: '#f3e5f5',
									border: '1px solid #ce93d8',
									borderRadius: '10px',
									padding: '1rem',
									textAlign: 'center',
								}}>
									<div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6a1b9a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
										Timeline
									</div>
									<div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#6a1b9a', marginTop: '0.25rem' }}>
										{generatedProposal.timeline_estimate}
									</div>
								</div>
							</div>

							{/* Key Skills */}
							<div style={{ marginBottom: '1.5rem' }}>
								<h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 0.6rem 0', textAlign: 'left' }}>
									Key Skills
								</h3>
								<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
									{generatedProposal.key_skills.map((skill, idx) => (
										<span key={idx} style={{
											backgroundColor: '#e3f2fd',
											color: '#1565c0',
											border: '1px solid #90caf9',
											borderRadius: '20px',
											padding: '0.3rem 0.85rem',
											fontSize: '0.8rem',
											fontWeight: 500,
										}}>
											{skill}
										</span>
									))}
								</div>
							</div>

							{/* Questions */}
							<div style={{ marginBottom: '1.5rem' }}>
								<h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 0.6rem 0', textAlign: 'left' }}>
									Clarifying Questions
								</h3>
								<div style={{ display: 'grid', gap: '0.5rem' }}>
									{generatedProposal.questions.map((q, idx) => (
										<div key={idx} style={{
											background: '#fffde7',
											border: '1px solid #fff176',
											borderRadius: '8px',
											padding: '0.65rem 1rem',
											fontSize: '0.88rem',
											lineHeight: '1.5',
											textAlign: 'left',
											display: 'flex',
											gap: '0.5rem',
										}}>
											<span style={{ color: '#f9a825', fontWeight: 700 }}>?</span>
											<span>{q}</span>
										</div>
									))}
								</div>
							</div>

							{/* Proposal Text */}
							<div>
								<h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 0.6rem 0', textAlign: 'left' }}>
									Generated Proposal
								</h3>
								<div style={{
									background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)',
									border: '1px solid #c5cae9',
									borderRadius: '10px',
									padding: '1.25rem',
									maxHeight: '400px',
									overflow: 'auto',
									whiteSpace: 'pre-wrap',
									wordWrap: 'break-word',
									overflowWrap: 'anywhere',
									fontSize: '0.9rem',
									lineHeight: '1.7',
									textAlign: 'left',
									color: '#333',
								}}>
									{generatedProposal.proposal_text}
								</div>
								<button
									onClick={handleCopy}
									style={{
										marginTop: '0.75rem',
										padding: '0.5rem 1.25rem',
										backgroundColor: copied ? '#e8f5e9' : '#fff',
										border: `1px solid ${copied ? '#a5d6a7' : '#d6d6d6'}`,
										borderRadius: '8px',
										cursor: 'pointer',
										fontSize: '0.85rem',
										fontWeight: 500,
										color: copied ? '#2e7d32' : '#333',
										transition: 'all 0.2s',
									}}
								>
									{copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
								</button>
							</div>
						</section>
					)}
				</div>

				{/* History */}
				{proposalHistory.length > 0 && (
					<section style={{
						background: '#fff',
						borderRadius: '14px',
						border: '1px solid #d6d6d6',
						padding: '1.5rem 2rem',
						boxShadow: '0 4px 16px -8px rgba(0,0,0,0.1)',
					}}>
						<button
							onClick={() => setShowHistory(!showHistory)}
							style={{
								width: '100%',
								background: 'linear-gradient(135deg, #f5f7ff 0%, #eef1fb 100%)',
								border: '1px solid #d0d5e8',
								padding: '0.85rem 1rem',
								borderRadius: '8px',
								cursor: 'pointer',
								fontSize: '0.95rem',
								fontWeight: 600,
								textAlign: 'center',
								color: '#3949ab',
								transition: 'background 0.2s',
							}}
						>
							{showHistory ? '▲ Hide' : '▼ Show'} Proposal History ({proposalHistory.length})
						</button>

						{showHistory && (
							<div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
								{proposalHistory.map((prop, idx) => (
									<div
										key={idx}
										onClick={() => setGeneratedProposal(prop)}
										style={{
											border: '1px solid #e0e0e0',
											borderRadius: '10px',
											padding: '1rem 1.25rem',
											backgroundColor: '#fafbff',
											cursor: 'pointer',
											transition: 'border-color 0.2s, box-shadow 0.2s',
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'center',
											gap: '1rem',
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.borderColor = '#90caf9'
											e.currentTarget.style.boxShadow = '0 2px 8px rgba(25,118,210,0.08)'
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.borderColor = '#e0e0e0'
											e.currentTarget.style.boxShadow = 'none'
										}}
									>
										<div style={{ minWidth: 0, overflow: 'hidden' }}>
											<p style={{ margin: '0 0 0.25rem 0', fontWeight: 600, fontSize: '0.95rem', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
												{prop.title || 'Untitled Proposal'}
											</p>
										</div>
										<span style={{
											backgroundColor: '#e3f2fd',
											color: '#1565c0',
											borderRadius: '6px',
											padding: '0.25rem 0.6rem',
											fontSize: '0.75rem',
											fontWeight: 600,
											flexShrink: 0,
										}}>
											View
										</span>
									</div>
								))}
							</div>
						)}
					</section>
				)}
			</div>
		</main>
	)
}

export default Dashboard
