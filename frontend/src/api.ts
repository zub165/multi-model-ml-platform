function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, '')
}

const OLLAMA_STORAGE_KEY = 'ML_OLLAMA_BASE_URL'

/** Public VPS host for preset URLs (override in .env.local). */
export function getPublicHost(): string {
  return (import.meta.env.VITE_PUBLIC_HOST ?? '208.109.215.53').trim()
}

export type ConnectionPreset = {
  id: string
  label: string
  blurb: string
  mlApi: string
  ollama: string
  note?: string
}

/** Documented ports — keep in sync with README / macmini scripts. */
export const PORT_REFERENCE = [
  { service: 'ML API (FastAPI, GoDaddy)', port: '8890', host: 'GoDaddy VPS' },
  { service: 'ML API (Django, optional)', port: '8891', host: 'GoDaddy VPS' },
  { service: 'ML API (Mac mini local)', port: '8040', host: 'Mac mini' },
  { service: 'Mac API via SSH tunnel on VPS', port: '8892', host: 'GoDaddy (tunnel target)' },
  { service: 'Ollama / Llama (default)', port: '11434', host: 'Mac mini or GoDaddy' },
  { service: 'React dev (Vite)', port: '5174', host: 'Your PC / Mac' },
] as const

export function buildConnectionPresets(): ConnectionPreset[] {
  const pub = getPublicHost()
  return [
    {
      id: 'godaddy-same',
      label: 'GoDaddy — browser on this VPS',
      blurb: 'ML API and Ollama both on localhost (typical when you SSH and use a browser on the server).',
      mlApi: 'http://127.0.0.1:8890',
      ollama: 'http://127.0.0.1:11434',
    },
    {
      id: 'godaddy-remote',
      label: 'GoDaddy — browser on your laptop',
      blurb: 'ML API on the public host; open firewall for 8890. Ollama stays localhost-only unless you add a proxy or tunnel.',
      mlApi: `http://${pub}:8890`,
      ollama: 'http://127.0.0.1:11434',
      note: 'Remote browsers cannot reach Ollama on 127.0.0.1 at the VPS. Use the Mac preset on your Mac, or expose Ollama via nginx/SSH.',
    },
    {
      id: 'mac-local',
      label: 'Mac mini — same machine',
      blurb: 'Run uvicorn on 8040 and Ollama on the Mac; UI at http://127.0.0.1:5174.',
      mlApi: 'http://127.0.0.1:8040',
      ollama: 'http://127.0.0.1:11434',
    },
    {
      id: 'mac-tunnel',
      label: 'Mac ML API via SSH tunnel (on VPS)',
      blurb: 'From the Mac: macmini-reverse-tunnel.sh → VPS listens on 8892 → your Mac API on 8040.',
      mlApi: 'http://127.0.0.1:8892',
      ollama: 'http://127.0.0.1:11434',
      note: 'Use when the browser runs on the VPS and the tunnel is active. Ollama is still whichever host runs it.',
    },
  ]
}

/** Saved browser URL, then build-time VITE_API_URL. */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const stored = stripTrailingSlash((localStorage.getItem('ML_API_BASE_URL') ?? '').trim())
    if (stored) return stored
  }
  const env = (import.meta.env.VITE_API_URL ?? '').trim()
  if (env) return stripTrailingSlash(env)
  return ''
}

export function setBrowserApiBase(url: string): void {
  const t = url.trim()
  if (!t) {
    localStorage.removeItem('ML_API_BASE_URL')
    return
  }
  localStorage.setItem('ML_API_BASE_URL', stripTrailingSlash(t))
}

export function getOllamaBase(): string {
  if (typeof window === 'undefined') return ''
  const stored = stripTrailingSlash((localStorage.getItem(OLLAMA_STORAGE_KEY) ?? '').trim())
  if (stored) return stored
  const env = (import.meta.env.VITE_OLLAMA_URL ?? '').trim()
  return env ? stripTrailingSlash(env) : ''
}

export function setOllamaBase(url: string): void {
  const t = url.trim()
  if (!t) {
    localStorage.removeItem(OLLAMA_STORAGE_KEY)
    return
  }
  localStorage.setItem(OLLAMA_STORAGE_KEY, stripTrailingSlash(t))
}

export type ProbeResult = { ok: boolean; message: string; detail?: string }

export async function probeMlApi(base: string): Promise<ProbeResult> {
  const url = stripTrailingSlash(base.trim())
  if (!url) return { ok: false, message: 'Enter an ML API URL' }
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) })
    const data = await parseJson(res)
    if (!res.ok) return { ok: false, message: formatDetail(data) }
    const modelsRes = await fetch(`${url}/models`, { signal: AbortSignal.timeout(8000) })
    const modelsData = (await parseJson(modelsRes)) as { models?: unknown[] }
    const n = modelsRes.ok && Array.isArray(modelsData.models) ? modelsData.models.length : 0
    return {
      ok: true,
      message: 'ML API reachable',
      detail: n ? `${n} model(s) registered` : 'Health OK',
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Cannot reach ML API',
      detail: 'Check port, firewall, CORS_ORIGINS, and that uvicorn is running.',
    }
  }
}

export async function probeOllama(base: string): Promise<ProbeResult & { models?: string[] }> {
  const url = stripTrailingSlash(base.trim())
  if (!url) return { ok: false, message: 'Enter an Ollama URL (optional)' }
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) })
    const data = (await parseJson(res)) as { models?: { name?: string }[] }
    if (!res.ok) return { ok: false, message: typeof data === 'object' ? formatDetail(data) : `HTTP ${res.status}` }
    const names = (data.models ?? []).map((m) => m.name).filter(Boolean) as string[]
    return {
      ok: true,
      message: 'Ollama reachable',
      detail: names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') : 'No models listed',
      models: names,
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Cannot reach Ollama',
      detail: 'Is ollama serve running? For remote hosts use HTTPS proxy or SSH tunnel.',
    }
  }
}

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
  const res = await fetch(`${getApiBase()}/models`)
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { models: { model_id: string; info: Record<string, unknown> }[] }
}

export async function fetchModel(modelId: string) {
  const res = await fetch(`${getApiBase()}/models/${encodeURIComponent(modelId)}`)
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
  const res = await fetch(`${getApiBase()}/predict`, {
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
  const res = await fetch(`${getApiBase()}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { message: string; id: number }
}

export async function fetchStats(modelId: string) {
  const res = await fetch(`${getApiBase()}/stats/${encodeURIComponent(modelId)}`)
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { model_id: string; labeled_feedback_rows: number }
}

export async function retrain(modelId: string, minSamples = 10) {
  const res = await fetch(`${getApiBase()}/retrain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, min_samples: minSamples }),
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as { message: string; samples_used: number; artifact: string }
}

export async function trainFromCsv(form: FormData) {
  const res = await fetch(`${getApiBase()}/train`, {
    method: 'POST',
    body: form,
  })
  const data = await parseJson(res)
  if (!res.ok) throw new Error(formatDetail(data))
  return data as {
    message: string
    model_id: string
    metadata: Record<string, unknown>
    artifact: string
  }
}
