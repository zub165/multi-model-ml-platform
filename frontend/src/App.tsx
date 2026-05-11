import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchModel,
  fetchModels,
  fetchStats,
  predict,
  retrain,
  submitFeedback,
} from './api'
import './App.css'

type ModelRow = { model_id: string; info: { description?: string } }

export default function App() {
  const apiConfigured = useMemo(
    () => Boolean((import.meta.env.VITE_API_URL ?? '').trim()),
    [],
  )

  const [models, setModels] = useState<ModelRow[]>([])
  const [modelId, setModelId] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [modelType, setModelType] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    prediction: number
    confidence: number | null
    model_type: string
  } | null>(null)
  const [feedbackOutcome, setFeedbackOutcome] = useState<'0' | '1' | ''>('')
  const [stats, setStats] = useState<number | null>(null)

  const loadModels = useCallback(async () => {
    setError(null)
    try {
      const data = await fetchModels()
      setModels(data.models ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models')
    }
  }, [])

  useEffect(() => {
    if (!apiConfigured) return
    void loadModels()
  }, [apiConfigured, loadModels])

  const onSelectModel = async (id: string) => {
    setModelId(id)
    setResult(null)
    setFeedbackOutcome('')
    setError(null)
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
    try {
      await retrain(modelId, 10)
      await loadModels()
      await onSelectModel(modelId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retrain failed')
    } finally {
      setLoading(false)
    }
  }

  if (!apiConfigured) {
    return (
      <div className="page">
        <div className="card warn">
          <h1>Configure API URL</h1>
          <p>
            Create <code>frontend/.env.local</code> with{' '}
            <code>VITE_API_URL=http://YOUR_VPS_IP:API_PORT</code> (use a free port), then restart{' '}
            <code>npm run dev</code>.
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
          Predictions call the FastAPI service; confirmed outcomes are stored for retraining.
        </p>
      </header>

      {error ? (
        <div className="card error" role="alert">
          {error}
        </div>
      ) : null}

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
            <button type="button" className="btn primary" disabled={loading || !modelId} onClick={() => void onPredict()}>
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

      <footer className="footer muted">
        Dev: set <code>VITE_API_URL</code> to your API. Production: build the SPA and serve behind nginx on a free port;
        allow CORS from that origin via <code>CORS_ORIGINS</code> on the API.
      </footer>
    </div>
  )
}
