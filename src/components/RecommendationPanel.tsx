import type { RecommendationResult, DataPoint } from '../utils/recommendation';
import { format, parseISO } from 'date-fns';
import { ShieldCheck, ShieldAlert, Clock3, Info, Wind, Bell, AlertTriangle } from 'lucide-react';

interface RecommendationPanelProps {
  result: RecommendationResult;
  onOpenAlertModal?: () => void;
}

function formatTimeRange(window: DataPoint[]): string {
  if (!window.length) return '';
  const start = parseISO(window[0].time);
  const endPoint = parseISO(window[window.length - 1].time);
  const end = new Date(endPoint.getTime() + 3_600_000);
  return `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')} on ${format(start, 'MMM dd')}`;
}

function getStatus(score: number) {
  if (score <= 35) return { cls: 'good', label: 'Good Quality Window', Icon: ShieldCheck };
  if (score <= 70) return { cls: 'mid', label: 'Moderate Quality Window', Icon: ShieldAlert };
  return { cls: 'poor', label: 'Poor Quality (Least Bad Window)', Icon: ShieldAlert };
}

export function RecommendationPanel({ result, onOpenAlertModal }: RecommendationPanelProps) {
  const { cls, label, Icon } = getStatus(result.averageScore);

  // Distinguish between a genuinely low window and just the "least bad" available window
  const headline =
    result.averageScore > 70 ? 'Best Available Window (Caution)' : 'Recommended Time Window';

  // Compute averages over the recommended window
  const recWindow = result.recommendedWindow;
  const avgPm25 =
    recWindow.reduce((acc, p) => acc + (p.pm25 ?? 0), 0) / (recWindow.length || 1);
  const avgPm10 =
    recWindow.reduce((acc, p) => acc + (p.pm10 ?? 0), 0) / (recWindow.length || 1);
  const avgWind =
    recWindow.reduce((acc, p) => acc + (p.windSpeed ?? 0), 0) / (recWindow.length || 1);

  const getDispersionText = (wind: number) => {
    if (wind >= 12) return 'Stronger breeze aiding atmospheric dispersion';
    if (wind >= 6) return 'Moderate breeze with fair particulate mixing';
    return 'Calm air with limited particulate dispersion';
  };

  return (
    <div className={`rec-panel ${cls}`}>
      <div className="rec-top">
        <div className="rec-icon-wrap">
          <Icon size={28} />
        </div>

        <div className="rec-body">
          <div className="rec-headline">
            <h3>{headline}</h3>
            <span className="rec-badge">{label}</span>
          </div>

          <div className="rec-time">
            <Clock3 size={22} className="rec-time-icon" />
            {formatTimeRange(result.recommendedWindow)}
          </div>

          <div className="rec-score">
            Relative Pollution Score: <strong>{result.averageScore.toFixed(1)}</strong>
          </div>

          {/* Breakdown Stats */}
          <div className="rec-breakdown-row">
            <div className="rec-breakdown-item">
              <span className="rec-b-label">Avg PM2.5:</span>
              <strong className="val-pm25">{avgPm25.toFixed(1)} µg/m³</strong>
            </div>
            <div className="rec-breakdown-item">
              <span className="rec-b-label">Avg PM10:</span>
              <strong className="val-pm10">{avgPm10.toFixed(1)} µg/m³</strong>
            </div>
            <div className="rec-breakdown-item">
              <Wind size={14} style={{ display: 'inline', marginRight: 4 }} />
              <span className="rec-b-label">Avg Wind:</span>
              <strong>{avgWind.toFixed(1)} km/h</strong>
            </div>
          </div>

          <p className="rec-wind-note">
            <em>Wind Conditions:</em> {getDispersionText(avgWind)}.
          </p>

          <p className="rec-msg">{result.message}</p>

          {/* Explicit Medical / Comparative Disclaimer */}
          <div className="rec-caution-box">
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2, color: '#b45309' }} />
            <span className="rec-caution-text">
              <strong>Health Notice:</strong> A lower relative score indicates a comparatively cleaner
              window within your forecast period, but does <em>not</em> guarantee that the air is medically
              safe. If particulate levels remain elevated, sensitive individuals should exercise caution or
              reschedule intense outdoor exertion.
            </span>
          </div>
        </div>
      </div>

      {result.originalWindow && (
        <div className="rec-compare">
          <div>
            <div className="rec-compare-label">Your Preferred Time</div>
            <div className="rec-compare-value">
              {formatTimeRange(result.originalWindow)}
              {result.originalAverageScore !== null && (
                <span style={{ marginLeft: 8, color: '#94a3b8' }}>
                  · Score: {result.originalAverageScore.toFixed(1)}
                </span>
              )}
            </div>
          </div>

          {result.originalAverageScore !== null && (
            <div className="rec-compare-pill">
              <Info size={15} />
              Recommended window is{' '}
              <strong style={{ margin: '0 4px' }}>
                {(result.originalAverageScore - result.averageScore).toFixed(1)} pts
              </strong>{' '}
              cleaner
            </div>
          )}
        </div>
      )}

      {onOpenAlertModal && (
        <div className="rec-footer-action">
          <button
            type="button"
            className="btn-rec-alert-link"
            onClick={onOpenAlertModal}
            title="Set up an automated email alert if pollution exceeds your threshold"
          >
            <Bell size={15} />
            <span>Set Air Alert for this window</span>
          </button>
        </div>
      )}
    </div>
  );
}
