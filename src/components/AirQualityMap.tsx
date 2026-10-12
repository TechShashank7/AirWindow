import { useState, useEffect, useRef } from 'react';
import type { LocationResult } from '../api/openmeteo';
import { fetchSpatialForecastGrid } from '../api/openmeteo';
import type { GridPoint } from '../utils/mapGrid';
import { getTierForPM25, getTierForScore, getTierForPM10 } from '../utils/mapGrid';
import { loadGoogleMaps, getGoogleMapsApiKey } from '../utils/googleMapsLoader';
import {
  fetchGroundObservations,
  type GroundStation,
  type ObservationsResponse,
  type StationMeasurement,
} from '../api/observationsApi';
import {
  MapPin,
  Info,
  RefreshCw,
  AlertTriangle,
  Compass,
  Radio,
  Layers,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import L from 'leaflet';

interface AirQualityMapProps {
  location: LocationResult;
}

type MetricMode = 'pm25' | 'score' | 'pm10';
type ViewLayer = 'forecast' | 'observations';

export function AirQualityMap({ location }: AirQualityMapProps) {
  // Layer selection: Modelled Forecast vs Ground-Station Observations
  const [viewLayer, setViewLayer] = useState<ViewLayer>('forecast');

  // Forecast grid state
  const [points, setPoints] = useState<GridPoint[]>([]);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string>('center');
  const [metric, setMetric] = useState<MetricMode>('pm25');

  // Ground station observation state
  const [stations, setStations] = useState<GroundStation[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [observationsLoading, setObservationsLoading] = useState(true);
  const [observationsMeta, setObservationsMeta] = useState<ObservationsResponse | null>(null);

  // Read Google Maps API key via centralized helper
  const googleApiKey = getGoogleMapsApiKey();
  const [activeEngine, setActiveEngine] = useState<'google' | 'leaflet'>(googleApiKey ? 'google' : 'leaflet');

  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Leaflet refs
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletMarkersGroupRef = useRef<L.LayerGroup | null>(null);

  // Google Maps refs
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const googleCirclesRef = useRef<google.maps.Circle[]>([]);
  const googleMarkersRef = useRef<google.maps.Marker[]>([]);

  // ─── Fetch 9-point spatial grid ───
  const loadGrid = async () => {
    setForecastLoading(true);
    setForecastError(null);
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
      setForecastError('Unable to load nearby forecast points. Open-Meteo may be experiencing delays.');
    } finally {
      setForecastLoading(false);
    }
  };

  // ─── Fetch genuine ground monitoring observations ───
  const loadObservations = async () => {
    setObservationsLoading(true);
    try {
      const res = await fetchGroundObservations(location.latitude, location.longitude, 25);
      setObservationsMeta(res);
      setStations(res.stations || []);
      if (res.stations && res.stations.length > 0) {
        setSelectedStationId(res.stations[0].stationId);
      } else {
        setSelectedStationId(null);
      }
    } catch (err) {
      console.warn('Failed to load ground observations:', err);
      setStations([]);
      setSelectedStationId(null);
    } finally {
      setObservationsLoading(false);
    }
  };

  useEffect(() => {
    loadGrid();
    loadObservations();
  }, [location.latitude, location.longitude]);

  // Refresh all active data
  const handleRefresh = () => {
    loadGrid();
    loadObservations();
  };

  // Helper to get color and tier for any forecast point based on active metric
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

  // Helper for ground station measurement display
  const getStationValue = (station: GroundStation, pollutant: 'PM2.5' | 'PM10'): StationMeasurement | undefined => {
    return station.measurements.find((m) => m.pollutant === pollutant);
  };

  const getStationDisplayVal = (
    station: GroundStation
  ): { valueStr: string; color: string; pollutant: string; isOutdated: boolean } => {
    const targetPollutant = metric === 'pm10' ? 'PM10' : 'PM2.5';
    const m = getStationValue(station, targetPollutant) || station.measurements[0];
    if (!m || m.value === null) {
      return { valueStr: '—', color: '#94a3b8', pollutant: targetPollutant, isOutdated: true };
    }
    const isOutdated = m.freshness === 'OUTDATED' || m.freshness === 'UNKNOWN';
    if (isOutdated) {
      // Outdated measurements (>48h or unknown) must NEVER receive vibrant green/blue current tier colors
      return {
        valueStr: `${m.value.toFixed(1)}`,
        color: '#64748b', // Muted slate gray for historical/outdated
        pollutant: m.pollutant,
        isOutdated: true,
      };
    }
    const tier = m.pollutant === 'PM2.5' ? getTierForPM25(m.value) : getTierForPM10(m.value);
    return {
      valueStr: `${m.value.toFixed(1)}`,
      color: tier.color,
      pollutant: m.pollutant,
      isOutdated: false,
    };
  };

  // ─── Initialize Map (Google Maps if key provided, else Leaflet fallback) ───
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    // Cleanup previous maps
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      leafletMarkersGroupRef.current = null;
    }
    if (googleMapRef.current) {
      googleCirclesRef.current.forEach((c) => c.setMap(null));
      googleMarkersRef.current.forEach((m) => m.setMap(null));
      googleCirclesRef.current = [];
      googleMarkersRef.current = [];
      googleMapRef.current = null;
    }

    if (googleApiKey) {
      loadGoogleMaps(googleApiKey)
        .then(async (googleObj) => {
          if (isCancelled || !mapContainerRef.current) return;
          try {
            let MapClass = googleObj.maps.Map;
            if (!MapClass && (googleObj.maps as any).importLibrary) {
              const mapsLib = await (googleObj.maps as any).importLibrary('maps');
              MapClass = mapsLib.Map;
            }
            const gMap = new MapClass(mapContainerRef.current, {
              center: { lat: location.latitude, lng: location.longitude },
              zoom: 11,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              zoomControl: true,
              styles: [
                { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
              ],
            });
            googleMapRef.current = gMap;
            setActiveEngine('google');
          } catch (initErr) {
            console.warn('Google Maps initialization failed, falling back to Leaflet:', initErr);
            initLeaflet();
          }
        })
        .catch((err) => {
          if (isCancelled) return;
          console.warn('Google Maps script load failed, using Leaflet fallback:', err);
          initLeaflet();
        });
    } else {
      initLeaflet();
    }

    function initLeaflet() {
      if (isCancelled || !mapContainerRef.current) return;
      try {
        const map = L.map(mapContainerRef.current, {
          center: [location.latitude, location.longitude],
          zoom: 11,
          zoomControl: true,
          scrollWheelZoom: false,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);

        const markersGroup = L.layerGroup().addTo(map);
        leafletMarkersGroupRef.current = markersGroup;
        leafletMapRef.current = map;
        setActiveEngine('leaflet');

        setTimeout(() => {
          if (!isCancelled && leafletMapRef.current) {
            leafletMapRef.current.invalidateSize();
          }
        }, 250);
      } catch (e) {
        console.warn('Leaflet initialization skipped:', e);
      }
    }

    return () => {
      isCancelled = true;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        leafletMarkersGroupRef.current = null;
      }
      if (googleMapRef.current) {
        googleCirclesRef.current.forEach((c) => c.setMap(null));
        googleMarkersRef.current.forEach((m) => m.setMap(null));
        googleCirclesRef.current = [];
        googleMarkersRef.current = [];
        googleMapRef.current = null;
      }
    };
  }, [location.latitude, location.longitude, googleApiKey]);

  // ─── Update Markers / Overlays for Active Layer & Engine ───
  useEffect(() => {
    // 1. Update Google Maps overlays if active
    if (activeEngine === 'google' && googleMapRef.current && (window as any).google?.maps) {
      const gMap = googleMapRef.current;
      const gMaps = (window as any).google.maps;

      // Clear existing
      googleCirclesRef.current.forEach((c) => c.setMap(null));
      googleMarkersRef.current.forEach((m) => m.setMap(null));
      googleCirclesRef.current = [];
      googleMarkersRef.current = [];

      if (viewLayer === 'forecast' && points.length > 0) {
        points.forEach((point) => {
          const isSelected = point.id === selectedPointId;
          const tierInfo = getPointTierInfo(point);
          const displayVal = getMetricDisplay(point);

          const circle = new gMaps.Circle({
            map: gMap,
            center: { lat: point.latitude, lng: point.longitude },
            radius: 1500,
            fillColor: tierInfo.color,
            fillOpacity: isSelected ? 0.6 : 0.35,
            strokeColor: isSelected ? '#0f172a' : tierInfo.color,
            strokeWeight: isSelected ? 2.5 : 1,
          });

          const marker = new gMaps.Marker({
            map: gMap,
            position: { lat: point.latitude, lng: point.longitude },
            label: {
              text: displayVal,
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '11px',
            },
            icon: {
              path: gMaps.SymbolPath.CIRCLE,
              scale: isSelected ? 18 : 14,
              fillColor: tierInfo.color,
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          });

          circle.addListener('click', () => setSelectedPointId(point.id));
          marker.addListener('click', () => setSelectedPointId(point.id));

          googleCirclesRef.current.push(circle);
          googleMarkersRef.current.push(marker);
        });
      } else if (viewLayer === 'observations' && stations.length > 0) {
        stations.forEach((station) => {
          const isSelected = station.stationId === selectedStationId;
          const disp = getStationDisplayVal(station);

          const marker = new gMaps.Marker({
            map: gMap,
            position: { lat: station.coordinates.latitude, lng: station.coordinates.longitude },
            title: `${station.stationName}${disp.isOutdated ? ' (Outdated measurement)' : ''}`,
            label: {
              text: disp.valueStr,
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '11px',
            },
            icon: {
              path: gMaps.SymbolPath.CIRCLE,
              scale: isSelected ? 20 : 15,
              fillColor: disp.color,
              fillOpacity: disp.isOutdated ? 0.75 : 1,
              strokeColor: isSelected ? '#0f172a' : disp.isOutdated ? '#cbd5e1' : '#ffffff',
              strokeWeight: isSelected ? 3 : 2,
            },
          });

          marker.addListener('click', () => setSelectedStationId(station.stationId));
          googleMarkersRef.current.push(marker);
        });
      }
      return;
    }

    // 2. Update Leaflet markers if active
    if (activeEngine === 'leaflet' && leafletMapRef.current && leafletMarkersGroupRef.current) {
      const markersGroup = leafletMarkersGroupRef.current;
      markersGroup.clearLayers();

      if (viewLayer === 'forecast' && points.length > 0) {
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
      } else if (viewLayer === 'observations' && stations.length > 0) {
        stations.forEach((station) => {
          const isSelected = station.stationId === selectedStationId;
          const disp = getStationDisplayVal(station);

          const icon = L.divIcon({
            className: 'aq-station-marker-wrapper',
            html: `
              <div class="aq-station-pin ${isSelected ? 'selected' : ''} ${disp.isOutdated ? 'outdated' : ''}" style="background-color: ${disp.color};" data-station-id="${station.stationId}" title="${station.stationName}${disp.isOutdated ? ' (Outdated measurement)' : ''}">
                <span class="station-pin-symbol">${disp.isOutdated ? '⏱️' : '📡'}</span>
                <span class="station-pin-val">${disp.valueStr}</span>
              </div>
            `,
            iconSize: isSelected ? [46, 46] : [38, 38],
            iconAnchor: isSelected ? [23, 23] : [19, 19],
          });

          const marker = L.marker([station.coordinates.latitude, station.coordinates.longitude], { icon });
          marker.on('click', () => {
            setSelectedStationId(station.stationId);
          });
          marker.addTo(markersGroup);
        });
      }
    }
  }, [points, selectedPointId, stations, selectedStationId, metric, viewLayer, activeEngine]);

  const selectedPoint = points.find((p) => p.id === selectedPointId) || points[0];
  const selectedStation = stations.find((s) => s.stationId === selectedStationId) || stations[0];

  // Calculate comparison with model if station is selected
  const getModelComparison = () => {
    if (!selectedStation || points.length === 0) return null;
    const pm25Measurement = getStationValue(selectedStation, 'PM2.5');
    if (!pm25Measurement || pm25Measurement.value === null) return null;

    // Find nearest grid point to this station
    let closestPt: GridPoint | null = null;
    let minDistance = Infinity;

    for (const pt of points) {
      const dLat = pt.latitude - selectedStation.coordinates.latitude;
      const dLon = pt.longitude - selectedStation.coordinates.longitude;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist < minDistance) {
        minDistance = dist;
        closestPt = pt;
      }
    }

    if (!closestPt || closestPt.pm25 === null) return null;

    const isOutdated = pm25Measurement.freshness === 'OUTDATED' || pm25Measurement.freshness === 'UNKNOWN';
    const diff = isOutdated ? null : pm25Measurement.value - closestPt.pm25;
    return {
      stationPm25: pm25Measurement.value,
      stationAge: pm25Measurement.ageHours,
      stationTime: pm25Measurement.localTimestamp || pm25Measurement.timestamp,
      modelPm25: closestPt.pm25,
      gridLabel: closestPt.label,
      diff,
      diffSign: diff !== null ? (diff > 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`) : '—',
      isOutdated,
    };
  };

  const comparison = viewLayer === 'observations' ? getModelComparison() : null;

  const allStationsOutdated =
    stations.length > 0 &&
    stations.every((s) =>
      s.measurements.every((m) => m.freshness === 'OUTDATED' || m.freshness === 'UNKNOWN')
    );

  return (
    <div className="aq-map-card">
      <div className="aq-map-header">
        <div className="aq-map-title-row">
          <div className="aq-map-icon-box">
            <Compass size={22} />
          </div>
          <div>
            <h3 className="aq-map-title">Local Air-Quality Spatial Explorer</h3>
            <p className="aq-map-sub">
              Explore atmospheric model dispersion alongside physical monitoring observations around {location.name}.
            </p>
          </div>
        </div>

        {/* Layer Selector & Controls */}
        <div className="aq-map-controls">
          {/* Layer Selector: Modelled vs Physical Ground Stations */}
          <div className="aq-layer-toggle-wrap" role="tablist" aria-label="Select data layer">
            <button
              type="button"
              role="tab"
              aria-selected={viewLayer === 'forecast'}
              className={`btn-layer-tab ${viewLayer === 'forecast' ? 'active' : ''}`}
              onClick={() => setViewLayer('forecast')}
            >
              <Layers size={14} />
              <span>Modelled Forecast</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewLayer === 'observations'}
              className={`btn-layer-tab ${viewLayer === 'observations' ? 'active' : ''}`}
              onClick={() => setViewLayer('observations')}
            >
              <Radio size={14} />
              <span>Ground Stations</span>
              <span className="layer-count-badge">{stations.length}</span>
            </button>
          </div>

          {/* Metric Selector Toggle */}
          <div className="aq-metric-toggle" role="group" aria-label="Select metric">
            <button
              type="button"
              className={`btn-metric ${metric === 'pm25' ? 'active' : ''}`}
              onClick={() => setMetric('pm25')}
            >
              PM2.5
            </button>
            {viewLayer === 'forecast' && (
              <button
                type="button"
                className={`btn-metric ${metric === 'score' ? 'active' : ''}`}
                onClick={() => setMetric('score')}
              >
                Relative Score
              </button>
            )}
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
            onClick={handleRefresh}
            disabled={forecastLoading || observationsLoading}
            title="Refresh local forecast grid and station observations"
          >
            <RefreshCw size={15} className={forecastLoading || observationsLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Map view / Loading / Error states */}
      {viewLayer === 'forecast' && forecastError ? (
        <div className="aq-map-error">
          <AlertTriangle size={24} color="#ea580c" />
          <p>{forecastError}</p>
          <button type="button" className="btn-retry" onClick={loadGrid}>
            Retry Grid
          </button>
        </div>
      ) : (
        <div className="aq-map-body">
          <div className="aq-map-canvas-wrap">
            {((viewLayer === 'forecast' && forecastLoading) ||
              (viewLayer === 'observations' && observationsLoading)) && (
              <div className="aq-map-skeleton">
                <div className="loader-ring" />
                <p>
                  {viewLayer === 'forecast'
                    ? `Querying atmospheric model grid for ${location.name}…`
                    : `Querying certified ground observation stations for ${location.name}…`}
                </p>
              </div>
            )}
            <div ref={mapContainerRef} className="aq-map-canvas" data-testid="leaflet-map-container" />

            {/* In-Map Accessible Legend */}
            <div className="aq-map-legend">
              <span className="aq-legend-title">
                {viewLayer === 'forecast'
                  ? `Forecast (${metric === 'pm25' ? 'PM2.5' : metric === 'pm10' ? 'PM10' : 'Score'})`
                  : `Ground Station (${metric === 'pm25' ? 'PM2.5' : 'PM10'})`}
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
                {viewLayer === 'observations' && (
                  <div className="aq-legend-chip">
                    <span className="legend-color-dot" style={{ backgroundColor: '#64748b' }} />
                    <span>Outdated (&gt;48h)</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Layer 1: Forecast Point Details ─── */}
          {viewLayer === 'forecast' && selectedPoint && (
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
            </div>
          )}

          {/* ─── Layer 2: Ground Station Observation Details ─── */}
          {viewLayer === 'observations' && (
            <div className="aq-point-detail">
              {allStationsOutdated && (
                <div className="aq-all-outdated-alert">
                  <AlertTriangle size={18} color="#d97706" />
                  <div>
                    <strong>All Nearby Monitoring Stations Report Outdated Data</strong>
                    <p>
                      All {stations.length} official monitoring stations within 25 km report readings older than 48 hours.
                      Historical observations are preserved below for reference, but consult the <em>Modelled Forecast</em> tab for real-time conditions.
                    </p>
                  </div>
                </div>
              )}

              {stations.length === 0 ? (
                <div className="aq-no-stations">
                  <AlertTriangle size={24} color="#64748b" />
                  <div>
                    <strong>No Certified Ground Stations Nearby</strong>
                    <p>
                      No public ground-monitoring stations were found within 25 km of {location.name} in the OpenAQ registry.
                      Atmospheric conditions can still be tracked using the continuous spatial model in the <em>Modelled Forecast</em> tab.
                    </p>
                  </div>
                </div>
              ) : selectedStation ? (
                <>
                  <div className="aq-point-header">
                    <div className="aq-point-title-wrap">
                      <Radio size={18} color="#059669" />
                      <strong>{selectedStation.stationName}</strong>
                    </div>
                    <span className="aq-coords">
                      {selectedStation.coordinates.latitude.toFixed(4)}° N, {selectedStation.coordinates.longitude.toFixed(4)}° E
                    </span>
                  </div>

                  <div className="aq-station-meta-row">
                    <span className="aq-meta-pill">~{selectedStation.distanceKm.toFixed(1)} km from search center</span>
                    <span className="aq-meta-pill">Source: {selectedStation.provider || 'OpenAQ'}</span>
                    <span className="aq-meta-pill">Timezone: {selectedStation.timezone || 'UTC'}</span>
                  </div>

                  {selectedStation.measurements.some((m) => m.freshness === 'OUTDATED' || m.freshness === 'UNKNOWN') && (
                    <div className="aq-station-outdated-note">
                      <Clock size={15} />
                      <span>
                        Historical Data Notice: This station last reported {selectedStation.measurements[0]?.ageHours ? `${selectedStation.measurements[0].ageHours}h ago` : 'in the past'}. It does not reflect current real-time air quality.
                      </span>
                    </div>
                  )}

                  <div className="aq-point-grid">
                    {/* PM2.5 Observation */}
                    {(() => {
                      const m = getStationValue(selectedStation, 'PM2.5');
                      return (
                        <div className="aq-detail-stat">
                          <div className="aq-stat-header">
                            <span className="aq-stat-label">PM2.5</span>
                            {m && (
                              <span className={`freshness-badge ${m.freshness.toLowerCase()}`}>
                                {m.freshnessLabel}
                              </span>
                            )}
                          </div>
                          <span className="aq-stat-num val-pm25">
                            {m && m.value !== null ? m.value.toFixed(1) : '—'}
                          </span>
                          <span className="aq-stat-unit">{m ? m.unit : 'µg/m³'}</span>
                          {m && (
                            <span className="aq-stat-time">
                              {m.localTimestamp ? `At ${m.localTimestamp.replace('T', ' ')}` : 'Time N/A'}
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* PM10 Observation */}
                    {(() => {
                      const m = getStationValue(selectedStation, 'PM10');
                      return (
                        <div className="aq-detail-stat">
                          <div className="aq-stat-header">
                            <span className="aq-stat-label">PM10</span>
                            {m && (
                              <span className={`freshness-badge ${m.freshness.toLowerCase()}`}>
                                {m.freshnessLabel}
                              </span>
                            )}
                          </div>
                          <span className="aq-stat-num val-pm10">
                            {m && m.value !== null ? m.value.toFixed(1) : '—'}
                          </span>
                          <span className="aq-stat-unit">{m ? m.unit : 'µg/m³'}</span>
                          {m && (
                            <span className="aq-stat-time">
                              {m.localTimestamp ? `At ${m.localTimestamp.replace('T', ' ')}` : 'Time N/A'}
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    <div className="aq-detail-stat">
                      <span className="aq-stat-label">Station Type</span>
                      <span className="aq-stat-num" style={{ fontSize: '0.95rem' }}>
                        Ground Sensor
                      </span>
                      <span className="aq-stat-unit">In-situ monitor</span>
                    </div>

                    <div className="aq-detail-stat">
                      <span className="aq-stat-label">Distance</span>
                      <span className="aq-stat-num" style={{ fontSize: '1.1rem' }}>
                        {selectedStation.distanceKm.toFixed(1)} km
                      </span>
                      <span className="aq-stat-unit">Haversine radius</span>
                    </div>
                  </div>

                  {/* Model vs Ground Station Comparison & Disclosure */}
                  {comparison && (
                    <div className={`aq-model-comparison ${comparison.isOutdated ? 'outdated-comparison' : ''}`}>
                      <div className="comparison-header">
                        <Clock size={15} color={comparison.isOutdated ? '#64748b' : '#2563eb'} />
                        <span>
                          {comparison.isOutdated
                            ? `Model Grid vs Historical Station (${comparison.gridLabel})`
                            : `Observation vs Nearby Model Grid (${comparison.gridLabel})`}
                        </span>
                      </div>
                      <div className="comparison-row">
                        <span>Physical Station Measurement (PM2.5):</span>
                        <strong>{comparison.stationPm25.toFixed(1)} µg/m³</strong>
                      </div>
                      <div className="comparison-row">
                        <span>Atmospheric Model Grid (PM2.5):</span>
                        <strong>{comparison.modelPm25.toFixed(1)} µg/m³</strong>
                      </div>
                      <div className="comparison-row diff">
                        <span>Spatial Discrepancy (Δ):</span>
                        {comparison.isOutdated ? (
                          <strong className="text-muted">Direct Comparison Disabled</strong>
                        ) : (
                          <strong className={comparison.diff !== null && comparison.diff > 0 ? 'text-elevated' : 'text-good'}>
                            {comparison.diffSign} µg/m³
                          </strong>
                        )}
                      </div>
                      <p className="comparison-disclaimer">
                        {comparison.isOutdated
                          ? `Direct numerical comparison disabled: Physical ground measurement is ${comparison.stationAge ? `${comparison.stationAge}h old` : 'outdated'} and does not represent current ambient air. Numerical models reflect real-time atmospheric estimates.`
                          : 'Informational comparison only. Ground monitoring points reflect localized micro-climates, sensor elevation, and immediate traffic corridors, whereas atmospheric models represent regional grid-cell averages (~10–25 km²). Differences do not constitute formal model validation.'}
                      </p>
                    </div>
                  )}

                  {/* Physical Observation Data Integrity Callout */}
                  <div className="aq-integrity-callout observation-callout">
                    <div className="aq-integrity-badge">
                      <CheckCircle2 size={14} />
                      <span>Physical Ground Monitor</span>
                    </div>
                    <p className="aq-integrity-text">
                      Measurements are sourced from public ground equipment via OpenAQ. Native timestamps and reported units are preserved without synthetic spatial smoothing.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Accessible Quick-Select Grid / Station Pills */}
          {viewLayer === 'forecast' && (
            <div className="aq-grid-selector">
              <span className="aq-grid-label">Select nearby forecast grid cell:</span>
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
          )}

          {viewLayer === 'observations' && stations.length > 0 && (
            <div className="aq-grid-selector">
              <span className="aq-grid-label">Select physical monitoring station:</span>
              <div className="aq-grid-pills">
                {stations.map((st) => {
                  const disp = getStationDisplayVal(st);
                  const isSelected = st.stationId === selectedStationId;
                  return (
                    <button
                      key={st.stationId}
                      type="button"
                      className={`btn-grid-cell ${isSelected ? 'selected' : ''}`}
                      style={{ borderColor: isSelected ? disp.color : undefined }}
                      onClick={() => setSelectedStationId(st.stationId)}
                    >
                      <span className="cell-dot" style={{ backgroundColor: disp.color }} />
                      <span className="cell-label">{st.stationName}</span>
                      <span className="cell-val">
                        ~{st.distanceKm.toFixed(1)} km ({disp.valueStr} µg/m³){disp.isOutdated ? ' • Outdated' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
