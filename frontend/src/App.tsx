import { useCallback, useEffect, useReducer, useState } from 'react'
import {
  fetchModel,
  fetchModels,
  fetchStats,
  getApiBase,
  predict,
  retrain,
  setBrowserApiBase,
  submitFeedback,
  trainFromCsv,
} from './api'
import './App.css'

type ModelRow = { model_id: string; info: { description?: string } }

type Tab = 'predict' | 'train'

function previewCsvNaive(text: string, maxRows = 8): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, maxRows)
  return lines.map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '').trim()))
}

export default function App() {
  const [, bumpApi] = useReducer((n: number) => n + 1, 0)
  const apiConnected = Boolean(getApiBase())

  const [tab, setTab] = useState<Tab>('predict')
  const [browserUrlDraft, setBrowserUrlDraft] = useState('')
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

  useEffect(() => {
    setBrowserUrlDraft(typeof window !== 'undefined' ? localStorage.getItem('ML_API_BASE_URL') ?? '' : '')
  }, [])

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

  const onSaveBrowserApi = () => {
    setError(null)
    setSuccess(null)
    setBrowserApiBase(browserUrlDraft)
    bumpApi()
    setSuccess('API URL saved in this browser. If calls fail, check HTTPS, CORS, and that the server is reachable.')
  }

  const onClearBrowserApi = () => {
    setBrowserApiBase('')
    setBrowserUrlDraft('')
    bumpApi()
    setSuccess(null)
  }

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
    return (
      <div className="page">
        <div className="card warn">
          <h1>Connect to your ML API</h1>
          <p className="mb">
            This static site (for example GitHub Pages) does not bundle a private API URL unless you set one at build
            time. You can still point this browser at your server:
          </p>
          <ul className="list">
            <li>
              <strong>GitHub build:</strong> set repository variable <code>VITE_API_URL</code> (Actions → Variables) to
              your public API, e.g. <code>https://your-host:8002</code>, then re-run <em>Deploy frontend to GitHub
              Pages</em>.
            </li>
            <li>
              <strong>This browser only:</strong> paste your API base URL below (no trailing slash). It is stored as{' '}
              <code>ML_API_BASE_URL</code> in <code>localStorage</code>. Use HTTPS if the site is served over HTTPS.
            </li>
          </ul>
          <label className="label" htmlFor="apiurl">
            API base URL
          </label>
          <input
            id="apiurl"
            className="input"
            placeholder="https://your-vps-or-domain:8002"
            value={browserUrlDraft}
            onChange={(e) => setBrowserUrlDraft(e.target.value)}
          />
          <div className="actions">
            <button type="button" className="btn primary" onClick={onSaveBrowserApi}>
              Save &amp; connect
            </button>
            <button type="button" className="btn" onClick={onClearBrowserApi}>
              Clear saved URL
            </button>
          </div>
          <p className="muted small mt">
            Ensure your API allows this origin in CORS (e.g. <code>https://zub165.github.io</code> or your custom
            domain).
          </p>
        </div>
      </div>
    )
  }

  const riskLabel =
    result && result.model_type === 'classification'
      ? result.prediction === 1
        ? 'Positive / higher risk class'
        : 'Negative / lower risk class'
      : result
        ? `Output: ${result.prediction}`
        : ''

  return (
    <div className="page">
      <header className="header">
        <h1>Clinical ML workspace</h1>
        <p className="sub">
          Train new models from CSV, run predictions, and save clinician labels for server-side retraining (FastAPI or
          Django backend).
        </p>
      </header>

      <nav className="tabs" aria-label="Primary">
        <button type="button" className={tab === 'predict' ? 'tab active' : 'tab'} onClick={() => setTab('predict')}>
          Predict &amp; feedback
        </button>
        <button type="button" className={tab === 'train' ? 'tab active' : 'tab'} onClick={() => setTab('train')}>
          Train from CSV
        </button>
      </nav>

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

      {tab === 'train' ? (
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
      ) : (
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

      <footer className="footer muted">
        API: <code>{getApiBase()}</code> — CORS must allow this origin. Advanced training uses <code>POST /train</code>{' '}
        (multipart CSV + fields).
      </footer>
    </div>
  )
}
