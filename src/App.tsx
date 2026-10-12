import { useState, useEffect, useMemo } from 'react';
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
import { 
  Wind, AlertCircle, Info, Bell, Navigation, 
  BarChart3, Map, Calendar, ShieldCheck, RefreshCw, 
  X, Sparkles, ExternalLink, Activity, ArrowRight, CheckCircle2,
  Clock
} from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import { getBrowserCoordinates, reverseGeocodeCoordinates } from './utils/geolocation';

type ViewTab = 'overview' | 'forecast' | 'map' | 'planner' | 'report';

function App() {
  const [location, setLocation] = useState<LocationResult | null>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');
  const [isPlanning, setIsPlanning] = useState(false);

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
      // Trigger smooth re-render for charts and maps
      setTimeout(() => {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
      }, 100);
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
        setIsPlanning(true);
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
        
        if (res.metadata?.isStale) {
          console.warn("Using stale cache data due to upstream failure.");
        }

        setRecommendation(res.recommendation);
      } catch (err) {
        console.error("Backend evaluate failed:", err);
        const result = getBestTimeWindow(dataPoints, duration, start, end, currentTimeStr);
        setRecommendation(result);
      } finally {
        setIsPlanning(false);
      }
    } else {
      const result = getBestTimeWindow(dataPoints, duration, start, end, currentTimeStr);
      setRecommendation(result);
    }
  };

  const handleTabChange = (tab: ViewTab) => {
    setActiveTab(tab);
    // Let Recharts & Leaflet resize cleanly
    setTimeout(() => {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    }, 50);
  };

  // Time format helper for header clock & current-hour lookup
  const tz = location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentLocalTimeDisplay = formatInTimeZone(new Date(), tz, "HH:mm · EEE, MMM d");
  const currentHourLocal = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH");

  // Dynamic forecast point matching the current hour (or closest upcoming hour)
  const currentPoint = useMemo(() => {
    if (!dataPoints || dataPoints.length === 0) return null;
    return (
      dataPoints.find((d) => d.time.substring(0, 13) === currentHourLocal) ||
      dataPoints.find((d) => d.time.substring(0, 13) > currentHourLocal) ||
      dataPoints.find((d) => d.pm25 !== null || d.pm10 !== null) ||
      null
    );
  }, [dataPoints, currentHourLocal]);

  return (
    <div className="app-shell">
      {/* ─── Modern Glassmorphism Navbar ──────────────────────── */}
      <header className="app-header">
        <div className="header-inner">
          <a href="/" className="brand">
            <div className="brand-icon">
              <Wind size={22} />
            </div>
            <div className="brand-text">
              <span className="brand-name">AirWindow</span>
              <span className="brand-tagline">Clean Air Intelligence</span>
            </div>
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

            <div className="header-buttons">
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
                <Bell size={16} />
                <span>Air Alerts</span>
              </button>
            </div>
          </div>
        </div>

        {/* ─── Navigation Tabs Strip (Visible when location loaded) ─── */}
        {location && !loading && (
          <div className="nav-tabs-bar">
            <div className="nav-tabs-inner">
              <button
                type="button"
                className={`nav-tab-pill ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => handleTabChange('overview')}
              >
                <BarChart3 size={16} />
                <span>Overview</span>
              </button>
              <button
                type="button"
                className={`nav-tab-pill ${activeTab === 'forecast' ? 'active' : ''}`}
                onClick={() => handleTabChange('forecast')}
              >
                <Activity size={16} />
                <span>48h Forecast</span>
              </button>
              <button
                type="button"
                className={`nav-tab-pill ${activeTab === 'map' ? 'active' : ''}`}
                onClick={() => handleTabChange('map')}
              >
                <Map size={16} />
                <span>Air Quality Map</span>
              </button>
              <button
                type="button"
                className={`nav-tab-pill ${activeTab === 'planner' ? 'active' : ''}`}
                onClick={() => handleTabChange('planner')}
              >
                <Calendar size={16} />
                <span>Activity Planner</span>
              </button>
              <button
                type="button"
                className={`nav-tab-pill ${activeTab === 'report' ? 'active' : ''}`}
                onClick={() => handleTabChange('report')}
              >
                <Sparkles size={16} />
                <span>Full Report</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ─── Main Content Area ───────────────────────────────────── */}
      <main className="main-content">
        {/* Geolocation Notice / Error Banner */}
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

        {/* Loading State */}
        {(loading || isLocating) && (
          <div className="loader-wrap">
            <div className="loader-ring" />
            <p className="loader-text pulse">
              {isLocating
                ? 'Resolving your location & nearest air quality station…'
                : `Fetching comprehensive 48-hour air forecast for ${location?.name || 'city'}…`}
            </p>
          </div>
        )}

        {/* Error Banner */}
        {error && !loading && (
          <div className="error-banner">
            <AlertCircle size={22} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Error Loading Data</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ─── Landing Hero Screen (No Location Selected) ────────── */}
        {!location && !loading && !isLocating && (
          <div className="landing-hero-container fade-up">
            <div className="landing-hero-card">
              <div className="hero-badge">
                <Sparkles size={14} />
                <span>Next-Generation Atmospheric Intelligence</span>
              </div>
              <h1 className="hero-headline">
                Breathe better outside.<br />
                <span className="hero-gradient-text">Plan with precision.</span>
              </h1>
              <p className="hero-subtext">
                Continuous 48-hour aerosol forecasts, hyperlocal national AQI, 
                and smart outdoor activity window recommendations to protect your respiratory health.
              </p>

              <div className="hero-cta-group">
                <button
                  type="button"
                  className="btn-hero-primary"
                  onClick={handleUseCurrentLocation}
                  disabled={isLocating}
                >
                  <Navigation size={18} />
                  <span>Use My Current Location</span>
                </button>
              </div>
            </div>

            {/* Feature Highlights Grid */}
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon-box blue">
                  <Activity size={22} />
                </div>
                <h3>48-Hour Forecasts</h3>
                <p>
                  Hourly high-resolution particulate tracking (PM2.5 & PM10) alongside wind dispersion modeling.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-box emerald">
                  <ShieldCheck size={22} />
                </div>
                <h3>Activity Window Finder</h3>
                <p>
                  Compare pollution levels across times to find when outdoor runs, walks, or sports are safest.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-box amber">
                  <Map size={22} />
                </div>
                <h3>Spatial Grids & Ground Sensors</h3>
                <p>
                  Interactive regional grid maps cross-referenced with genuine OpenAQ ground monitoring stations.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon-box indigo">
                  <Bell size={22} />
                </div>
                <h3>Proactive Air Alerts</h3>
                <p>
                  Receive automated email notifications before hazardous pollution spikes hit your city.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── Active City Dashboard ─────────────────────────────── */}
        {location && !loading && dataPoints.length > 0 && (
          <div className="city-dashboard fade-up">
            {/* Location Hero Header Bar */}
            <div className="city-header-bar">
              <div className="city-header-info">
                <div className="city-title-row">
                  <h2 className="city-name">{location.name}</h2>
                  {location.country && (
                    <span className="country-badge">{[location.admin1, location.country].filter(Boolean).join(', ')}</span>
                  )}
                </div>
                <div className="city-meta-row">
                  <span className="meta-pill live-clock">
                    <span className="live-dot" />
                    {currentLocalTimeDisplay} ({location.timezone || 'Local'})
                  </span>
                  <span className="meta-pill coords">
                    {location.latitude.toFixed(2)}°N, {location.longitude.toFixed(2)}°E
                  </span>
                </div>
              </div>

              <div className="city-header-actions">
                <button
                  type="button"
                  className="btn-city-action refresh"
                  onClick={() => handleLocationSelect(location)}
                  title="Refresh forecast data"
                >
                  <RefreshCw size={15} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  className="btn-city-action alert"
                  onClick={() => {
                    setAlertModalMode('CREATE');
                    setAlertModalToken('');
                    setIsAlertModalOpen(true);
                  }}
                  title="Set alerts for this city"
                >
                  <Bell size={15} />
                  <span>Set Alert</span>
                </button>
                <button
                  type="button"
                  className="btn-city-action clear"
                  onClick={() => setLocation(null)}
                  title="Search another location"
                >
                  <X size={15} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* ── Contextual Alert Callout Strip ── */}
            <div className="alert-callout-banner">
              <div className="alert-callout-content">
                <div className="alert-callout-icon">
                  <Bell size={18} />
                </div>
                <div>
                  <div className="alert-callout-title">Track alerts for {location.name}</div>
                  <div className="alert-callout-sub">
                    Get notified by email if air pollution is forecast to exceed your health threshold.
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
                Configure Alert
              </button>
            </div>

            {/* ─── TAB 1: OVERVIEW DASHBOARD ──────────────────────── */}
            {activeTab === 'overview' && (
              <div className="overview-layout">
                {/* 2-Column Responsive Dashboard Grid */}
                <div className="dashboard-grid">
                  {/* Left Column (Primary Health & Conditions) */}
                  <div className="dashboard-col-main">
                    {/* Hyperlocal Current Conditions Card */}
                    <CurrentConditionsCard location={location} />

                    {/* KPI Stat Grid */}
                    {currentPoint && (
                      <div className="stat-grid">
                        <div className="stat-card">
                          <div className="stat-label">PM2.5 Forecast</div>
                          <div className="stat-value val-pm25">
                            {currentPoint.pm25 !== null ? currentPoint.pm25.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">µg/m³ · Fine Particulate</div>
                        </div>

                        <div className="stat-card">
                          <div className="stat-label">PM10 Forecast</div>
                          <div className="stat-value val-pm10">
                            {currentPoint.pm10 !== null ? currentPoint.pm10.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">µg/m³ · Coarse Particulate</div>
                        </div>

                        <div className="stat-card" title="Calculated as PM2.5 + (0.5 × PM10). Dimensionless comparison unit.">
                          <div className="stat-label">Relative Score</div>
                          <div className="stat-value val-score">
                            {currentPoint.score !== null ? currentPoint.score.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">Weighted Exposure Index</div>
                        </div>

                        <div className="stat-card">
                          <div className="stat-label">Forecast Hour</div>
                          <div className="stat-time-val">
                            {format(parseISO(currentPoint.time), 'HH:mm')}
                          </div>
                          <div className="stat-unit">{format(parseISO(currentPoint.time), 'MMM dd')} (Local Time)</div>
                        </div>
                      </div>
                    )}

                    {/* Early Warning Panel (Spike radar) */}
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

                    {/* Quick Forecast Teaser Card */}
                    <div className="quick-nav-card" onClick={() => handleTabChange('forecast')}>
                      <div className="quick-nav-content">
                        <div className="quick-nav-icon">
                          <Activity size={20} />
                        </div>
                        <div>
                          <strong>Explore 48-Hour Hourly Trend Chart</strong>
                          <p>View interactive continuous curves, wind speeds, and peak pollution hours.</p>
                        </div>
                      </div>
                      <ArrowRight size={18} className="quick-nav-arrow" />
                    </div>
                  </div>

                  {/* Right Column (Planner & Spatial Teaser) */}
                  <div className="dashboard-col-side">
                    {/* Activity Planner */}
                    <ActivityPlanner
                      onPlan={handlePlanActivity}
                      timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                      isPlanning={isPlanning}
                    />

                    {/* Recommendation Result if computed */}
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

                    {/* Map Teaser Card */}
                    <div className="quick-nav-card map-teaser" onClick={() => handleTabChange('map')}>
                      <div className="quick-nav-content">
                        <div className="quick-nav-icon map">
                          <Map size={20} />
                        </div>
                        <div>
                          <strong>Regional Map & Ground Stations</strong>
                          <p>Inspect spatial pollution gradient and cross-check certified OpenAQ monitors.</p>
                        </div>
                      </div>
                      <ArrowRight size={18} className="quick-nav-arrow" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── TAB 2: 48-HOUR FORECAST ───────────────────────── */}
            {activeTab === 'forecast' && (
              <div className="forecast-tab-layout fade-up">
                {/* 48h Chart */}
                <ForecastChart data={dataPoints} />

                {/* Next 12h Spike Warning */}
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

                {/* Hourly Quick Reference Timeline */}
                <div className="card hourly-timeline-card">
                  <div className="card-title">
                    <Clock size={18} />
                    <span>Next 24-Hour Timeline Highlights</span>
                  </div>
                  <p className="card-subtitle">
                    Quickly scan hourly PM2.5 concentrations to identify when the atmosphere is clearest.
                  </p>

                  <div className="hourly-chips-scroll">
                    {dataPoints.slice(0, 24).map((pt, idx) => {
                      const pm = pt.pm25 ?? 0;
                      const isGood = pm <= 15;
                      const isMid = pm > 15 && pm <= 35;
                      const statusClass = isGood ? 'good' : isMid ? 'mid' : 'poor';
                      return (
                        <div key={idx} className={`hourly-chip ${statusClass}`}>
                          <span className="h-time">{format(parseISO(pt.time), 'HH:mm')}</span>
                          <span className="h-val">{pm.toFixed(0)} <small>µg/m³</small></span>
                          <span className="h-sub">{isGood ? 'Clean' : isMid ? 'Fair' : 'Elevated'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ─── TAB 3: AIR QUALITY MAP ────────────────────────── */}
            {activeTab === 'map' && (
              <div className="map-tab-layout fade-up">
                <AirQualityMap location={location} />
              </div>
            )}

            {/* ─── TAB 4: ACTIVITY PLANNER ───────────────────────── */}
            {activeTab === 'planner' && (
              <div className="planner-tab-layout fade-up">
                <div className="planner-view-grid">
                  <ActivityPlanner
                    onPlan={handlePlanActivity}
                    timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                    isPlanning={isPlanning}
                  />

                  {recommendation ? (
                    <RecommendationPanel
                      result={recommendation}
                      onOpenAlertModal={() => {
                        setAlertModalMode('CREATE');
                        setAlertModalToken('');
                        setIsAlertModalOpen(true);
                      }}
                    />
                  ) : (
                    <div className="card planner-empty-card">
                      <div className="empty-icon-box">
                        <Calendar size={28} />
                      </div>
                      <h3>Ready to Calculate Best Time</h3>
                      <p>
                        Choose your expected duration and preferred time range on the left, then click 
                        <strong>"Find Cleanest Window"</strong> to compute minimum particulate exposure.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── TAB 5: FULL REPORT (2-COLUMN BALANCED) ────────── */}
            {activeTab === 'report' && (
              <div className="full-report-layout fade-up">
                <div className="dashboard-grid">
                  <div className="dashboard-col-main">
                    <CurrentConditionsCard location={location} />

                    {currentPoint && (
                      <div className="stat-grid">
                        <div className="stat-card">
                          <div className="stat-label">PM2.5 Forecast</div>
                          <div className="stat-value val-pm25">
                            {currentPoint.pm25 !== null ? currentPoint.pm25.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">µg/m³</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">PM10 Forecast</div>
                          <div className="stat-value val-pm10">
                            {currentPoint.pm10 !== null ? currentPoint.pm10.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">µg/m³</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Relative Score</div>
                          <div className="stat-value val-score">
                            {currentPoint.score !== null ? currentPoint.score.toFixed(1) : '—'}
                          </div>
                          <div className="stat-unit">Index</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Forecast Hour</div>
                          <div className="stat-time-val">
                            {format(parseISO(currentPoint.time), 'HH:mm')}
                          </div>
                          <div className="stat-unit">{format(parseISO(currentPoint.time), 'MMM dd')}</div>
                        </div>
                      </div>
                    )}

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

                    <AirQualityMap location={location} />
                  </div>

                  <div className="dashboard-col-side">
                    <ForecastChart data={dataPoints} />

                    <ActivityPlanner
                      onPlan={handlePlanActivity}
                      timezone={location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                      isPlanning={isPlanning}
                    />

                    {recommendation && (
                      <RecommendationPanel
                        result={recommendation}
                        onOpenAlertModal={() => {
                          setAlertModalMode('CREATE');
                          setAlertModalToken('');
                          setIsAlertModalOpen(true);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ─── Sleek Modern Footer ─────────────────────────────────── */}
      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-left">
            <div className="footer-brand">
              <Wind size={16} />
              <span>AirWindow</span>
            </div>
            <p className="footer-copy">
              Atmospheric modeling, spatial interpolation & outdoor respiratory protection.
            </p>
          </div>

          <div className="footer-links">
            <button
              type="button"
              className="footer-link-btn"
              onClick={() => {
                setAlertModalMode('CREATE');
                setAlertModalToken('');
                setIsAlertModalOpen(true);
              }}
            >
              Air Alerts Management
            </button>
          </div>
        </div>
      </footer>

      {/* ─── Air Alerts Modal ────────────────────────────────────── */}
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
