import { useEffect, useState } from 'react';
import type { LocationResult } from '../api/openmeteo';
import { fetchCurrentAirQuality } from '../api/currentAqiApi';
import type { GoogleCurrentConditionsResponse } from '../api/currentAqiApi';
import { ShieldCheck, AlertCircle, Info, Activity, Clock, Sparkles } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface CurrentConditionsCardProps {
  location: LocationResult;
}

function getCpcbColor(aqi: number | null, category?: string): { bg: string; text: string; border: string } {
  if (aqi === null) {
    return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
  }
  const cat = (category || '').toLowerCase();
  if (aqi <= 50 || cat.includes('good')) {
    return { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' };
  }
  if (aqi <= 100 || cat.includes('satisfactory')) {
    return { bg: '#f7fee7', text: '#65a30d', border: '#d9f99d' };
  }
  if (aqi <= 200 || cat.includes('moderate')) {
    return { bg: '#fefce8', text: '#ca8a04', border: '#fef08a' };
  }
  if (aqi <= 300 || cat.includes('poor')) {
    return { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' };
  }
  if (aqi <= 400 || cat.includes('very poor')) {
    return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };
  }
  return { bg: '#450a0a', text: '#ffffff', border: '#7f1d1d' };
}

export function CurrentConditionsCard({ location }: CurrentConditionsCardProps) {
  const [data, setData] = useState<GoogleCurrentConditionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchCurrentAirQuality(location.latitude, location.longitude);
        if (isMounted) {
          setData(res);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Unable to load current conditions');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [location.latitude, location.longitude]);

  if (loading) {
    return (
      <div className="current-aqi-card loading">
        <div className="current-aqi-header">
          <div className="current-aqi-title-wrap">
            <Activity className="icon-spin text-blue" size={18} />
            <h4>Loading Hyperlocal Current Conditions…</h4>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data || !data.configured) {
    return (
      <div className="current-aqi-card unconfigured">
        <div className="current-aqi-header">
          <div className="current-aqi-title-wrap">
            <Info size={18} className="text-muted-icon" />
            <h4>Current Conditions & National AQI</h4>
          </div>
        </div>
        <p className="current-aqi-unavailable-note">
          Current atmospheric conditions and National AQI are currently unavailable for this location.
          48-hour forecasts and regional air quality maps remain fully active below.
        </p>
      </div>
    );
  }

  const indiaAqi = data.indiaAqi;
  const universalAqi = data.universalAqi;
  const cpcbColors = getCpcbColor(indiaAqi?.aqi ?? null, indiaAqi?.category);

  // Format measurement timestamp safely
  let formattedTime = 'Recent';
  if (data.measurementTimestamp) {
    try {
      formattedTime = format(parseISO(data.measurementTimestamp), 'HH:mm (MMM dd)');
    } catch {
      formattedTime = data.measurementTimestamp;
    }
  }

  return (
    <div className="current-aqi-card">
      <div className="current-aqi-header">
        <div className="current-aqi-title-wrap">
          <Sparkles size={18} className="text-amber" />
          <h4>Current Conditions & National AQI</h4>
        </div>
        {data.cached && (
          <div className="current-aqi-badges">
            <span className="cache-chip">Cached</span>
          </div>
        )}
      </div>

      <div className="current-aqi-body">
        {/* Main AQI Badge (Indian National AQI prioritised if available) */}
        {indiaAqi && (
          <div
            className="india-aqi-banner"
            style={{
              backgroundColor: cpcbColors.bg,
              borderColor: cpcbColors.border,
            }}
          >
            <div className="india-aqi-left">
              <span className="india-aqi-label">National AQI (India / CPCB)</span>
              <div className="india-aqi-val-row">
                <span className="india-aqi-score" style={{ color: cpcbColors.text }}>
                  {indiaAqi.aqi !== null ? indiaAqi.aqi : '—'}
                </span>
                <span className="india-aqi-category" style={{ color: cpcbColors.text }}>
                  {indiaAqi.category}
                </span>
              </div>
            </div>
            {indiaAqi.dominantPollutant && (
              <div className="india-aqi-dominant">
                <span>Dominant pollutant:</span>
                <strong>{indiaAqi.dominantPollutant.toUpperCase()}</strong>
              </div>
            )}
          </div>
        )}

        {/* Secondary / Universal AQI chip if present */}
        {universalAqi && (
          <div className="universal-aqi-strip">
            <span className="universal-aqi-label">Universal AQI (UAQI):</span>
            <strong>
              {universalAqi.aqi !== null ? universalAqi.aqi : '—'} / 100
            </strong>
            <span className="universal-aqi-cat">({universalAqi.category})</span>
          </div>
        )}

        {/* Pollutants concentration grid */}
        {data.pollutants && data.pollutants.length > 0 && (
          <div className="current-pollutants-section">
            <span className="pollutants-section-title">Current Pollutant Concentrations:</span>
            <div className="current-pollutants-grid">
              {data.pollutants.map((p) => (
                <div key={p.code} className="pollutant-chip">
                  <span className="p-code">{p.displayName || p.code.toUpperCase()}</span>
                  <span className="p-val">
                    {p.value} <small>{p.units}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Health Advisory */}
        {data.healthRecommendations?.generalPopulation && (
          <div className="current-health-advisory">
            <div className="advisory-icon">
              <ShieldCheck size={18} className="text-emerald" />
            </div>
            <div className="advisory-text">
              <strong>Health Guidance:</strong>
              <p>{data.healthRecommendations.generalPopulation}</p>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="current-aqi-footer">
          <div className="time-info">
            <Clock size={13} />
            <span>
              Observation estimated for <strong>{formattedTime}</strong>
              {data.ageHours !== null ? ` (~${data.ageHours}h ago)` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
