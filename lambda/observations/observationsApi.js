'use strict';

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dbClient = new DynamoDBClient({});
const CACHE_TABLE = process.env.CACHE_TABLE_NAME || 'AirWindow-ForecastCache';
const FRESHNESS_MS = 15 * 60 * 1000; // 15 minutes cache for observations
const TTL_MS = 60 * 60 * 1000;        // 1 hour DynamoDB TTL

/**
 * Calculates distance between two coordinates in kilometers using Haversine formula
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

/**
 * Classifies observation freshness based on timestamp age
 */
function classifyFreshness(isoTimestamp) {
  if (!isoTimestamp) return { status: 'UNKNOWN', label: 'Timestamp missing', ageHours: null };
  const obsTime = new Date(isoTimestamp).getTime();
  if (isNaN(obsTime)) return { status: 'UNKNOWN', label: 'Invalid timestamp', ageHours: null };

  const diffMs = Date.now() - obsTime;
  const ageHours = Number((diffMs / (1000 * 60 * 60)).toFixed(1));

  if (ageHours < 0) {
    return { status: 'RECENT', label: 'Just now', ageHours: 0 };
  }
  if (ageHours < 3) {
    return { status: 'RECENT', label: `${ageHours}h ago (Recent)`, ageHours };
  }
  if (ageHours < 12) {
    return { status: 'MODERATE', label: `${ageHours}h ago (Delayed)`, ageHours };
  }
  if (ageHours < 48) {
    return { status: 'STALE', label: `${ageHours}h ago (Stale)`, ageHours };
  }
  return { status: 'OUTDATED', label: `${Math.round(ageHours / 24)}d ago (Outdated)`, ageHours };
}

/**
 * Validates observation query parameters
 */
function validateObservationParams({ latitude, longitude, radiusKm = 25, limit = 5 }) {
  const errors = [];
  const lat = Number(latitude);
  const lon = Number(longitude);
  const rad = Number(radiusKm);
  const lim = Number(limit);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.push('latitude must be a finite number between -90 and 90');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    errors.push('longitude must be a finite number between -180 and 180');
  }
  if (!Number.isFinite(rad) || rad < 1 || rad > 100) {
    errors.push('radiusKm must be a number between 1 and 100');
  }
  if (!Number.isFinite(lim) || lim < 1 || lim > 10) {
    errors.push('limit must be an integer between 1 and 10');
  }

  return { errors, lat, lon, radiusKm: rad, limit: lim };
}

/**
 * Fetches nearby stations and their latest PM2.5/PM10 readings from OpenAQ v3
 */
async function fetchOpenAQObservations(lat, lon, radiusKm, limit, apiKey) {
  if (!apiKey) {
    return {
      configured: false,
      stations: [],
      error: 'OPENAQ_API_KEY is not configured on the backend',
    };
  }

  const radiusMeters = Math.min(Math.round(radiusKm * 1000), 100000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s bounded timeout

  try {
    // 1. Fetch nearby monitoring locations supporting PM2.5 (2) or PM10 (1)
    const fetchLimit = Math.max(limit * 2, 10);
    const locationsUrl = `https://api.openaq.org/v3/locations?coordinates=${lat},${lon}&radius=${radiusMeters}&parameters_id=2,1&limit=${fetchLimit}`;
    const locRes = await fetch(locationsUrl, {
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal,
    });

    if (!locRes.ok) {
      const errText = await locRes.text().catch(() => '');
      throw new Error(`OpenAQ locations error HTTP ${locRes.status}: ${errText.substring(0, 150)}`);
    }

    const locData = await locRes.json();
    const rawLocations = locData.results || [];

    if (rawLocations.length === 0) {
      return { configured: true, stations: [] };
    }

    // Prioritize stations that have active sensors and recent reporting
    rawLocations.sort((a, b) => {
      const timeA = a.datetimeLast?.utc ? new Date(a.datetimeLast.utc).getTime() : 0;
      const timeB = b.datetimeLast?.utc ? new Date(b.datetimeLast.utc).getTime() : 0;
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const isAActive = timeA > thirtyDaysAgo;
      const isBActive = timeB > thirtyDaysAgo;

      if (isAActive && !isBActive) return -1;
      if (!isAActive && isBActive) return 1;

      // When both are active or both inactive, order by closest distance
      const distA = typeof a.distance === 'number' ? a.distance : 999999;
      const distB = typeof b.distance === 'number' ? b.distance : 999999;
      return distA - distB;
    });

    // 2. Fetch latest readings for top stations (bounded up to 4 stations in parallel)
    const topLocations = rawLocations.slice(0, 4);
    const stationPromises = topLocations.map(async (loc) => {
      // Map sensors to pollutant parameters
      const sensorMap = new Map();
      if (Array.isArray(loc.sensors)) {
        for (const s of loc.sensors) {
          if (s.id && s.parameter) {
            const paramName = (s.parameter.name || '').toLowerCase();
            if (paramName === 'pm25' || paramName === 'pm10') {
              sensorMap.set(s.id, {
                pollutant: paramName === 'pm25' ? 'PM2.5' : 'PM10',
                displayName: s.parameter.displayName || paramName.toUpperCase(),
                unit: s.parameter.units || 'µg/m³',
              });
            }
          }
        }
      }

      // Fetch latest values
      let latestMeasurements = [];
      try {
        const latestUrl = `https://api.openaq.org/v3/locations/${loc.id}/latest`;
        const latestRes = await fetch(latestUrl, {
          headers: { 'X-API-Key': apiKey },
          signal: controller.signal,
        });

        if (latestRes.ok) {
          const latestData = await latestRes.json();
          const results = latestData.results || [];

          for (const item of results) {
            const sensorMeta = sensorMap.get(item.sensorsId);
            if (sensorMeta && typeof item.value === 'number') {
              const isoTime = item.datetime?.utc || item.datetime?.local;
              const freshness = classifyFreshness(isoTime);

              latestMeasurements.push({
                pollutant: sensorMeta.pollutant,
                value: Number(item.value.toFixed(1)),
                unit: sensorMeta.unit,
                timestamp: isoTime || null,
                localTimestamp: item.datetime?.local || null,
                freshness: freshness.status,
                freshnessLabel: freshness.label,
                ageHours: freshness.ageHours,
              });
            }
          }
        }
      } catch (subErr) {
        // Individual station latest fetch failure shouldn't abort entire query
        console.warn(`Failed to fetch latest for station ${loc.id}:`, subErr.message);
      }

      // Deduplicate measurements by pollutant, keeping the most recent reading
      const deduplicated = new Map();
      for (const m of latestMeasurements) {
        const existing = deduplicated.get(m.pollutant);
        if (!existing) {
          deduplicated.set(m.pollutant, m);
        } else {
          const existingTime = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
          const newTime = m.timestamp ? new Date(m.timestamp).getTime() : 0;
          if (newTime > existingTime) {
            deduplicated.set(m.pollutant, m);
          }
        }
      }
      const finalMeasurements = Array.from(deduplicated.values());

      // If no latest readings were found from /latest endpoint, check datetimeLast
      if (finalMeasurements.length === 0 && loc.datetimeLast) {
        // Station exists but latest measurement unavailable
        finalMeasurements.push({
          pollutant: 'PM2.5',
          value: null,
          unit: 'µg/m³',
          timestamp: loc.datetimeLast.utc || null,
          localTimestamp: loc.datetimeLast.local || null,
          freshness: classifyFreshness(loc.datetimeLast.utc).status,
          freshnessLabel: 'No active sensor data',
          ageHours: classifyFreshness(loc.datetimeLast.utc).ageHours,
        });
      }

      // Determine station distance
      const stationLat = loc.coordinates?.latitude ?? 0;
      const stationLon = loc.coordinates?.longitude ?? 0;
      const distanceKm =
        typeof loc.distance === 'number'
          ? Number((loc.distance / 1000).toFixed(1))
          : calculateDistanceKm(lat, lon, stationLat, stationLon);

      return {
        stationId: String(loc.id),
        stationName: loc.name || `Station #${loc.id}`,
        coordinates: {
          latitude: stationLat,
          longitude: stationLon,
        },
        distanceKm,
        provider: loc.provider?.name || loc.owner?.name || 'OpenAQ Ground Network',
        country: loc.country?.name || loc.country?.code || '',
        timezone: loc.timezone || 'UTC',
        measurements: finalMeasurements,
      };
    });

    const stations = await Promise.all(stationPromises);
    // Sort stations: prioritize active reporting stations (<30 days old) by distance, followed by historical stations
    stations.sort((a, b) => {
      const getMinAge = (s) => {
        const ages = s.measurements.map((m) => m.ageHours).filter((age) => typeof age === 'number');
        return ages.length > 0 ? Math.min(...ages) : Infinity;
      };
      const ageA = getMinAge(a);
      const ageB = getMinAge(b);
      const activeA = ageA < 30 * 24;
      const activeB = ageB < 30 * 24;

      if (activeA && !activeB) return -1;
      if (!activeA && activeB) return 1;
      return a.distanceKm - b.distanceKm;
    });

    return { configured: true, stations };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Main observation handler with validation and DynamoDB caching
 */
async function getNearbyObservations({ latitude, longitude, radiusKm = 25, limit = 5 }) {
  const { errors, lat, lon, radiusKm: validRad, limit: validLim } = validateObservationParams({
    latitude,
    longitude,
    radiusKm,
    limit,
  });

  if (errors.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: { code: 'VALIDATION_FAILED', message: 'Invalid query parameters', details: errors },
      },
    };
  }

  const apiKey = (process.env.OPENAQ_API_KEY || '').trim();
  const cacheKey = `OBS#LOC#${lat.toFixed(2)},${lon.toFixed(2)}#RAD#${validRad}`;
  const now = Date.now();

  // 1. Attempt Cache Retrieval
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
    console.warn('DynamoDB observation cache get error (proceeding to fetch):', dbErr.message);
  }

  /**
   * Recalculates measurement freshness and age against current timestamp
   * so cache hits or stale-if-error fallbacks never freeze or mask elapsed age.
   */
  function refreshCachedPayload(rawPayload) {
    if (!rawPayload || !Array.isArray(rawPayload.stations)) return rawPayload;
    const refreshedStations = rawPayload.stations.map((st) => {
      const refreshedMeasurements = (st.measurements || []).map((m) => {
        const freshness = classifyFreshness(m.timestamp);
        return {
          ...m,
          freshness: freshness.status,
          freshnessLabel: freshness.label,
          ageHours: freshness.ageHours,
        };
      });
      return {
        ...st,
        measurements: refreshedMeasurements,
      };
    });
    return {
      ...rawPayload,
      stations: refreshedStations,
    };
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

  // 2. Fetch from OpenAQ
  let observationResult;
  try {
    observationResult = await fetchOpenAQObservations(lat, lon, validRad, validLim, apiKey);
  } catch (err) {
    console.error('Failed to retrieve observations from OpenAQ:', err.message);

    // Stale-if-error fallback
    if (cachedItem && now < cachedItem.expiresAt * 1000) {
      return {
        statusCode: 200,
        body: {
          ...refreshCachedPayload(cachedItem.payload),
          cached: true,
          isStale: true,
          warning: 'Upstream observation provider unavailable; serving cached reading',
        },
      };
    }

    return {
      statusCode: 502,
      body: {
        error: {
          code: 'UPSTREAM_OBSERVATION_FAILED',
          message: 'Failed to retrieve ground observations from OpenAQ',
          details: [err.message],
        },
      },
    };
  }

  const payload = {
    location: { latitude: lat, longitude: lon },
    searchRadiusKm: validRad,
    stationCount: observationResult.stations.length,
    stations: observationResult.stations,
    providerConfigured: observationResult.configured,
    retrievedAt: new Date().toISOString(),
    disclaimer:
      'Ground-station observations reflect point-in-time measurements at physical monitoring stations and may differ from regional modelled forecasts.',
  };

  // 3. Cache Result in DynamoDB (Fire-and-forget / non-blocking)
  if (observationResult.configured && observationResult.stations.length > 0) {
    try {
      const item = {
        CacheKey: cacheKey,
        payload,
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
      console.warn('DynamoDB observation cache put error:', putErr.message);
    }
  }

  return {
    statusCode: 200,
    body: payload,
  };
}

module.exports = {
  getNearbyObservations,
  validateObservationParams,
  classifyFreshness,
  calculateDistanceKm,
  fetchOpenAQObservations,
};
