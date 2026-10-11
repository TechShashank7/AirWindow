/**
 * alertsApi.ts
 *
 * Frontend API client for AirWindow Personalized Air Alerts:
 * - POST /alerts/create
 * - POST /alerts/verify
 * - POST /alerts/manage
 *
 * Security:
 * - Never logs tokens, email addresses, or authorization headers.
 * - Uses URL fragment tokens passed by value in POST requests.
 */

export interface CreateAlertRequest {
  email: string;
  latitude: number;
  longitude: number;
  timezone: string;
  thresholdType: 'PM25' | 'SCORE';
  thresholdValue: number;
}

export interface CreateAlertResponse {
  message: string;
  alertId: string;
}

export interface VerifyAlertResponse {
  message: string;
}

export interface AlertDetails {
  alertId: string;
  status: 'ACTIVE' | 'PAUSED' | 'PENDING';
  threshold: {
    type: 'PM25' | 'SCORE';
    value: number;
  };
  lat: number;
  lon: number;
}

export type ManageAction = 'LIST' | 'PAUSE' | 'RESUME' | 'DELETE';

export interface ManageAlertResponse {
  message?: string;
  alertId?: string;
  status?: 'ACTIVE' | 'PAUSED' | 'PENDING';
  threshold?: {
    type: 'PM25' | 'SCORE';
    value: number;
  };
  lat?: number;
  lon?: number;
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_EVALUATE_API_URL as string | undefined;
  return (url || '').replace(/\/+$/, '');
}

/**
 * Creates a new air alert. If successful, sends a verification email.
 */
export async function createAlert(req: CreateAlertRequest): Promise<CreateAlertResponse> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/alerts/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Failed to create alert (HTTP ${res.status})`);
  }

  return data as CreateAlertResponse;
}

/**
 * Consumes a single-use verification token to activate an alert.
 */
export async function verifyAlert(token: string): Promise<VerifyAlertResponse> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/alerts/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Verification failed (HTTP ${res.status})`);
  }

  return data as VerifyAlertResponse;
}

/**
 * Performs a token-authorized management action on an existing alert.
 * Supported actions: 'LIST' | 'PAUSE' | 'RESUME' | 'DELETE'
 */
export async function manageAlert(token: string, action: ManageAction): Promise<ManageAlertResponse> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/alerts/manage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Management request failed (HTTP ${res.status})`);
  }

  return data as ManageAlertResponse;
}
