const base = () => (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function formatDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Request failed'
  const d = (data as { detail?: unknown }).detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d
      .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
      .join('; ')
  }
  if (d && typeof d === 'object') return JSON.stringify(d)
  return 'Request failed'
}

async function parseJson(res: Response) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text || `HTTP ${res.status}` }
  }
}

export async function fetchModels() {
  const res = await fetch(`${base()}/models`)
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { models: { model_id: string; info: Record<string, unknown> }[] }
}

export async function fetchModel(modelId: string) {
  const res = await fetch(`${base()}/models/${encodeURIComponent(modelId)}`)
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as {
    model_id: string
    type: string
    features: string[]
    description: string
    version: string
    loaded_at: string
  }
}

export async function predict(payload: {
  model_id: string
  data: Record<string, number>
  return_proba?: boolean
  log_prediction?: boolean
}) {
  const res = await fetch(`${base()}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_id: payload.model_id,
      data: payload.data,
      return_proba: payload.return_proba ?? true,
      log_prediction: payload.log_prediction ?? true,
    }),
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as {
    model_id: string
    prediction: number
    confidence: number | null
    model_type: string
    features_used: string[]
  }
}

export async function submitFeedback(payload: {
  model_id: string
  data: Record<string, number>
  actual_outcome: number
  predicted?: number
}) {
  const res = await fetch(`${base()}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { message: string; id: number }
}

export async function fetchStats(modelId: string) {
  const res = await fetch(`${base()}/stats/${encodeURIComponent(modelId)}`)
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { model_id: string; labeled_feedback_rows: number }
}

export async function retrain(modelId: string, minSamples = 10) {
  const res = await fetch(`${base()}/retrain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, min_samples: minSamples }),
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { message: string; samples_used: number; artifact: string }
}
