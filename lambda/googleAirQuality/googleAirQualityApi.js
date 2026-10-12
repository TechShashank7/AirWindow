'use strict';

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dbClient = new DynamoDBClient({});
const CACHE_TABLE = process.env.CACHE_TABLE_NAME || 'AirWindow-ForecastCache';
const FRESHNESS_MS = 15 * 60 * 1000; // 15 minutes cache
const TTL_MS = 60 * 60 * 1000;        // 1 hour DynamoDB TTL
const UPSTREAM_TIMEOUT_MS = 5000;     // 5 seconds bounded timeout

/**
 * Validates latitude and longitude parameters
 */
function validateCoordinates(latitude, longitude) {
  const errors = [];
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.push('latitude must be a finite number between -90 and 90');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    errors.push('longitude must be a finite number between -180 and 180');
  }

  return { errors, lat, lon };
}

/**
 * Normalizes pollutant concentration units
 */
function normalizeUnits(unitStr) {
  if (!unitStr) return '';
  const u = String(unitStr).toUpperCase();
  if (u === 'MICROGRAMS_PER_CUBIC_METER') return 'µg/m³';
  if (u === 'PARTS_PER_BILLION') return 'ppb';
  if (u === 'PARTS_PER_MILLION') return 'ppm';
  return unitStr;
}

/**
 * Normalizes raw Google Maps Air Quality API response into AirWindow contract
 */
function normalizeGoogleResponse(raw, lat, lon) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const indexes = Array.isArray(raw.indexes) ? raw.indexes : [];
  let indiaAqi = null;
  let universalAqi = null;
  const otherIndexes = [];

  for (const idx of indexes) {
    if (!idx || typeof idx !== 'object') continue;
    const aqiNum = typeof idx.aqi === 'number' ? idx.aqi : (Number(idx.aqiDisplay) || null);
    const normalizedIdx = {
      code: idx.code || 'unknown',
      displayName: idx.displayName || idx.code || 'AQI',
      aqi: aqiNum,
      category: idx.category || 'Not categorized',
      dominantPollutant: idx.dominantPollutant || null,
    };

    if (idx.code === 'ind_cpcb') {
      indiaAqi = normalizedIdx;
    } else if (idx.code === 'uaqi') {
      universalAqi = normalizedIdx;
    } else {
      otherIndexes.push(normalizedIdx);
    }
  }

  const rawPollutants = Array.isArray(raw.pollutants) ? raw.pollutants : [];
  const pollutants = [];
  for (const p of rawPollutants) {
    if (!p || typeof p !== 'object') continue;
    const conc = p.concentration;
    if (conc && typeof conc.value === 'number') {
      pollutants.push({
        code: p.code || 'unknown',
        displayName: p.displayName || p.code || 'Pollutant',
        value: Number(conc.value.toFixed(2)),
        units: normalizeUnits(conc.units),
      });
    }
  }

  const measurementTimestamp = raw.dateTime || null;
  let ageHours = null;
  if (measurementTimestamp) {
    const timeMs = new Date(measurementTimestamp).getTime();
    if (!isNaN(timeMs)) {
      ageHours = Number(((Date.now() - timeMs) / (1000 * 60 * 60)).toFixed(1));
      if (ageHours < 0) ageHours = 0;
    }
  }

  return {
    configured: true,
    location: { latitude: lat, longitude: lon },
    regionCode: raw.regionCode || null,
    measurementTimestamp,
    retrievedAt: new Date().toISOString(),
    ageHours,
    indiaAqi,
    universalAqi,
    otherIndexes,
    pollutants,
    healthRecommendations: raw.healthRecommendations || null,
    provenance: {
      provider: 'Google Maps Platform Air Quality API',
      methodology:
        'Derived and modelled 500m resolution atmospheric estimate integrating station monitoring, weather patterns, satellite inputs, and traffic congestion. Not a raw single physical station sensor measurement.',
      isPhysicalStation: false,
    },
  };
}

/**
 * Re-evaluates measurement age dynamically on cached payloads
 */
function refreshCachedPayload(cachedPayload) {
  if (!cachedPayload || typeof cachedPayload !== 'object') return cachedPayload;
  let ageHours = null;
  if (cachedPayload.measurementTimestamp) {
    const timeMs = new Date(cachedPayload.measurementTimestamp).getTime();
    if (!isNaN(timeMs)) {
      ageHours = Number(((Date.now() - timeMs) / (1000 * 60 * 60)).toFixed(1));
      if (ageHours < 0) ageHours = 0;
    }
  }
  return {
    ...cachedPayload,
    ageHours,
  };
}

/**
 * Calls Google Air Quality API currentConditions:lookup
 */
async function fetchGoogleCurrentConditions(lat, lon, apiKey) {
  if (!apiKey) {
    return {
      configured: false,
      error: { code: 'UNCONFIGURED', message: 'Google Air Quality API key is not configured.' },
    };
  }

  const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`;
  const requestBody = {
    location: {
      latitude: lat,
      longitude: lon,
    },
    extraComputations: [
      'LOCAL_AQI',
      'HEALTH_RECOMMENDATIONS',
      'POLLUTANT_ADDITIONAL_INFO',
      'DOMINANT_POLLUTANT_CONCENTRATION',
      'POLLUTANT_CONCENTRATION',
    ],
    languageCode: 'en',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    let errBody = {};
    try {
      errBody = await response.json();
    } catch (_) {
      // ignore json parse error on non-json error responses
    }
    const errMsg = errBody.error?.message || `Google API HTTP ${response.status} ${response.statusText}`;
    const errCode = errBody.error?.status || `HTTP_${response.status}`;
    const err = new Error(errMsg);
    err.code = errCode;
    err.status = response.status;
    throw err;
  }

  const rawData = await response.json();
  const normalized = normalizeGoogleResponse(rawData, lat, lon);
  return normalized;
}

/**
 * Main handler to get current air quality with caching
 */
async function getCurrentAirQuality({ latitude, longitude }) {
  const { errors, lat, lon } = validateCoordinates(latitude, longitude);
  if (errors.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid coordinate parameters',
          details: errors,
        },
      },
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    return {
      statusCode: 200,
      body: {
        configured: false,
        location: { latitude: lat, longitude: lon },
        indiaAqi: null,
        universalAqi: null,
        pollutants: [],
        healthRecommendations: null,
        retrievedAt: new Date().toISOString(),
        provenance: {
          provider: 'Google Maps Platform Air Quality API',
          methodology: 'Backend service unconfigured (missing GOOGLE_MAPS_API_KEY).',
          isPhysicalStation: false,
        },
      },
    };
  }

  const gridLat = Number(lat).toFixed(2);
  const gridLon = Number(lon).toFixed(2);
  const cacheKey = `GOOGLE_AQ#LOC#${gridLat},${gridLon}`;
  const now = Date.now();

  // 1. Check DynamoDB Cache
  let cachedItem = null;
  try {
    const res = await dbClient.send(
      new GetItemCommand({
        TableName: CACHE_TABLE,
        Key: marshall({ CacheKey: cacheKey }),
      })
    );
    if (res.Item) {
      cachedItem = unmarshall(res.Item);
    }
  } catch (dbErr) {
    console.warn('DynamoDB Google AQ cache get error (proceeding to fetch):', dbErr.message);
  }

  if (cachedItem && now < cachedItem.staleAfter && now < cachedItem.expiresAt * 1000) {
    return {
      statusCode: 200,
      body: {
        ...refreshCachedPayload(cachedItem.payload),
        cached: true,
      },
    };
  }

  // 2. Fetch from Google API
  let currentResult;
  try {
    currentResult = await fetchGoogleCurrentConditions(lat, lon, apiKey);
  } catch (err) {
    console.error('Failed to retrieve current conditions from Google AQ API:', err.message);

    // Stale-if-error fallback
    if (cachedItem && now < cachedItem.expiresAt * 1000) {
      return {
        statusCode: 200,
        body: {
          ...refreshCachedPayload(cachedItem.payload),
          cached: true,
          isStale: true,
          warning: 'Upstream Google API request failed; serving cached current conditions.',
        },
      };
    }

    return {
      statusCode: err.status && err.status >= 400 && err.status < 500 ? err.status : 502,
      body: {
        error: {
          code: err.code || 'UPSTREAM_FAILED',
          message: 'Failed to retrieve current conditions from Google Air Quality API',
          details: [err.message],
        },
      },
    };
  }

  // 3. Cache Result in DynamoDB
  if (currentResult && currentResult.configured && !currentResult.error) {
    try {
      const item = {
        CacheKey: cacheKey,
        payload: currentResult,
        staleAfter: now + FRESHNESS_MS,
        expiresAt: Math.floor((now + TTL_MS) / 1000),
        updatedAt: new Date().toISOString(),
      };
      await dbClient.send(
        new PutItemCommand({
          TableName: CACHE_TABLE,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
    } catch (putErr) {
      console.warn('DynamoDB Google AQ cache put error:', putErr.message);
    }
  }

  return {
    statusCode: 200,
    body: currentResult,
  };
}

module.exports = {
  getCurrentAirQuality,
  fetchGoogleCurrentConditions,
  normalizeGoogleResponse,
  validateCoordinates,
  normalizeUnits,
  refreshCachedPayload,
};
