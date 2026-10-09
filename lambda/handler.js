/**
 * handler.js  — AWS Lambda entry point
 *
 * Endpoint (via API Gateway HTTP API):
 *   POST /evaluate
 *
 * Request body (JSON):
 *   {
 *     "latitude":          number   (required, -90..90)
 *     "longitude":         number   (required, -180..180)
 *     "timezone":          string   (required, IANA, e.g. "Asia/Kolkata")
 *     "durationMinutes":   30|60|90 (required)
 *     "preferredStart":    string   (required, "YYYY-MM-DDTHH:MM" in the location's local time)
 *     "preferredEnd":      string   (required, "YYYY-MM-DDTHH:MM" in the location's local time)
 *     "currentTime":       string   (required, "YYYY-MM-DDTHH:MM" — caller supplies, avoids server TZ issues)
 *   }
 *
 * Success response (200):
 *   {
 *     "retrievedAt":         ISO timestamp of when this Lambda fetched the forecast
 *     "forecastTimezone":    IANA timezone string returned by Open-Meteo
 *     "forecastData":        Array of { time, pm25, pm10, score } for the full 48-hour window
 *     "recommendation": {
 *       "recommendedWindow":    Array of DataPoint
 *       "averageScore":         number
 *       "isInPreferredRange":   boolean
 *       "qualityLabel":         "Good" | "Moderate" | "Poor"
 *       "message":              string  (never claims safety)
 *       "originalWindow":       Array | null  (the user's literal preferred slot, for comparison)
 *       "originalAverageScore": number | null
 *     }
 *     "scoreFormula":  "PM2.5 + (0.5 × PM10)"
 *     "disclaimer":    string
 *   }
 *
 * Error responses: 400 (validation), 502 (upstream failure), 500 (unexpected)
 */

'use strict';

const { processForecastData, getBestTimeWindow } = require('./recommendation');

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_DURATIONS = new Set([30, 60, 90]);
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validate(body) {
  const errors = [];

  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  if (!Number.isFinite(lat) || lat < -90  || lat > 90)  errors.push('latitude must be a number between -90 and 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('longitude must be a number between -180 and 180.');

  if (!body.timezone || typeof body.timezone !== 'string' || body.timezone.trim() === '')
    errors.push('timezone is required (IANA string, e.g. "Asia/Kolkata").');

  if (!VALID_DURATIONS.has(Number(body.durationMinutes)))
    errors.push('durationMinutes must be 30, 60, or 90.');

  for (const field of ['preferredStart', 'preferredEnd', 'currentTime']) {
    if (!body[field] || !ISO_DATETIME_RE.test(body[field]))
      errors.push(`${field} must be a string in "YYYY-MM-DDTHH:MM" format.`);
  }

  if (errors.length === 0 && body.preferredEnd <= body.preferredStart)
    errors.push('preferredEnd must be after preferredStart.');

  return errors;
}

// ── Open-Meteo fetch ──────────────────────────────────────────────────────────

async function fetchAirQualityForecast(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=pm10,pm2_5&timezone=auto&forecast_days=2`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Open-Meteo responded with HTTP ${res.status}`),
      { statusCode: res.status, body: text }
    );
  }
  return res.json();
}

// ── CORS headers ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

const DISCLAIMER =
  'This service uses modelled air-quality forecasts from Open-Meteo, not ' +
  'real-time ground-station measurements. The Relative Pollution Score ' +
  '(PM2.5 + 0.5×PM10) is a dimensionless comparison index and is NOT the ' +
  'official CPCB AQI or any other regulatory standard. A "best available" ' +
  'window recommendation does not guarantee safe air quality. Always consult ' +
  'authoritative local advisories before outdoor activity.';

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return respond(204, {});
  }

  // Parse body
  let body;
  try {
    const raw = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});
    body = JSON.parse(raw);
  } catch {
    return respond(400, { error: 'Request body must be valid JSON.' });
  }

  // Validate
  const errors = validate(body);
  if (errors.length > 0) {
    return respond(400, { error: 'Invalid request parameters.', details: errors });
  }

  const { latitude, longitude, durationMinutes, preferredStart, preferredEnd, currentTime } = body;

  // Fetch forecast
  let rawForecast;
  try {
    rawForecast = await fetchAirQualityForecast(Number(latitude), Number(longitude));
  } catch (err) {
    console.error('Open-Meteo fetch failed:', err.message);
    return respond(502, {
      error: 'Failed to retrieve forecast from Open-Meteo.',
      detail: err.message,
    });
  }

  // Process data
  const dataPoints = processForecastData(rawForecast);

  // Run recommendation
  const result = getBestTimeWindow(
    dataPoints,
    Number(durationMinutes),
    preferredStart,
    preferredEnd,
    currentTime,
  );

  if (!result) {
    return respond(200, {
      retrievedAt: new Date().toISOString(),
      forecastTimezone: rawForecast.timezone,
      forecastData: dataPoints,
      recommendation: null,
      message: 'No time window with complete forecast data could be found for the requested parameters.',
      scoreFormula: 'PM2.5 + (0.5 × PM10)',
      disclaimer: DISCLAIMER,
    });
  }

  return respond(200, {
    retrievedAt: new Date().toISOString(),
    forecastTimezone: rawForecast.timezone,
    forecastData: dataPoints,
    recommendation: result,
    scoreFormula: 'PM2.5 + (0.5 × PM10)',
    disclaimer: DISCLAIMER,
  });
};
