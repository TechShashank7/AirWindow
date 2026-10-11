import { useState, useEffect, useRef } from 'react';
import type { LocationResult } from '../api/openmeteo';
import { fetchSpatialForecastGrid } from '../api/openmeteo';
import type { GridPoint } from '../utils/mapGrid';
import { getTierForPM25, getTierForScore, getTierForPM10 } from '../utils/mapGrid';
import { MapPin, Info, RefreshCw, AlertTriangle, Wind, Compass } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import L from 'leaflet';

interface AirQualityMapProps {
  location: LocationResult;
}

type MetricMode = 'pm25' | 'score' | 'pm10';

export function AirQualityMap({ location }: AirQualityMapProps) {
  const [points, setPoints] = useState<GridPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string>('center');
  const [metric, setMetric] = useState<MetricMode>('pm25');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);

  // Fetch 9-point spatial grid on location change
  const loadGrid = async () => {
    setLoading(true);
    setError(null);
    try {
      const tz = location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const currentLocalTime = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH:mm");
      const grid = await fetchSpatialForecastGrid(
        location.latitude,
        location.longitude,
        tz,
        currentLocalTime
      );
      setPoints(grid);
      setSelectedPointId('center');
    } catch (err) {
      console.error('Failed to load spatial air quality grid:', err);
      setError('Unable to load nearby forecast points. Open-Meteo may be experiencing delays.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGrid();
  }, [location.latitude, location.longitude]);

  // Helper to get color and tier for any point based on active metric
  const getPointTierInfo = (point: GridPoint) => {
    if (metric === 'pm25') return getTierForPM25(point.pm25);
    if (metric === 'score') return getTierForScore(point.score);
    return getTierForPM10(point.pm10);
  };

  const getMetricDisplay = (point: GridPoint) => {
    if (metric === 'pm25') return point.pm25 !== null ? `${point.pm25.toFixed(1)}` : '—';
    if (metric === 'score') return point.score !== null ? `${point.score.toFixed(1)}` : '—';
    return point.pm10 !== null ? `${point.pm10.toFixed(1)}` : '—';
  };

  const getMetricUnit = () => {
    if (metric === 'pm25') return 'µg/m³';
    if (metric === 'score') return 'pts';
    return 'µg/m³';
  };

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    try {
      const map = L.map(mapContainerRef.current, {
        center: [location.latitude, location.longitude],
        zoom: 11,
        zoomControl: true,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersGroupRef.current = markersGroup;
      mapInstanceRef.current = map;

      // Invalidate size after layout settles
      const timer = setTimeout(() => {
        map.invalidateSize();
      }, 250);

      return () => {
        clearTimeout(timer);
        map.remove();
        mapInstanceRef.current = null;
        markersGroupRef.current = null;
      };
    } catch (e) {
      console.warn('Map initialization skipped (e.g. during headless test):', e);
    }
  }, [location.latitude, location.longitude]);

  // Update map markers whenever points, selected point, or metric changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup || points.length === 0) return;

    markersGroup.clearLayers();

    points.forEach((point) => {
      const isSelected = point.id === selectedPointId;
      const tierInfo = getPointTierInfo(point);
      const displayVal = getMetricDisplay(point);

      const icon = L.divIcon({
        className: 'aq-custom-marker-wrapper',
        html: `
          <div class="aq-marker-badge ${isSelected ? 'active-pin' : ''}" style="background-color: ${tierInfo.color};" data-point-id="${point.id}">
            <span class="aq-marker-value">${displayVal}</span>
          </div>
        `,
        iconSize: isSelected ? [42, 42] : [34, 34],
        iconAnchor: isSelected ? [21, 21] : [17, 17],
      });

      const marker = L.marker([point.latitude, point.longitude], { icon });
      marker.on('click', () => {
        setSelectedPointId(point.id);
      });

      marker.addTo(markersGroup);
    });
  }, [points, selectedPointId, metric]);

  const selectedPoint = points.find((p) => p.id === selectedPointId) || points[0];

  return (
    <div className="aq-map-card">
      <div className="aq-map-header">
        <div className="aq-map-title-row">
          <div className="aq-map-icon-box">
            <Compass size={22} />
          </div>
          <div>
            <h3 className="aq-map-title">Local Air-Quality Forecast Map</h3>
            <p className="aq-map-sub">
              Spatial atmospheric dispersion points within ~20 km of {location.name}.
            </p>
          </div>
        </div>

        {/* Metric Selector Toggle */}
        <div className="aq-map-controls">
          <div className="aq-metric-toggle" role="group" aria-label="Select metric">
            <button
              type="button"
              className={`btn-metric ${metric === 'pm25' ? 'active' : ''}`}
              onClick={() => setMetric('pm25')}
            >
              PM2.5
            </button>
            <button
              type="button"
              className={`btn-metric ${metric === 'score' ? 'active' : ''}`}
              onClick={() => setMetric('score')}
            >
              Relative Score
            </button>
            <button
              type="button"
              className={`btn-metric ${metric === 'pm10' ? 'active' : ''}`}
              onClick={() => setMetric('pm10')}
            >
              PM10
            </button>
          </div>

          <button
            type="button"
            className="btn-map-refresh"
            onClick={loadGrid}
            disabled={loading}
            title="Refresh local forecast grid"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Map view / Loading / Error states */}
      {error ? (
        <div className="aq-map-error">
          <AlertTriangle size={24} color="#ea580c" />
          <p>{error}</p>
          <button type="button" className="btn-retry" onClick={loadGrid}>
            Retry Grid
          </button>
        </div>
      ) : (
        <div className="aq-map-body">
          <div className="aq-map-canvas-wrap">
            {loading && (
              <div className="aq-map-skeleton">
                <div className="loader-ring" />
                <p>Querying atmospheric model grid for {location.name}…</p>
              </div>
            )}
            <div ref={mapContainerRef} className="aq-map-canvas" data-testid="leaflet-map-container" />

            {/* In-Map Accessible Legend */}
            <div className="aq-map-legend">
              <span className="aq-legend-title">
                Legend ({metric === 'pm25' ? 'PM2.5' : metric === 'pm10' ? 'PM10' : 'Score'})
              </span>
              <div className="aq-legend-chips">
                <div className="aq-legend-chip">
                  <span className="legend-color-dot" style={{ backgroundColor: '#0284c7' }} />
                  <span>Low</span>
                </div>
                <div className="aq-legend-chip">
                  <span className="legend-color-dot" style={{ backgroundColor: '#d97706' }} />
                  <span>Moderate</span>
                </div>
                <div className="aq-legend-chip">
                  <span className="legend-color-dot" style={{ backgroundColor: '#ea580c' }} />
                  <span>Elevated</span>
                </div>
                <div className="aq-legend-chip">
                  <span className="legend-color-dot" style={{ backgroundColor: '#9333ea' }} />
                  <span>High</span>
                </div>
              </div>
            </div>
          </div>

          {/* Point Inspector & Details Card */}
          {selectedPoint && (
            <div className="aq-point-detail">
              <div className="aq-point-header">
                <div className="aq-point-title-wrap">
                  <MapPin size={18} color="#2563eb" />
                  <strong>
                    {selectedPoint.label} ({selectedPoint.offsetName})
                  </strong>
                </div>
                <span className="aq-coords">
                  {selectedPoint.latitude.toFixed(4)}° N, {selectedPoint.longitude.toFixed(4)}° E
                </span>
              </div>

              <div className="aq-point-grid">
                <div className="aq-detail-stat">
                  <span className="aq-stat-label">PM2.5</span>
                  <span className="aq-stat-num val-pm25">
                    {selectedPoint.pm25 !== null ? selectedPoint.pm25.toFixed(1) : '—'}
                  </span>
                  <span className="aq-stat-unit">µg/m³</span>
                </div>

                <div className="aq-detail-stat">
                  <span className="aq-stat-label">PM10</span>
                  <span className="aq-stat-num val-pm10">
                    {selectedPoint.pm10 !== null ? selectedPoint.pm10.toFixed(1) : '—'}
                  </span>
                  <span className="aq-stat-unit">µg/m³</span>
                </div>

                <div className="aq-detail-stat">
                  <span className="aq-stat-label">Relative Score</span>
                  <span className="aq-stat-num val-score">
                    {selectedPoint.score !== null ? selectedPoint.score.toFixed(1) : '—'}
                  </span>
                  <span className="aq-stat-unit">pts</span>
                </div>

                <div className="aq-detail-stat">
                  <span className="aq-stat-label">Wind</span>
                  <span className="aq-stat-num">
                    {selectedPoint.windSpeed !== null ? `${selectedPoint.windSpeed} km/h` : '—'}
                  </span>
                  <span className="aq-stat-unit">
                    {selectedPoint.windDir !== null ? `${selectedPoint.windDir}°` : '10m AGL'}
                  </span>
                </div>
              </div>

              {/* Data Integrity Callout */}
              <div className="aq-integrity-callout">
                <div className="aq-integrity-badge">
                  <Info size={14} />
                  <span>Modelled Forecast</span>
                </div>
                <p className="aq-integrity-text">
                  Values are computed by Open-Meteo numerical atmospheric models for this grid coordinate.
                  Ground station monitoring is currently not available for this point. Do not treat as certified physical measurements.
                </p>
              </div>
            </div>
          )}

          {/* Accessible Quick-Select Grid for Mobile / Non-touch / Keyboard */}
          <div className="aq-grid-selector">
            <span className="aq-grid-label">Select nearby grid cell:</span>
            <div className="aq-grid-pills">
              {points.map((pt) => {
                const info = getPointTierInfo(pt);
                const isSelected = pt.id === selectedPointId;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    className={`btn-grid-cell ${isSelected ? 'selected' : ''}`}
                    style={{ borderColor: isSelected ? info.color : undefined }}
                    onClick={() => setSelectedPointId(pt.id)}
                  >
                    <span className="cell-dot" style={{ backgroundColor: info.color }} />
                    <span className="cell-label">{pt.label}</span>
                    <span className="cell-val">
                      {getMetricDisplay(pt)} {getMetricUnit()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Map Tile & Attribution Footer */}
      <div className="aq-map-footer">
        <span>Map tiles &copy; CARTO &copy; OpenStreetMap contributors</span>
        <span>Atmospheric modelling &copy; Open-Meteo</span>
      </div>
    </div>
  );
}
