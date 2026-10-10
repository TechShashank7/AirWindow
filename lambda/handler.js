'use strict';

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { processForecastData, getBestTimeWindow } = require('./recommendation');

const dbClient = new DynamoDBClient({});
const CACHE_TABLE = process.env.CACHE_TABLE_NAME || 'AirWindow-ForecastCache';

// ── Logging & Utilities ───────────────────────────────────────────────────────

function log(level, message, details = {}) {
  // Avoid logging secrets or heavy payloads; keep it operational
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details
  }));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_DURATIONS = new Set([30, 60, 90]);
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validateEvaluateRequest(body) {
  const errors = [];
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('latitude must be between -90 and 90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('longitude must be between -180 and 180');
  if (!body.timezone || typeof body.timezone !== 'string') errors.push('timezone is required');
  if (!VALID_DURATIONS.has(Number(body.durationMinutes))) errors.push('durationMinutes must be 30, 60, or 90');

  for (const field of ['preferredStart', 'preferredEnd', 'currentTime']) {
    if (!body[field] || !ISO_DATETIME_RE.test(body[field])) {
      errors.push(`${field} must be a valid YYYY-MM-DDTHH:MM string`);
    }
  }
  if (errors.length === 0 && body.preferredEnd <= body.preferredStart) {
    errors.push('preferredEnd must be after preferredStart');
  }
  return errors;
}

// ── Fetch & Cache Data ────────────────────────────────────────────────────────

const FRESHNESS_MS = 45 * 60 * 1000; // 45 minutes
const TTL_MS = 2 * 60 * 60 * 1000;   // 2 hours

function getCacheKey(lat, lon) {
  // Round to 2 decimal places (~1.1km grid) to improve cache hit rates
  const gridLat = Number(lat).toFixed(2);
  const gridLon = Number(lon).toFixed(2);
  return `PROVIDER#OpenMeteo|LOC#${gridLat},${gridLon}|VARS#pm10,pm2_5,windspeed_10m,winddirection_10m`;
}

async function fetchFromOpenMeteo(lat, lon) {
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto&forecast_days=2`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=windspeed_10m,winddirection_10m&timezone=auto&forecast_days=2`;
  
  const [aqRes, weatherRes] = await Promise.all([
    fetch(aqUrl),
    fetch(weatherUrl)
  ]);

  if (!aqRes.ok || !weatherRes.ok) {
    throw new Error(`Open-Meteo HTTP Error: AQ=${aqRes.status} Weather=${weatherRes.status}`);
  }

  const aqData = await aqRes.json();
  const weatherData = await weatherRes.json();

  if (aqData.hourly && weatherData.hourly) {
    aqData.hourly.windspeed_10m = weatherData.hourly.windspeed_10m;
    aqData.hourly.winddirection_10m = weatherData.hourly.winddirection_10m;
  }

  return aqData;
}

async function getForecastData(lat, lon) {
  const cacheKey = getCacheKey(lat, lon);
  const now = Date.now();
  let cachedItem = null;

  // 1. Try Cache
  try {
    const result = await dbClient.send(new GetItemCommand({
      TableName: CACHE_TABLE,
      Key: marshall({ CacheKey: cacheKey })
    }));
    if (result.Item) {
      cachedItem = unmarshall(result.Item);
    }
  } catch (err) {
    log('ERROR', 'DynamoDB GetItem failed', { error: err.message, cacheKey });
    // Proceed to fetch without failing request
  }

  // 2. Evaluate Freshness
  if (cachedItem) {
    const isFresh = now < cachedItem.staleAfter;
    // DynamoDB TTL uses seconds; compare appropriately
    const isExpired = now > (cachedItem.expiresAt * 1000); 
    
    // Application strictly enforces TTL if DynamoDB background deletion is delayed
    if (isFresh && !isExpired) {
      log('INFO', 'Cache hit (Fresh)', { cacheKey });
      return { rawForecast: cachedItem.rawForecast, isStale: false };
    }
    log('INFO', isExpired ? 'Cache expired' : 'Cache stale', { cacheKey });
  }

  // 3. Fetch Upstream
  let rawForecast;
  try {
    rawForecast = await fetchFromOpenMeteo(lat, lon);
  } catch (fetchErr) {
    log('ERROR', 'Upstream fetch failed', { error: fetchErr.message });
    
    // Stale-if-error Fallback
    if (cachedItem && now < (cachedItem.expiresAt * 1000)) {
      log('WARN', 'Falling back to stale cache due to upstream failure');
      return { rawForecast: cachedItem.rawForecast, isStale: true };
    }
    throw fetchErr; // Complete failure
  }

  // 4. Update Cache (Fire and Forget effectively, though we await it)
  try {
    const item = {
      CacheKey: cacheKey,
      rawForecast,
      staleAfter: now + FRESHNESS_MS,
      expiresAt: Math.floor((now + TTL_MS) / 1000), // TTL expects seconds
      updatedAt: new Date().toISOString()
    };
    await dbClient.send(new PutItemCommand({
      TableName: CACHE_TABLE,
      Item: marshall(item, { removeUndefinedValues: true })
    }));
    log('INFO', 'Cache updated', { cacheKey });
  } catch (err) {
    log('ERROR', 'DynamoDB PutItem failed', { error: err.message, cacheKey });
  }

  return { rawForecast, isStale: false };
}

// ── Routers ───────────────────────────────────────────────────────────────────

async function handleEvaluate(body) {
  const errors = validateEvaluateRequest(body);
  if (errors.length > 0) {
    return respond(400, { error: { code: 'VALIDATION_FAILED', message: 'Invalid request', details: errors } });
  }

  const { latitude, longitude, durationMinutes, preferredStart, preferredEnd, currentTime, timezone } = body;

  let rawForecast, isStale;
  try {
    const result = await getForecastData(latitude, longitude);
    rawForecast = result.rawForecast;
    isStale = result.isStale;
  } catch (err) {
    return respond(502, { error: { code: 'UPSTREAM_FAILED', message: 'Failed to retrieve forecast', details: [err.message] } });
  }

  const dataPoints = processForecastData(rawForecast);
  const recommendation = getBestTimeWindow(dataPoints, Number(durationMinutes), preferredStart, preferredEnd, currentTime);

  // Normalized Data Contract
  const normalizedResponse = {
    metadata: {
      location: { lat: Number(latitude), lon: Number(longitude), timezone },
      units: { pm25: 'µg/m³', pm10: 'µg/m³', windSpeed: 'km/h', windDir: 'degrees' },
      retrievedAt: new Date().toISOString(),
      isStale,
      sources: ["Open-Meteo Air Quality API"]
    },
    data: dataPoints,
    recommendation: recommendation || null,
    scoreFormula: 'PM2.5 + (0.5 × PM10)',
    disclaimer: 'This service uses modelled forecasts, not real-time measurements. Not CPCB AQI.'
  };

  // BACKWARD COMPATIBILITY: Attach existing top-level fields for the current frontend
  normalizedResponse.forecastTimezone = rawForecast.timezone;
  normalizedResponse.retrievedAt = normalizedResponse.metadata.retrievedAt;
  normalizedResponse.forecastData = dataPoints;

  return respond(200, normalizedResponse);
}

// ── Handler Entry ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  log('INFO', 'Request received', { method: event.requestContext?.http?.method || event.httpMethod, path: event.rawPath || event.path });

  // Handle HTTP API CORS preflight natively if passed through
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') {
    return respond(204, {});
  }

  const path = event.rawPath || event.path || '/evaluate';

  let body = {};
  if (event.body) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      return respond(400, { error: { code: 'MALFORMED_JSON', message: 'Request body must be valid JSON', details: [] } });
    }
  }

  // Routing
  if (path === '/evaluate' && method === 'POST') {
    return await handleEvaluate(body);
  }

  return respond(404, { error: { code: 'NOT_FOUND', message: 'Route not found', details: [] } });
};
