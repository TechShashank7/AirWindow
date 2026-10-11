import React, { useState, useEffect } from 'react';
import { 
  Bell, X, CheckCircle2, AlertTriangle, Loader2, MapPin, 
  Search, ShieldAlert, PauseCircle, PlayCircle, Trash2, ArrowRight
} from 'lucide-react';
import type { LocationResult } from '../api/openmeteo';
import { searchLocations } from '../api/openmeteo';
import { createAlert, verifyAlert, manageAlert } from '../api/alertsApi';
import type { AlertDetails } from '../api/alertsApi';

export type AlertModalMode = 'CREATE' | 'VERIFY' | 'MANAGE';

interface AirAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: AlertModalMode;
  initialToken?: string;
  currentLocation?: LocationResult | null;
}

const PM25_PRESETS = [
  { label: '15 µg/m³ (WHO Daily)', value: 15 },
  { label: '25 µg/m³ (Moderate)', value: 25 },
  { label: '50 µg/m³ (Sensitive)', value: 50 },
  { label: '75 µg/m³ (Poor)', value: 75 },
];

const SCORE_PRESETS = [
  { label: '50 (Fair Window)', value: 50 },
  { label: '100 (Moderate)', value: 100 },
  { label: '150 (High Pollution)', value: 150 },
];

export function AirAlertsModal({
  isOpen,
  onClose,
  initialMode = 'CREATE',
  initialToken = '',
  currentLocation,
}: AirAlertsModalProps) {
  const [mode, setMode] = useState<AlertModalMode>(initialMode);
  
  // Creation form state
  const [email, setEmail] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(currentLocation || null);
  const [locQuery, setLocQuery] = useState('');
  const [locResults, setLocResults] = useState<LocationResult[]>([]);
  const [locSearching, setLocSearching] = useState(false);
  const [showLocPicker, setShowLocPicker] = useState(!currentLocation);
  
  const [thresholdType, setThresholdType] = useState<'PM25' | 'SCORE'>('PM25');
  const [thresholdValue, setThresholdValue] = useState<number>(25);
  
  // Async states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  
  // Verification state
  const [verifyStatus, setVerifyStatus] = useState<'IDLE' | 'VERIFYING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  // Management state
  const [manageDetails, setManageDetails] = useState<AlertDetails | null>(null);
  const [manageSuccessMsg, setManageSuccessMsg] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);

  // Reset or switch mode when initial props change
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setCreateSuccess(false);

      if (initialMode === 'CREATE') {
        setSelectedLocation(currentLocation || null);
        setShowLocPicker(!currentLocation);
      } else if (initialMode === 'VERIFY' && initialToken) {
        handleRunVerify(initialToken);
      } else if (initialMode === 'MANAGE' && initialToken) {
        handleRunManageList(initialToken);
      }
    }
  }, [isOpen, initialMode, initialToken, currentLocation]);

  // Handle location search debouncing
  useEffect(() => {
    if (locQuery.trim().length > 2) {
      const timer = setTimeout(async () => {
        setLocSearching(true);
        try {
          const res = await searchLocations(locQuery);
          setLocResults(res);
        } catch {
          setLocResults([]);
        } finally {
          setLocSearching(false);
        }
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setLocResults([]);
    }
  }, [locQuery]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  /* ─────────────────────────────────────────────────────────────
     Verification Action
     ───────────────────────────────────────────────────────────── */
  async function handleRunVerify(tokenToVerify: string) {
    setVerifyStatus('VERIFYING');
    setError(null);
    try {
      const res = await verifyAlert(tokenToVerify);
      setVerifyStatus('SUCCESS');
      setVerifyMessage(res.message || 'Alert verified and activated.');
    } catch (err: any) {
      setVerifyStatus('ERROR');
      setError(err.message || 'Verification failed. The token may be expired or already used.');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Management Actions
     ───────────────────────────────────────────────────────────── */
  async function handleRunManageList(token: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await manageAlert(token, 'LIST');
      if (res.alertId && res.status && res.threshold && res.lat !== undefined && res.lon !== undefined) {
        setManageDetails({
          alertId: res.alertId,
          status: res.status,
          threshold: res.threshold,
          lat: res.lat,
          lon: res.lon
        });
      }
    } catch (err: any) {
      setError(err.message || 'Could not load alert details. Token may be expired.');
    } finally {
      setLoading(false);
    }
  }

  async function handleManageStatusChange(action: 'PAUSE' | 'RESUME') {
    if (!initialToken) return;
    setLoading(true);
    setError(null);
    setManageSuccessMsg(null);
    try {
      const res = await manageAlert(initialToken, action);
      setManageSuccessMsg(res.message || `Alert updated.`);
      setManageDetails(prev => prev ? { ...prev, status: action === 'PAUSE' ? 'PAUSED' : 'ACTIVE' } : null);
    } catch (err: any) {
      setError(err.message || 'Failed to update alert status.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAlert() {
    if (!initialToken) return;
    if (!window.confirm('Are you sure you want to permanently delete this alert? You will no longer receive notifications.')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await manageAlert(initialToken, 'DELETE');
      setIsDeleted(true);
      setManageSuccessMsg(res.message || 'Alert successfully deleted.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete alert.');
    } finally {
      setLoading(false);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Creation Submit
     ───────────────────────────────────────────────────────────── */
  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedLocation) {
      setError('Please choose a location for your alert.');
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!thresholdValue || thresholdValue <= 0) {
      setError('Threshold value must be greater than zero.');
      return;
    }

    setLoading(true);
    try {
      await createAlert({
        email: email.trim(),
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        timezone: selectedLocation.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        thresholdType,
        thresholdValue: Number(thresholdValue),
      });
      setCreateSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to create alert. Please check your inputs.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-title">
            <div className="modal-icon-badge">
              <Bell size={20} />
            </div>
            <div>
              <h3>
                {mode === 'CREATE' && 'Personalized Air Alerts'}
                {mode === 'VERIFY' && 'Email Verification'}
                {mode === 'MANAGE' && 'Manage Your Air Alert'}
              </h3>
              <p className="modal-subtitle">
                {mode === 'CREATE' && 'Get notified when air quality is forecast to exceed your threshold.'}
                {mode === 'VERIFY' && 'Activate your personalized alert subscription.'}
                {mode === 'MANAGE' && 'Pause, resume, or unsubscribe from this alert.'}
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="modal-alert-box error" role="alert">
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Action Failed</strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* ── MODE 1: CREATE ALERT ────────────────────────────── */}
        {mode === 'CREATE' && (
          <>
            {createSuccess ? (
              <div className="modal-success-state">
                <div className="modal-success-icon">
                  <CheckCircle2 size={44} color="#16a34a" />
                </div>
                <h4>Verification Email Sent!</h4>
                <p>
                  We have sent an activation link to <strong>{email}</strong>. 
                  Please click the link in your email within 24 hours to activate this alert.
                </p>
                <div className="modal-actions-right">
                  <button 
                    type="button" 
                    className="btn-primary" 
                    onClick={() => {
                      setCreateSuccess(false);
                      setEmail('');
                      onClose();
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSubmit} className="modal-form">
                
                {/* Location Selection */}
                <div className="form-group">
                  <label className="form-label">
                    <MapPin size={16} /> Location
                  </label>
                  
                  {selectedLocation && !showLocPicker ? (
                    <div className="selected-loc-card">
                      <div>
                        <strong>{selectedLocation.name}</strong>
                        {selectedLocation.admin1 && `, ${selectedLocation.admin1}`}
                        <div className="loc-meta">
                          {selectedLocation.country} • {selectedLocation.timezone}
                        </div>
                      </div>
                      <button 
                        type="button" 
                        className="btn-text-link"
                        onClick={() => setShowLocPicker(true)}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="loc-picker-wrap">
                      <div className="input-with-icon">
                        <Search size={16} className="input-icon" />
                        <input
                          type="text"
                          className="text-input"
                          placeholder="Search for a city (e.g. Delhi, London)..."
                          value={locQuery}
                          onChange={e => setLocQuery(e.target.value)}
                          autoFocus={showLocPicker}
                        />
                        {locSearching && <Loader2 size={16} className="spin input-spinner" />}
                      </div>

                      {locResults.length > 0 && (
                        <ul className="loc-results-list">
                          {locResults.map(loc => (
                            <li 
                              key={`${loc.id}-${loc.latitude}-${loc.longitude}`}
                              onClick={() => {
                                setSelectedLocation(loc);
                                setShowLocPicker(false);
                                setLocQuery('');
                                setLocResults([]);
                              }}
                            >
                              <MapPin size={14} className="pin-icon" />
                              <div>
                                <span className="loc-name">{loc.name}</span>
                                <span className="loc-sub">
                                  {loc.admin1 ? `${loc.admin1}, ` : ''}{loc.country}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                {/* Email Address */}
                <div className="form-group">
                  <label htmlFor="alert-email" className="form-label">
                    Email Address
                  </label>
                  <input
                    id="alert-email"
                    type="email"
                    className="text-input"
                    placeholder="name@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  <span className="field-hint">
                    Maximum 3 active alerts per email address. Verification required.
                  </span>
                </div>

                {/* Threshold Metric */}
                <div className="form-group">
                  <label className="form-label">Threshold Metric</label>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={`segment-btn ${thresholdType === 'PM25' ? 'active' : ''}`}
                      onClick={() => {
                        setThresholdType('PM25');
                        setThresholdValue(25);
                      }}
                    >
                      PM2.5 Concentration (µg/m³)
                    </button>
                    <button
                      type="button"
                      className={`segment-btn ${thresholdType === 'SCORE' ? 'active' : ''}`}
                      onClick={() => {
                        setThresholdType('SCORE');
                        setThresholdValue(100);
                      }}
                    >
                      Relative Pollution Score
                    </button>
                  </div>
                </div>

                {/* Threshold Presets & Custom Input */}
                <div className="form-group">
                  <div className="threshold-header">
                    <label htmlFor="threshold-val" className="form-label">
                      Alert Trigger Level
                    </label>
                    <span className="unit-indicator">
                      {thresholdType === 'PM25' ? 'µg/m³' : 'Score Index'}
                    </span>
                  </div>

                  <div className="presets-grid">
                    {(thresholdType === 'PM25' ? PM25_PRESETS : SCORE_PRESETS).map(p => (
                      <button
                        key={p.value}
                        type="button"
                        className={`preset-chip ${thresholdValue === p.value ? 'selected' : ''}`}
                        onClick={() => setThresholdValue(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="custom-threshold-input">
                    <span className="prefix">&gt;</span>
                    <input
                      id="threshold-val"
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      className="text-input"
                      value={thresholdValue}
                      onChange={e => setThresholdValue(Number(e.target.value))}
                      required
                    />
                    <span className="suffix">
                      {thresholdType === 'PM25' ? 'µg/m³' : 'Index'}
                    </span>
                  </div>

                  {thresholdType === 'SCORE' && (
                    <div className="metric-info-note">
                      <ShieldAlert size={15} />
                      <span>
                        AirWindow's <strong>Relative Score</strong> is calculated as <code>PM2.5 + (0.5 × PM10)</code>. 
                        It is a transparent comparative metric, <strong>not an official AQI</strong>.
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="modal-actions-right">
                  <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        <span>Submitting…</span>
                      </>
                    ) : (
                      <>
                        <span>Create Alert</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>

              </form>
            )}
          </>
        )}

        {/* ── MODE 2: VERIFY ALERT ────────────────────────────── */}
        {mode === 'VERIFY' && (
          <div className="modal-verify-wrap">
            {verifyStatus === 'VERIFYING' && (
              <div className="verify-state">
                <Loader2 size={40} className="spin text-blue" />
                <h4>Verifying your alert…</h4>
                <p>Validating single-use verification token.</p>
              </div>
            )}

            {verifyStatus === 'SUCCESS' && (
              <div className="verify-state success">
                <CheckCircle2 size={44} color="#16a34a" />
                <h4>Alert Activated!</h4>
                <p>{verifyMessage || 'Your personalized air alert is now active. We will notify you whenever your threshold is forecast to be exceeded.'}</p>
                <div className="modal-actions-center">
                  <button type="button" className="btn-primary" onClick={onClose}>
                    Explore Forecasts
                  </button>
                </div>
              </div>
            )}

            {verifyStatus === 'ERROR' && (
              <div className="verify-state error">
                <AlertTriangle size={44} color="#dc2626" />
                <h4>Verification Failed</h4>
                <p>{error || 'This verification link is invalid, expired, or has already been used.'}</p>
                <div className="modal-actions-center">
                  <button 
                    type="button" 
                    className="btn-primary" 
                    onClick={() => {
                      setMode('CREATE');
                      setError(null);
                    }}
                  >
                    Set a New Alert
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MODE 3: MANAGE ALERT ────────────────────────────── */}
        {mode === 'MANAGE' && (
          <div className="modal-manage-wrap">
            {loading && !manageDetails && !isDeleted && (
              <div className="verify-state">
                <Loader2 size={36} className="spin text-blue" />
                <p>Loading alert details…</p>
              </div>
            )}

            {isDeleted ? (
              <div className="verify-state">
                <CheckCircle2 size={44} color="#16a34a" />
                <h4>Alert Deleted</h4>
                <p>This alert has been successfully deleted. You will no longer receive emails for this location.</p>
                <div className="modal-actions-center">
                  <button type="button" className="btn-primary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              manageDetails && (
                <div className="manage-card">
                  {manageSuccessMsg && (
                    <div className="modal-alert-box success">
                      <CheckCircle2 size={16} />
                      <span>{manageSuccessMsg}</span>
                    </div>
                  )}

                  <div className="manage-header-row">
                    <div>
                      <span className="manage-title">Air Quality Alert</span>
                      <div className="loc-meta">
                        Coordinates: {manageDetails.lat.toFixed(2)}, {manageDetails.lon.toFixed(2)}
                      </div>
                    </div>
                    <span className={`status-pill ${manageDetails.status.toLowerCase()}`}>
                      {manageDetails.status}
                    </span>
                  </div>

                  <div className="manage-detail-box">
                    <div className="detail-item">
                      <span className="detail-label">Threshold Type</span>
                      <span className="detail-value">
                        {manageDetails.threshold.type === 'PM25' ? 'PM2.5 Concentration' : 'Relative Pollution Score'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Breach Level</span>
                      <span className="detail-value">
                        &gt; {manageDetails.threshold.value} {manageDetails.threshold.type === 'PM25' ? 'µg/m³' : 'Index'}
                      </span>
                    </div>
                  </div>

                  <div className="manage-actions-row">
                    {manageDetails.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        className="btn-manage-action pause"
                        disabled={loading}
                        onClick={() => handleManageStatusChange('PAUSE')}
                      >
                        <PauseCircle size={16} />
                        <span>Pause Alert</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-manage-action resume"
                        disabled={loading}
                        onClick={() => handleManageStatusChange('RESUME')}
                      >
                        <PlayCircle size={16} />
                        <span>Resume Alert</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-manage-action delete"
                      disabled={loading}
                      onClick={handleDeleteAlert}
                    >
                      <Trash2 size={16} />
                      <span>Delete Alert</span>
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

      </div>
    </div>
  );
}
