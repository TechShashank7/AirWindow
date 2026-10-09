import type { RecommendationResult, DataPoint } from '../utils/recommendation';
import { format, parseISO } from 'date-fns';
import { ShieldCheck, ShieldAlert, Clock3, Info } from 'lucide-react';

interface RecommendationPanelProps {
  result: RecommendationResult;
}

function formatTimeRange(window: DataPoint[]): string {
  if (!window.length) return '';
  const start = parseISO(window[0].time);
  const endPoint = parseISO(window[window.length - 1].time);
  const end = new Date(endPoint.getTime() + 3_600_000);
  return `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')} on ${format(start, 'MMM dd')}`;
}

function getStatus(score: number) {
  if (score <= 35) return { cls: 'good', label: 'Good Quality',     Icon: ShieldCheck };
  if (score <= 70) return { cls: 'mid',  label: 'Moderate Quality', Icon: ShieldAlert };
  return               { cls: 'poor', label: 'Poor Quality',     Icon: ShieldAlert };
}

export function RecommendationPanel({ result }: RecommendationPanelProps) {
  const { cls, label, Icon } = getStatus(result.averageScore);
  
  // Distinguish between a purely good recommendation and just the "least bad" available window
  const headline = result.averageScore > 70 ? 'Best Available Window (Caution)' : 'Recommended Time Window';

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

          <p className="rec-msg">{result.message}</p>
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
    </div>
  );
}
