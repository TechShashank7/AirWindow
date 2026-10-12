import { useState, useEffect } from 'react';
import { SearchBar } from './components/SearchBar';
import { ForecastChart } from './components/ForecastChart';
import { ActivityPlanner } from './components/ActivityPlanner';
import { RecommendationPanel } from './components/RecommendationPanel';
import { AirAlertsModal } from './components/AirAlertsModal';
import type { AlertModalMode } from './components/AirAlertsModal';
import { AirQualityMap } from './components/AirQualityMap';
import { EarlyWarningPanel } from './components/EarlyWarningPanel';
import { CurrentConditionsCard } from './components/CurrentConditionsCard';
import { getAirQualityForecast } from './api/openmeteo';
import { isBackendEnabled, callEvaluateApi } from './api/evaluateApi';
import type { LocationResult } from './api/openmeteo';
import { processForecastData, getBestTimeWindow } from './utils/recommendation';
import type { DataPoint, RecommendationResult } from './utils/recommendation';
import { Wind, AlertCircle, Info, Bell, Navigation } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import { getBrowserCoordinates, reverseGeocodeCoordinates } from './utils/geolocation';

function App() {
  const [location, setLocation] = useState<LocationResult | null>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);

  // Air Alerts modal state
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertModalMode, setAlertModalMode] = useState<AlertModalMode>('CREATE');
  const [alertModalToken, setAlertModalToken] = useState<string>('');

  // Handle email verification / management links via URL fragment (#token=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const match = hash.match(/token=([a-f0-9]+)/i);

    if (match && match[1]) {
      const token = match[1];
      const path = (window.location.pathname || '').toLowerCase();
      const isManage = path.includes('/alerts/manage') || path.includes('manage');

      setAlertModalMode(isManage ? 'MANAGE' : 'VERIFY');
      setAlertModalToken(token);
      setIsAlertModalOpen(true);

      // Clean token from the address bar to avoid accidental sharing
      try {
        window.history.replaceState(null, '', window.location.pathname || '/');
      } catch {
        // Safe fallback
      }
    }
  }, []);

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

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    setGeoError(null);
    try {
      const coords = await getBrowserCoordinates();
      const loc = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
      await handleLocationSelect(loc);
    } catch (err: any) {
      setGeoError(err?.message || 'Unable to determine your location. Please search for your city manually.');
    } finally {
      setIsLocating(false);
    }
  };

  const handlePlanActivity = async (duration: number, start: string, end: string) => {
    if (!dataPoints.length || !location) return;
    const tz = location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentTimeStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH:mm");

    if (isBackendEnabled()) {
      try {
        setLoading(true);
        const res = await callEvaluateApi({
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: tz,
          durationMinutes: duration as any,
          preferredStart: start,
          preferredEnd: end,
          currentTime: currentTimeStr
        });
        
        // Update the global data points with the cached/normalized response
        if (res.data) {
          setDataPoints(res.data as unknown as DataPoint[]);
        }
        
        // Stale data warning
        if (res.metadata?.isStale) {
          console.warn("Using stale cache data due to upstream failure.");
        }

        setRecommendation(res.recommendation);
      } catch (err) {
        console.error("Backend evaluate failed:", err);
        // fallback to local computation if backend fails
        const result = getBestTimeWindow(dataPoints, duration, start, end, currentTimeStr);
        setRecommendation(result);
      } finally {
        setLoading(false);
      }
    } else {
      const result = getBestTimeWindow(dataPoints, duration, start, end, currentTimeStr);
      setRecommendation(result);
    }
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
          <div className="header-actions">
            <SearchBar
              onSelect={handleLocationSelect}
              onLocateStart={() => {
                setIsLocating(true);
                setGeoError(null);
              }}
              onLocateEnd={() => setIsLocating(false)}
              onLocateError={(err) => setGeoError(err)}
              isExternalLocating={isLocating}
            />
            <button
              type="button"
              className="btn-alert-nav"
              onClick={() => {
                setAlertModalMode('CREATE');
                setAlertModalToken('');
                setIsAlertModalOpen(true);
              }}
              title="Configure personalized air quality alerts"
            >
              <Bell size={17} />
              <span>Air Alerts</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main ───────────────────────────────────────────────── */}
      <main className="main">

        {/* Geolocation Error */}
        {geoError && (
          <div className="geo-error-banner" role="alert">
            <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2, color: '#ea580c' }} />
            <div className="geo-error-content">
              <strong>Location Notice</strong>
              <p>{geoError}</p>
            </div>
            <button
              type="button"
              className="btn-geo-error-dismiss"
              onClick={() => setGeoError(null)}
              aria-label="Dismiss error notification"
            >
              ×
            </button>
          </div>
        )}

        {/* Empty state */}
        {!location && !loading && !isLocating && (
          <div className="hero">
            <div className="hero-icon-wrap">
              <Wind size={48} color="#2563eb" />
            </div>
            <h2>Breathe better outside.</h2>
            <p>
              Search for any city to view a 48-hour air quality forecast and
              find the cleanest time window for your outdoor activity.
            </p>
            <div className="hero-locate-wrap">
              <button
                type="button"
                className="btn-hero-locate"
                onClick={handleUseCurrentLocation}
                disabled={isLocating}
              >
                <Navigation size={17} />
                <span>Use My Location</span>
              </button>
            </div>
          </div>
        )}

        {/* Geolocation Loading */}
        {isLocating && (
          <div className="loader-wrap">
            <div className="loader-ring" />
            <p className="loader-text pulse">Resolving your location & timezone…</p>
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

            {/* Contextual Alert Callout */}
            <div className="alert-callout-banner">
              <div className="alert-callout-content">
                <div className="alert-callout-icon">
                  <Bell size={18} />
                </div>
                <div>
                  <div className="alert-callout-title">Track alerts for {location.name}</div>
                  <div className="alert-callout-sub">
                    Get notified by email if air pollution is forecast to exceed your threshold.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-callout-action"
                onClick={() => {
                  setAlertModalMode('CREATE');
                  setAlertModalToken('');
                  setIsAlertModalOpen(true);
                }}
              >
                Set Alert
              </button>
            </div>

            {/* Section heading */}
            <div className="section-heading">
              <h2>{location.name}</h2>
              <span className="tz-badge">
                <span className="tz-dot" />
                Local timezone: {location.timezone}
              </span>
            </div>

            {/* Hyperlocal Current Air Quality & National AQI (Google Maps Platform) */}
            <CurrentConditionsCard location={location} />

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

            {/* Early Warning Panel (Next 12 Hours Forecast Spike & Trends) */}
            <EarlyWarningPanel
              dataPoints={dataPoints}
              locationName={location.name}
              timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              onOpenAlertModal={() => {
                setAlertModalMode('CREATE');
                setAlertModalToken('');
                setIsAlertModalOpen(true);
              }}
            />

            {/* Local Air-Quality Forecast Map */}
            <AirQualityMap location={location} />

            {/* Chart */}
            <ForecastChart data={dataPoints} />

            {/* Planner */}
            <ActivityPlanner onPlan={handlePlanActivity} timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} />

            {/* Recommendation */}
            {recommendation && (
              <div className="fade-up">
                <RecommendationPanel
                  result={recommendation}
                  onOpenAlertModal={() => {
                    setAlertModalMode('CREATE');
                    setAlertModalToken('');
                    setIsAlertModalOpen(true);
                  }}
                />
              </div>
            )}

            {/* Disclaimer */}
            <div className="disclaimer">
              <div className="disclaimer-title">
                <Info size={18} color="#64748b" /> About this data
              </div>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
                Forecast retrieved at {format(new Date(), "HH:mm 'on' MMM dd, yyyy")} (your local time).
              </p>
              <ul>
                <li>
                  <span>
                    <strong>Multi-Source Architecture:</strong> 48-hour continuous forecasts are powered by{' '}
                    <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">
                      Open-Meteo
                    </a>; current conditions and India National AQI are enriched via{' '}
                    <a href="https://developers.google.com/maps/documentation/air-quality" target="_blank" rel="noreferrer">
                      Google Maps Platform Air Quality API
                    </a>; and physical ground-monitoring sensor stations are mapped via{' '}
                    <a href="https://openaq.org/" target="_blank" rel="noreferrer">
                      OpenAQ
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

      {/* Air Alerts Modal */}
      <AirAlertsModal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        initialMode={alertModalMode}
        initialToken={alertModalToken}
        currentLocation={location}
      />
    </div>
  );
}

export default App;
