import { useCallback, useEffect, useReducer, useState, type ReactNode } from 'react'
import {
  buildConnectionPresets,
  fetchModel,
  fetchModels,
  fetchStats,
  getApiBase,
  getOllamaBase,
  PORT_REFERENCE,
  predict,
  probeMlApi,
  probeOllama,
  retrain,
  setBrowserApiBase,
  setOllamaBase,
  submitFeedback,
  trainFromCsv,
  type ConnectionPreset,
  type ProbeResult,
} from './api'
import './App.css'

type ModelRow = { model_id: string; info: { description?: string } }

type Tab = 'predict' | 'train' | 'connect'

type ProbeState = ProbeResult | null | 'loading'

function IconBrain() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3 3 3 0 0 1-1 2.2V14a4 4 0 0 1-8 0v-1.8A3 3 0 0 1 7 10a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z" />
      <path d="M9 18v2M15 18v2M10 22h4" />
    </svg>
  )
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3v18h18M7 16l4-6 4 3 5-8" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4M4 21h16" />
    </svg>
  )
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function presetBadge(id: string): { className: string; label: string } {
  if (id.startsWith('godaddy')) return { className: 'godaddy', label: 'GoDaddy VPS' }
  if (id.includes('tunnel')) return { className: 'tunnel', label: 'SSH tunnel' }
  return { className: 'mac', label: 'Mac mini' }
}

function AppShell({
  tab,
  setTab,
  children,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  children: ReactNode
}) {
  const ml = getApiBase()
  const ollama = getOllamaBase()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <IconBrain />
          </div>
          <div className="brand-text">
            <h1>Clinical ML</h1>
            <span>AI Workspace</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Main">
          <button
            type="button"
            className={tab === 'predict' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('predict')}
          >
            <IconChart />
            Predict &amp; feedback
          </button>
          <button
            type="button"
            className={tab === 'train' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('train')}
          >
            <IconUpload />
            Train from CSV
          </button>
          <button
            type="button"
            className={tab === 'connect' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('connect')}
          >
            <IconLink />
            Connections
          </button>
        </nav>
        <div className="side-status">
          <div className="status-row">
            <span className={`status-dot ${ml ? 'on' : 'off'}`} />
            <div>
              <div className="label">ML API</div>
              <code>{ml || 'not set'}</code>
            </div>
          </div>
          <div className="status-row">
            <span className={`status-dot ${ollama ? 'on' : 'off'}`} />
            <div>
              <div className="label">Ollama / Llama</div>
              <code>{ollama || 'not set'}</code>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}

function ConnectPanel({
  requireMl,
  embedded,
  onConnected,
}: {
  requireMl: boolean
  embedded?: boolean
  onConnected: () => void
}) {
  const presets = buildConnectionPresets()
  const [mlDraft, setMlDraft] = useState(() => getApiBase())
  const [ollamaDraft, setOllamaDraft] = useState(() => getOllamaBase())
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [mlProbe, setMlProbe] = useState<ProbeState>(null)
  const [ollamaProbe, setOllamaProbe] = useState<ProbeState>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const applyPreset = (p: ConnectionPreset) => {
    setActivePreset(p.id)
    setMlDraft(p.mlApi)
    setOllamaDraft(p.ollama)
    setMlProbe(null)
    setOllamaProbe(null)
    setMsg(`Preset “${p.label}” applied — run Test, then Save.`)
  }

  const runMlTest = async () => {
    setMlProbe('loading')
    setMsg(null)
    const r = await probeMlApi(mlDraft)
    setMlProbe(r)
  }

  const runOllamaTest = async () => {
    setOllamaProbe('loading')
    setMsg(null)
    const r = await probeOllama(ollamaDraft)
    setOllamaProbe(r)
  }

  const onSave = async () => {
    setMsg(null)
    if (!mlDraft.trim()) {
      setMsg('ML API URL is required.')
      return
    }
    const ml = await probeMlApi(mlDraft)
    setMlProbe(ml)
    if (!ml.ok) {
      setMsg('Fix ML API connection before saving.')
      return
    }
    setBrowserApiBase(mlDraft)
    let ollamaOk = true
    if (ollamaDraft.trim()) {
      const ol = await probeOllama(ollamaDraft)
      setOllamaProbe(ol)
      if (ol.ok) setOllamaBase(ollamaDraft)
      else {
        ollamaOk = false
        setMsg('ML API saved. Ollama test failed — fix the URL or clear it.')
      }
    } else {
      setOllamaBase('')
      setOllamaProbe(null)
    }
    if (ml.ok && ollamaOk) {
      setMsg('Connections saved.')
      onConnected()
    } else if (ml.ok) {
      onConnected()
    }
  }

  const onClear = () => {
    setBrowserApiBase('')
    setOllamaBase('')
    setMlDraft('')
    setOllamaDraft('')
    setMlProbe(null)
    setOllamaProbe(null)
    setActivePreset(null)
    setMsg('Cleared saved URLs.')
    onConnected()
  }

  const statusChip = (state: ProbeState, okLabel: string) => {
    if (state === 'loading') return <span className="chip chip-warn">Testing…</span>
    if (!state) return <span className="chip chip-muted">Not tested</span>
    return state.ok ? (
      <span className="chip chip-ok" title={state.detail}>
        {okLabel}
      </span>
    ) : (
      <span className="chip chip-err" title={state.detail}>
        Failed
      </span>
    )
  }

  const inner = (
    <>
      {!embedded ? (
        <header className="connect-hero">
          <h1>Connect your services</h1>
          <p className="sub">
            Point this workspace at your <strong>ML API</strong> and <strong>Ollama (Llama)</strong> — GoDaddy VPS or
            Mac mini. Pick a preset, test, then save.
          </p>
        </header>
      ) : null}

      <section className="card">
        <h2 className="h3">Quick presets</h2>
        <div className="preset-grid">
          {presets.map((p) => {
            const badge = presetBadge(p.id)
            return (
            <button
              key={p.id}
              type="button"
              className={`preset-card${activePreset === p.id ? ' active' : ''}`}
              onClick={() => applyPreset(p)}
            >
              <span className={`preset-badge ${badge.className}`}>{badge.label}</span>
              <span className="preset-title">{p.label}</span>
              <span className="preset-blurb">{p.blurb}</span>
              <span className="preset-ports">
                ML <code>{p.mlApi.replace(/^https?:\/\//, '')}</code>
                {' · '}
                Ollama <code>{p.ollama.replace(/^https?:\/\//, '')}</code>
              </span>
              {p.note ? <span className="preset-note">{p.note}</span> : null}
            </button>
            )
          })}
        </div>
      </section>

      <section className="card connect-form">
        <h2 className="h3">Endpoints</h2>
        <label className="label" htmlFor="ml-api-url">
          ML API base URL <span className="req">required</span>
        </label>
        <input
          id="ml-api-url"
          className="input"
          placeholder="http://127.0.0.1:8890"
          value={mlDraft}
          onChange={(e) => {
            setMlDraft(e.target.value)
            setMlProbe(null)
          }}
        />
        <div className="row align-center">
          {statusChip(mlProbe, 'ML OK')}
          <button type="button" className="btn" onClick={() => void runMlTest()}>
            Test ML API
          </button>
        </div>
        {mlProbe && mlProbe !== 'loading' && !mlProbe.ok ? (
          <p className="probe-detail err">{mlProbe.message}. {mlProbe.detail}</p>
        ) : null}
        {mlProbe && mlProbe !== 'loading' && mlProbe.ok && mlProbe.detail ? (
          <p className="probe-detail ok">{mlProbe.detail}</p>
        ) : null}

        <label className="label mt" htmlFor="ollama-url">
          Ollama / Llama URL <span className="muted">optional</span>
        </label>
        <input
          id="ollama-url"
          className="input"
          placeholder="http://127.0.0.1:11434"
          value={ollamaDraft}
          onChange={(e) => {
            setOllamaDraft(e.target.value)
            setOllamaProbe(null)
          }}
        />
        <div className="row align-center">
          {statusChip(ollamaProbe, 'Ollama OK')}
          <button type="button" className="btn" onClick={() => void runOllamaTest()}>
            Test Ollama
          </button>
        </div>
        {ollamaProbe && ollamaProbe !== 'loading' && !ollamaProbe.ok ? (
          <p className="probe-detail err">{ollamaProbe.message}. {ollamaProbe.detail}</p>
        ) : null}
        {ollamaProbe && ollamaProbe !== 'loading' && ollamaProbe.ok && ollamaProbe.detail ? (
          <p className="probe-detail ok">{ollamaProbe.detail}</p>
        ) : null}

        <div className="actions">
          <button type="button" className="btn primary" onClick={() => void onSave()}>
            {requireMl ? 'Save & open workspace' : 'Save connections'}
          </button>
          <button type="button" className="btn" onClick={onClear}>
            Clear all
          </button>
        </div>
        {msg ? <p className="connect-msg">{msg}</p> : null}
      </section>

      <section className="card">
        <h2 className="h3">Port map (this project)</h2>
        <div className="table-wrap">
          <table className="port-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Port</th>
                <th>Host</th>
              </tr>
            </thead>
            <tbody>
              {PORT_REFERENCE.map((row) => (
                <tr key={row.port + row.service}>
                  <td>{row.service}</td>
                  <td>
                    <code>{row.port}</code>
                  </td>
                  <td>{row.host}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt">
          On this GoDaddy box we saw <strong>Ollama on 11434</strong> and <strong>ML API on 8890</strong> when running.
          Mac mini defaults: API <code>8040</code>, tunnel on VPS <code>8892</code>.
        </p>
      </section>
    </>
  )

  if (embedded) return <div className="connect-page">{inner}</div>
  return <div className="auth-layout">{inner}</div>
}

function previewCsvNaive(text: string, maxRows = 8): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, maxRows)
  return lines.map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '').trim()))
}

export default function App() {
  const [, bumpApi] = useReducer((n: number) => n + 1, 0)
  const apiConnected = Boolean(getApiBase())

  const [tab, setTab] = useState<Tab>('predict')
  const [models, setModels] = useState<ModelRow[]>([])
  const [modelId, setModelId] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [modelType, setModelType] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [result, setResult] = useState<{
    prediction: number
    confidence: number | null
    model_type: string
  } | null>(null)
  const [feedbackOutcome, setFeedbackOutcome] = useState<'0' | '1' | ''>('')
  const [stats, setStats] = useState<number | null>(null)

  const [trainFile, setTrainFile] = useState<File | null>(null)
  const [trainPreview, setTrainPreview] = useState<string[][]>([])
  const [trainModelId, setTrainModelId] = useState('')
  const [trainTarget, setTrainTarget] = useState('')
  const [trainType, setTrainType] = useState<'classification' | 'regression'>('classification')
  const [trainDescription, setTrainDescription] = useState('')

  const loadModels = useCallback(async () => {
    if (!getApiBase()) return
    setError(null)
    try {
      const data = await fetchModels()
      setModels(data.models ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models')
    }
  }, [])

  useEffect(() => {
    if (!apiConnected) return
    void loadModels()
  }, [apiConnected, bumpApi, loadModels])

  const onSelectModel = async (id: string) => {
    setModelId(id)
    setResult(null)
    setFeedbackOutcome('')
    setError(null)
    setSuccess(null)
    if (!id) {
      setFeatures([])
      setDescription('')
      setModelType('')
      setValues({})
      return
    }
    setLoading(true)
    try {
      const m = await fetchModel(id)
      setFeatures(m.features ?? [])
      setDescription(String(m.description ?? ''))
      setModelType(String(m.type ?? ''))
      const init: Record<string, string> = {}
      for (const f of m.features ?? []) init[f] = ''
      setValues(init)
      const s = await fetchStats(id)
      setStats(s.labeled_feedback_rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load model')
    } finally {
      setLoading(false)
    }
  }

  const onPredict = async () => {
    if (!modelId) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const data: Record<string, number> = {}
      for (const f of features) {
        const raw = values[f]?.trim()
        if (raw === '' || raw === undefined) throw new Error(`Missing value for ${f}`)
        data[f] = Number(raw)
        if (Number.isNaN(data[f])) throw new Error(`Invalid number for ${f}`)
      }
      const r = await predict({ model_id: modelId, data: data })
      setResult({
        prediction: Number(r.prediction),
        confidence: r.confidence == null ? null : Number(r.confidence),
        model_type: r.model_type,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed')
    } finally {
      setLoading(false)
    }
  }

  const onFeedback = async () => {
    if (!modelId || feedbackOutcome === '') return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const data: Record<string, number> = {}
      for (const f of features) {
        const raw = values[f]?.trim()
        if (raw === '' || raw === undefined) throw new Error(`Missing value for ${f}`)
        data[f] = Number(raw)
        if (Number.isNaN(data[f])) throw new Error(`Invalid number for ${f}`)
      }
      await submitFeedback({
        model_id: modelId,
        data,
        actual_outcome: Number(feedbackOutcome),
        predicted: result?.prediction,
      })
      const s = await fetchStats(modelId)
      setStats(s.labeled_feedback_rows)
      setFeedbackOutcome('')
      setSuccess('Feedback stored.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feedback failed')
    } finally {
      setLoading(false)
    }
  }

  const onRetrain = async () => {
    if (!modelId) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await retrain(modelId, 10)
      await loadModels()
      await onSelectModel(modelId)
      setSuccess('Retrain finished; model reloaded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retrain failed')
    } finally {
      setLoading(false)
    }
  }

  const onTrainFile = async (file: File | null) => {
    setTrainFile(file)
    setTrainPreview([])
    setTrainTarget('')
    if (!file) return
    const slice = file.slice(0, Math.min(file.size, 64_000))
    const text = await slice.text()
    setTrainPreview(previewCsvNaive(text, 10))
  }

  const headerOptions = trainPreview.length > 0 ? trainPreview[0] : []

  const onTrainSubmit = async () => {
    if (!trainFile || !trainModelId.trim() || !trainTarget.trim()) {
      setError('Choose a CSV file, model id, and target column.')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const fd = new FormData()
      fd.append('file', trainFile)
      fd.append('model_id', trainModelId.trim())
      fd.append('target_column', trainTarget.trim())
      fd.append('model_type', trainType)
      fd.append('description', trainDescription.trim())
      const r = await trainFromCsv(fd)
      setSuccess(`${r.message}: ${r.model_id} (${String(r.metadata?.n_samples ?? '?')} rows).`)
      setTrainFile(null)
      setTrainPreview([])
      setTrainModelId('')
      setTrainTarget('')
      setTrainDescription('')
      await loadModels()
      setTab('predict')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Training failed')
    } finally {
      setLoading(false)
    }
  }

  if (!apiConnected) {
    return <ConnectPanel requireMl embedded={false} onConnected={() => bumpApi()} />
  }

  const pageTitle =
    tab === 'predict'
      ? { title: 'Predict & feedback', sub: 'Run inference on registered models and submit clinician labels for retraining.' }
      : tab === 'train'
        ? { title: 'Train from CSV', sub: 'Upload a dataset to fit a new RandomForest and register it in the model registry.' }
        : { title: 'Connections', sub: 'ML API and Ollama endpoints for GoDaddy VPS and Mac mini.' }

  const riskLabel =
    result && result.model_type === 'classification'
      ? result.prediction === 1
        ? 'Positive / higher risk class'
        : 'Negative / lower risk class'
      : result
        ? `Output: ${result.prediction}`
        : ''

  return (
    <AppShell tab={tab} setTab={setTab}>
      <header className="page-header">
        <h2>{pageTitle.title}</h2>
        <p className="sub">{pageTitle.sub}</p>
      </header>

      {success ? (
        <div className="card ok" role="status">
          {success}
        </div>
      ) : null}
      {error ? (
        <div className="card error" role="alert">
          {error}
        </div>
      ) : null}

      {tab === 'connect' ? (
        <ConnectPanel requireMl={false} embedded onConnected={() => bumpApi()} />
      ) : null}

      {tab === 'train' && (
        <section className="card train">
          <h2>Train a new model (RandomForest)</h2>
          <p className="muted">
            Upload a CSV whose columns are numeric (or coercible) features plus one <strong>target</strong> column.
            The server fits sklearn, writes <code>{'{model_id}'}.pkl</code>, and registers it for predictions.
          </p>

          <div className="grid train-grid">
            <div>
              <label className="label" htmlFor="csv">
                Dataset (.csv)
              </label>
              <input
                id="csv"
                className="input"
                type="file"
                accept=".csv,text/csv"
                disabled={loading}
                onChange={(e) => void onTrainFile(e.target.files?.[0] ?? null)}
              />
              <label className="label mt" htmlFor="mid">
                Model id (registry key)
              </label>
              <input
                id="mid"
                className="input"
                placeholder="e.g. diabetes_risk"
                value={trainModelId}
                disabled={loading}
                onChange={(e) => setTrainModelId(e.target.value)}
              />
              <label className="label mt" htmlFor="tdesc">
                Description (optional)
              </label>
              <input
                id="tdesc"
                className="input"
                placeholder="Short label for the model list"
                value={trainDescription}
                disabled={loading}
                onChange={(e) => setTrainDescription(e.target.value)}
              />
              <label className="label mt" htmlFor="mtype">
                Task type
              </label>
              <select
                id="mtype"
                className="input"
                value={trainType}
                disabled={loading}
                onChange={(e) => setTrainType(e.target.value as 'classification' | 'regression')}
              >
                <option value="classification">Classification</option>
                <option value="regression">Regression</option>
              </select>
              <label className="label mt" htmlFor="target">
                Target column
              </label>
              {headerOptions.length > 0 ? (
                <select
                  id="target"
                  className="input"
                  value={trainTarget}
                  disabled={loading}
                  onChange={(e) => setTrainTarget(e.target.value)}
                >
                  <option value="">Select from header row…</option>
                  {headerOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="target"
                  className="input"
                  placeholder="Column name after you pick a CSV"
                  value={trainTarget}
                  disabled={loading}
                  onChange={(e) => setTrainTarget(e.target.value)}
                />
              )}
              <div className="actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading || !trainFile}
                  onClick={() => void onTrainSubmit()}
                >
                  Train &amp; register
                </button>
              </div>
            </div>
            <div>
              <h3 className="h3">Preview (first rows)</h3>
              {trainPreview.length === 0 ? (
                <p className="muted">Choose a CSV to preview columns and rows.</p>
              ) : (
                <div className="table-wrap">
                  <table className="preview">
                    <tbody>
                      {trainPreview.map((row, i) => (
                        <tr key={i}>
                          {row.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'predict' && (
        <>
          <section className="grid">
            <div className="card">
              <h2>Model</h2>
              <label className="label" htmlFor="model">
                Active model
              </label>
              <select
                id="model"
                className="input"
                value={modelId}
                disabled={loading}
                onChange={(e) => void onSelectModel(e.target.value)}
              >
                <option value="">Select…</option>
                {models.map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.model_id}
                    {m.info?.description ? ` — ${m.info.description}` : ''}
                  </option>
                ))}
              </select>
              {modelId ? (
                <div className="meta">
                  <div>
                    <span className="k">Type</span> {modelType || '—'}
                  </div>
                  <div>
                    <span className="k">Description</span> {description || '—'}
                  </div>
                  <div>
                    <span className="k">Labeled feedback rows</span> {stats ?? '—'}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="card">
              <h2>Features</h2>
              {features.length === 0 ? (
                <p className="muted">Choose a model to render its feature form.</p>
              ) : (
                <div className="fields">
                  {features.map((f) => (
                    <div key={f} className="field">
                      <label className="label" htmlFor={f}>
                        {f.replaceAll('_', ' ')}
                      </label>
                      <input
                        id={f}
                        className="input"
                        inputMode="decimal"
                        value={values[f] ?? ''}
                        disabled={loading}
                        onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading || !modelId}
                  onClick={() => void onPredict()}
                >
                  Run prediction
                </button>
              </div>
            </div>
          </section>

          {result ? (
            <section className="card result">
              <h2>Result</h2>
              <p className="lead">{riskLabel}</p>
              {result.confidence != null ? (
                <p className="muted">
                  Max class probability: <strong>{(result.confidence * 100).toFixed(1)}%</strong>
                </p>
              ) : (
                <p className="muted">No probability vector available for this estimator.</p>
              )}

              <div className="feedback">
                <h3>Clinician confirmation (learning loop)</h3>
                <p className="muted">
                  Store the confirmed label for this patient vector. When enough rows exist, retrain updates the{' '}
                  <code>.pkl</code> for this <code>model_id</code>.
                </p>
                <div className="row">
                  <label className="pill">
                    <input
                      type="radio"
                      name="fb"
                      checked={feedbackOutcome === '0'}
                      onChange={() => setFeedbackOutcome('0')}
                    />
                    Actual class 0
                  </label>
                  <label className="pill">
                    <input
                      type="radio"
                      name="fb"
                      checked={feedbackOutcome === '1'}
                      onChange={() => setFeedbackOutcome('1')}
                    />
                    Actual class 1
                  </label>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={loading || feedbackOutcome === ''}
                    onClick={() => void onFeedback()}
                  >
                    Save feedback
                  </button>
                  <button type="button" className="btn ghost" disabled={loading} onClick={() => void onRetrain()}>
                    Retrain (needs ≥10 labels)
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}

      {tab !== 'connect' ? (
        <footer className="footer muted">
          Endpoints are configured in <strong>Connections</strong>. Ensure CORS allows this origin.
        </footer>
      ) : null}
    </AppShell>
  )
}
