import { useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { ForecastChart } from './components/ForecastChart';
import { ActivityPlanner } from './components/ActivityPlanner';
import { RecommendationPanel } from './components/RecommendationPanel';
import { getAirQualityForecast } from './api/openmeteo';
import type { LocationResult } from './api/openmeteo';
import { processForecastData, getBestTimeWindow } from './utils/recommendation';
import type { DataPoint, RecommendationResult } from './utils/recommendation';
import { Wind, AlertCircle, Info } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';

function App() {
  const [location, setLocation] = useState<LocationResult | null>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);

  const handleLocationSelect = async (loc: LocationResult) => {
    setLocation(loc);
    setLoading(true);
    setError(null);
    setRecommendation(null);
    try {
      const forecast = await getAirQualityForecast(loc.latitude, loc.longitude);
      const points = processForecastData(forecast);
      setDataPoints(points);
    } catch (err) {
      setError('Failed to fetch air quality data. The Open-Meteo API may be temporarily unavailable. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePlanActivity = (duration: number, start: string, end: string) => {
    if (!dataPoints.length || !location) return;
    const tz = location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentTimeStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH:mm");
    const result = getBestTimeWindow(dataPoints, duration, start, end, currentTimeStr);
    setRecommendation(result);
  };

  // Latest data point for the "current reading" stat cards
  const latestPoint = dataPoints.find(d => d.pm25 !== null || d.pm10 !== null);

  return (
    <div>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-inner">
          <a href="/" className="brand">
            <div className="brand-icon">
              <Wind size={22} />
            </div>
            <span className="brand-name">AirWindow</span>
          </a>
          <SearchBar onSelect={handleLocationSelect} />
        </div>
      </header>

      {/* ─── Main ───────────────────────────────────────────────── */}
      <main className="main">

        {/* Empty state */}
        {!location && !loading && (
          <div className="hero">
            <div className="hero-icon-wrap">
              <Wind size={48} color="#2563eb" />
            </div>
            <h2>Breathe better outside.</h2>
            <p>
              Search for any city to view a 48-hour air quality forecast and
              find the cleanest time window for your outdoor activity.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loader-wrap">
            <div className="loader-ring" />
            <p className="loader-text pulse">Fetching air quality forecast…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-banner">
            <AlertCircle size={22} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Error Loading Data</strong>
              {error}
            </div>
          </div>
        )}

        {/* Forecast content */}
        {location && !loading && dataPoints.length > 0 && (
          <div className="fade-up">

            {/* Section heading */}
            <div className="section-heading">
              <h2>{location.name}</h2>
              <span className="tz-badge">
                <span className="tz-dot" />
                Local timezone: {location.timezone}
              </span>
            </div>

            {/* Stat cards for the earliest available reading */}
            {latestPoint && (
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">PM2.5 Forecast</div>
                  <div className={`stat-value val-pm25`}>
                    {latestPoint.pm25 !== null ? latestPoint.pm25.toFixed(1) : '—'}
                  </div>
                  <div className="stat-unit">µg/m³</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">PM10 Forecast</div>
                  <div className={`stat-value val-pm10`}>
                    {latestPoint.pm10 !== null ? latestPoint.pm10.toFixed(1) : '—'}
                  </div>
                  <div className="stat-unit">µg/m³</div>
                </div>
                <div className="stat-card" title="Calculated as PM2.5 + (0.5 × PM10). Dimensionless unit.">
                  <div className="stat-label">Relative Score</div>
                  <div className={`stat-value val-score`}>
                    {latestPoint.score !== null ? latestPoint.score.toFixed(1) : '—'}
                  </div>
                  <div className="stat-unit">Custom comparison index</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Earliest Forecast</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
                    {format(parseISO(latestPoint.time), 'HH:mm')}
                  </div>
                  <div className="stat-unit">{format(parseISO(latestPoint.time), 'MMM dd')}</div>
                </div>
              </div>
            )}

            {/* Chart */}
            <ForecastChart data={dataPoints} />

            {/* Planner */}
            <ActivityPlanner onPlan={handlePlanActivity} timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} />

            {/* Recommendation */}
            {recommendation && (
              <div className="fade-up">
                <RecommendationPanel result={recommendation} />
              </div>
            )}

            {/* Disclaimer */}
            <div className="disclaimer">
              <div className="disclaimer-title">
                <Info size={18} color="#64748b" /> About this data
              </div>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
                Forecast retrieved at {format(new Date(), 'HH:mm on MMM dd, yyyy')} (your local time).
              </p>
              <ul>
                <li>
                  <span>
                    <strong>Data Source:</strong> Air quality forecasts are provided by the{' '}
                    <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">
                      Open-Meteo Air Quality API
                    </a>.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Modelled Forecasts:</strong> Values are <em>modelled estimates</em>, not
                    real-time measurements from physical ground stations. Actual conditions may differ.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Relative Pollution Score Formula:</strong>{' '}
                    <code>Score = PM2.5 + (0.5 × PM10)</code>. This is a transparent, dimensionless
                    comparison metric used only to rank time windows against each other —{' '}
                    <strong>not an official AQI</strong> or a health-risk measure.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>No Safety Guarantee:</strong> Recommendations are comparative, not medical
                    advice. Even the "best available" time may have poor air quality. Always check local advisories before outdoor activities.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
