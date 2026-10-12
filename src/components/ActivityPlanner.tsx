import { useState } from 'react';
import { Clock, Hourglass, CalendarRange, ArrowRight } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

interface ActivityPlannerProps {
  onPlan: (duration: number, start: string, end: string) => void;
  timezone: string;
}

export function ActivityPlanner({ onPlan, timezone }: ActivityPlannerProps) {
  const [duration, setDuration] = useState<number>(60);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Generate 48 hours from the current moment, formatted in the location's timezone
  const nowMs = Date.now();
  const timeOptions = Array.from({ length: 48 }).map((_, i) => {
    // We add i hours to the current time
    const d = new Date(nowMs + i * 3600000);
    // Format to start of the hour in the target timezone to match Open-Meteo's hourly forecast timestamps
    return { 
      value: formatInTimeZone(d, timezone, "yyyy-MM-dd'T'HH:00"), 
      label: formatInTimeZone(d, timezone, "MMM dd, HH:00") 
    };
  });

  const [startTime, setStartTime] = useState(timeOptions[0].value);
  const [endTime, setEndTime] = useState(timeOptions[Math.min(12, timeOptions.length - 1)].value);

  const presets = [
    { id: 'jog', label: '🏃 Jogging', duration: 45, hoursAhead: 6 },
    { id: 'walk', label: '🚶 Walk / Commute', duration: 30, hoursAhead: 4 },
    { id: 'cycle', label: '🚴 Cycling', duration: 60, hoursAhead: 8 },
    { id: 'play', label: '⚽ Outdoor Play', duration: 90, hoursAhead: 12 },
  ];

  const handleApplyPreset = (p: typeof presets[0]) => {
    setActivePreset(p.id);
    setDuration(p.duration);
    if (timeOptions.length > 0) {
      setStartTime(timeOptions[0].value);
      const endIdx = Math.min(p.hoursAhead, timeOptions.length - 1);
      setEndTime(timeOptions[endIdx].value);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onPlan(duration, startTime, endTime);
  };

  return (
    <div className="card planner-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="card-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <Clock size={18} />
          </div>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Plan Your Outdoor Activity</div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 2 }}>
              Find the cleanest window to minimize pollution exposure
            </div>
          </div>
        </div>
      </div>

      {/* Activity Presets */}
      <div className="planner-presets-wrap">
        <span className="preset-label">Quick Presets:</span>
        <div className="planner-presets-chips">
          {presets.map(p => (
            <button
              key={p.id}
              type="button"
              className={`preset-pill ${activePreset === p.id ? 'active' : ''}`}
              onClick={() => handleApplyPreset(p)}
            >
              {p.label} <small>({p.duration}m)</small>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="planner-grid">
          <div className="field">
            <label htmlFor="duration">
              <Hourglass size={14} /> Duration
            </label>
            <select
              id="duration"
              value={duration}
              onChange={e => {
                setDuration(Number(e.target.value));
                setActivePreset(null);
              }}
            >
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
              <option value={120}>2 hours</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="start">
              <CalendarRange size={14} /> Preferred Start
            </label>
            <select
              id="start"
              value={startTime}
              onChange={e => {
                setStartTime(e.target.value);
                setActivePreset(null);
              }}
            >
              {timeOptions.map(o => <option key={`s-${o.value}`} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="end">
              <CalendarRange size={14} /> Preferred End
            </label>
            <select
              id="end"
              value={endTime}
              onChange={e => {
                setEndTime(e.target.value);
                setActivePreset(null);
              }}
            >
              {timeOptions.map(o => <option key={`e-${o.value}`} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="btn-row">
          <button type="submit" className="btn-primary">
            Find Cleanest Window <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
