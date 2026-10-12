import { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import type { DataPoint } from '../utils/recommendation';
import { format, parseISO } from 'date-fns';

interface ForecastChartProps {
  data: DataPoint[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 14,
      padding: '14px 16px',
      boxShadow: '0 8px 24px rgba(0,0,0,.12)',
      fontSize: 13,
      minWidth: 180,
    }}>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8, borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
        {d.date} · {label}
      </div>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
          <span style={{ color: '#64748b', flex: 1 }}>{entry.name}</span>
          <strong style={{ color: '#0f172a' }}>
            {entry.value !== null && entry.value !== undefined ? Number(entry.value).toFixed(1) : '—'}
          </strong>
        </div>
      ))}
    </div>
  );
};

export function ForecastChart({ data }: ForecastChartProps) {
  const [timeframe, setTimeframe] = useState<'24h' | '48h'>('48h');
  const [showPm25, setShowPm25] = useState(true);
  const [showPm10, setShowPm10] = useState(true);
  const [showScore, setShowScore] = useState(true);
  const [showWind, setShowWind] = useState(false);

  const displayPoints = useMemo(() => {
    if (timeframe === '24h') {
      return data.slice(0, 24);
    }
    return data;
  }, [data, timeframe]);

  const stats = useMemo(() => {
    const validPm25 = displayPoints.map(p => p.pm25).filter((v): v is number => v !== null);
    if (!validPm25.length) return null;
    const peak = Math.max(...validPm25);
    const min = Math.min(...validPm25);
    const avg = validPm25.reduce((a, b) => a + b, 0) / validPm25.length;
    return { peak, min, avg };
  }, [displayPoints]);

  const chartData = displayPoints.map(d => ({
    ...d,
    pm25: d.pm25 !== null ? Number(d.pm25.toFixed(1)) : null,
    pm10: d.pm10 !== null ? Number(d.pm10.toFixed(1)) : null,
    score: d.score !== null ? Number(d.score.toFixed(1)) : null,
    formattedTime: format(parseISO(d.time), 'HH:mm'),
    date: format(parseISO(d.time), 'MMM dd'),
  }));

  return (
    <div className="card chart-card">
      <div className="chart-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="card-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {timeframe === '24h' ? '24-Hour' : '48-Hour'} Air Quality Forecast
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 2 }}>
              Hourly modeled concentrations and dispersion trends
            </div>
          </div>
        </div>

        {/* Timeframe selector pill */}
        <div className="chart-timeframe-toggle">
          <button
            type="button"
            className={`btn-timeframe ${timeframe === '24h' ? 'active' : ''}`}
            onClick={() => setTimeframe('24h')}
          >
            Next 24h
          </button>
          <button
            type="button"
            className={`btn-timeframe ${timeframe === '48h' ? 'active' : ''}`}
            onClick={() => setTimeframe('48h')}
          >
            Full 48h
          </button>
        </div>
      </div>

      {/* Summary Stat Badges & Layer Toggles */}
      <div className="chart-controls-strip">
        {stats && (
          <div className="chart-summary-chips">
            <span className="summary-chip">
              <small>Peak PM2.5</small>
              <strong>{stats.peak.toFixed(1)} µg/m³</strong>
            </span>
            <span className="summary-chip">
              <small>Lowest PM2.5</small>
              <strong style={{ color: '#10b981' }}>{stats.min.toFixed(1)} µg/m³</strong>
            </span>
            <span className="summary-chip">
              <small>Period Avg</small>
              <strong>{stats.avg.toFixed(1)} µg/m³</strong>
            </span>
          </div>
        )}

        <div className="chart-metric-toggles">
          <button
            type="button"
            className={`btn-toggle-chip pm25 ${showPm25 ? 'on' : ''}`}
            onClick={() => setShowPm25(!showPm25)}
            title="Toggle PM2.5 line"
          >
            <span className="toggle-dot" style={{ background: '#ef4444' }} />
            PM2.5
          </button>
          <button
            type="button"
            className={`btn-toggle-chip pm10 ${showPm10 ? 'on' : ''}`}
            onClick={() => setShowPm10(!showPm10)}
            title="Toggle PM10 line"
          >
            <span className="toggle-dot" style={{ background: '#f59e0b' }} />
            PM10
          </button>
          <button
            type="button"
            className={`btn-toggle-chip score ${showScore ? 'on' : ''}`}
            onClick={() => setShowScore(!showScore)}
            title="Toggle Relative Score line"
          >
            <span className="toggle-dot" style={{ background: '#2563eb' }} />
            Score
          </button>
          <button
            type="button"
            className={`btn-toggle-chip wind ${showWind ? 'on' : ''}`}
            onClick={() => setShowWind(!showWind)}
            title="Toggle Wind speed line"
          >
            <span className="toggle-dot" style={{ background: '#8b5cf6' }} />
            Wind
          </button>
        </div>
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gPm25" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gPm10" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="formattedTime"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickMargin={10}
              minTickGap={40}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              yAxisId="wind"
              orientation="right"
              hide={true}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: '#64748b', paddingTop: 12 }}
            />
            {showPm25 && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pm25"
                name="PM2.5 (µg/m³)"
                stroke="#ef4444"
                strokeWidth={2.5}
                fill="url(#gPm25)"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls={false}
              />
            )}
            {showPm10 && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pm10"
                name="PM10 (µg/m³)"
                stroke="#f59e0b"
                strokeWidth={2.5}
                fill="url(#gPm10)"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls={false}
              />
            )}
            {showScore && (
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="score"
                name="Relative Score"
                stroke="#2563eb"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            )}
            {showWind && (
              <Area
                yAxisId="wind"
                type="monotone"
                dataKey="windSpeed"
                name="Wind Speed (km/h)"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="2 4"
                fill="none"
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
