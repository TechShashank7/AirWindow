import { useMemo } from 'react';
import type { DataPoint } from '../utils/recommendation';
import { AlertTriangle, ShieldCheck, TrendingUp, Bell, Clock, Info } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

interface EarlyWarningPanelProps {
  dataPoints: DataPoint[];
  locationName: string;
  timezone?: string;
  onOpenAlertModal: () => void;
}

export function EarlyWarningPanel({
  dataPoints,
  locationName,
  timezone,
  onOpenAlertModal,
}: EarlyWarningPanelProps) {
  // Analyze next 12 hours of forecast
  const analysis = useMemo(() => {
    if (!dataPoints || dataPoints.length === 0) return null;

    // Use current local date-hour in location's timezone
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentHourLocal = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH");
    const future = dataPoints.filter((d) => d.time.substring(0, 13) >= currentHourLocal);
    const windowPoints = (future.length > 0 ? future : dataPoints).slice(0, 12);

    if (windowPoints.length === 0) return null;

    let peakPm25 = -Infinity;
    let peakPoint = windowPoints[0];
    let minPm25 = Infinity;

    for (const pt of windowPoints) {
      if (pt.pm25 !== null) {
        if (pt.pm25 > peakPm25) {
          peakPm25 = pt.pm25;
          peakPoint = pt;
        }
        if (pt.pm25 < minPm25) {
          minPm25 = pt.pm25;
        }
      }
    }

    if (peakPm25 === -Infinity) return null;

    const firstPt = windowPoints[0];
    const firstPm25 = firstPt.pm25 ?? peakPm25;
    const diff = peakPm25 - firstPm25;

    let trendLabel = 'Stable';
    if (diff > 5) {
      trendLabel = `Rising (+${diff.toFixed(1)} µg/m³) to peak`;
    } else if (diff < -5) {
      trendLabel = `Decreasing from recent peak`;
    }

    // Determine alert status based on health-conscious WHO / EPA thresholds
    const isSpike = peakPm25 >= 35;
    const isModerate = peakPm25 >= 15 && peakPm25 < 35;

    return {
      peakPm25,
      peakTime: peakPoint.time,
      trendLabel,
      isSpike,
      isModerate,
      count: windowPoints.length,
      currentPm25: firstPm25,
    };
  }, [dataPoints]);

  if (!analysis) return null;

  const { peakPm25, peakTime, trendLabel, isSpike, isModerate, currentPm25 } = analysis;

  return (
    <div className={`early-warning-card ${isSpike ? 'spike' : isModerate ? 'advisory' : 'favorable'}`}>
      <div className="ew-top">
        <div className="ew-icon-wrap">
          {isSpike ? (
            <AlertTriangle size={24} className="ew-icon-warn" />
          ) : (
            <ShieldCheck size={24} className="ew-icon-ok" />
          )}
        </div>

        <div className="ew-body">
          <div className="ew-header-row">
            <span className="ew-badge">
              {isSpike ? 'Early Warning Spike' : isModerate ? 'Moderate Forecast' : 'Favorable Conditions'}
            </span>
            <span className="ew-freshness">
              <Clock size={13} />
              Next 12-Hour Outlook
            </span>
          </div>

          <h3 className="ew-headline">
            {isSpike
              ? `Pollution spike expected in ${locationName}`
              : isModerate
              ? `Moderate particle levels forecast in ${locationName}`
              : `Cleaner air window projected for ${locationName}`}
          </h3>

          <p className="ew-desc">
            {isSpike ? (
              <>
                PM2.5 is forecast to peak at <strong>{peakPm25.toFixed(1)} µg/m³</strong> at{' '}
                <strong>{format(parseISO(peakTime), 'HH:mm')}</strong> ({trendLabel}). Consider
                rescheduling intense outdoor cardiovascular activities.
              </>
            ) : isModerate ? (
              <>
                PM2.5 will reach up to <strong>{peakPm25.toFixed(1)} µg/m³</strong> around{' '}
                <strong>{format(parseISO(peakTime), 'HH:mm')}</strong>. Air is acceptable for most, but
                sensitive groups may experience slight irritation.
              </>
            ) : (
              <>
                PM2.5 is projected to remain below <strong>15.0 µg/m³</strong> (WHO 24-hr guideline) over
                the next 12 hours.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="ew-bottom-bar">
        <div className="ew-metrics-mini">
          <div className="ew-mini-stat">
            <span className="mini-stat-label">Current PM2.5</span>
            <span className="mini-stat-val">{currentPm25.toFixed(1)} µg/m³</span>
          </div>
          <div className="ew-mini-stat">
            <span className="mini-stat-label">12h Peak PM2.5</span>
            <span className="mini-stat-val">{peakPm25.toFixed(1)} µg/m³</span>
          </div>
          <div className="ew-mini-stat">
            <span className="mini-stat-label">Trend</span>
            <span className="mini-stat-val">
              <TrendingUp size={13} style={{ display: 'inline', marginRight: 3 }} />
              {trendLabel}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn-ew-alert"
          onClick={onOpenAlertModal}
          title="Configure an automated email notification if PM2.5 spikes"
        >
          <Bell size={15} />
          <span>Set Air Alert for this spike</span>
        </button>
      </div>
    </div>
  );
}
