/**
 * recommendation.js
 *
 * Relative Pollution Score: PM2.5 + (0.5 × PM10)
 *
 * Updates in Phase 1:
 * - Maintains explicit nulls for missing values (never imputed).
 * - Maps Wind Speed and Wind Direction into the data array.
 */

'use strict';

/**
 * Returns null if either value is missing.
 */
function calculatePollutionScore(pm25, pm10) {
  if (pm25 === null || pm25 === undefined || pm10 === null || pm10 === undefined) {
    return null;
  }
  return pm25 + 0.5 * pm10;
}

/**
 * Build DataPoint array from a raw Open-Meteo hourly response.
 * Safely extracts PM and Wind data, preserving nulls.
 */
function processForecastData(data) {
  const points = [];
  const len = data.hourly.time.length;
  for (let i = 0; i < len; i++) {
    const pm25 = data.hourly.pm2_5[i] ?? null;
    const pm10 = data.hourly.pm10[i] ?? null;
    
    // Wind data added in Phase 1 (safeguarded if upstream omits it)
    const windSpeed = (data.hourly.windspeed_10m && data.hourly.windspeed_10m[i] !== undefined) 
      ? data.hourly.windspeed_10m[i] 
      : null;
    const windDir = (data.hourly.winddirection_10m && data.hourly.winddirection_10m[i] !== undefined)
      ? data.hourly.winddirection_10m[i] 
      : null;

    points.push({
      time: data.hourly.time[i],
      pm25,
      pm10,
      windSpeed,
      windDir,
      score: calculatePollutionScore(pm25, pm10),
    });
  }
  return points;
}

/**
 * Find the best continuous time window for an outdoor activity.
 */
function getBestTimeWindow(dataPoints, durationMinutes, preferredStartTime, preferredEndTime, currentTimeStr) {
  const currentPrefix = currentTimeStr.substring(0, 16);
  const futurePoints = dataPoints.filter(p => p.time.substring(0, 16) >= currentPrefix);

  if (futurePoints.length === 0) return null;

  const requiredHours = durationMinutes <= 60 ? 1 : 2;
  if (futurePoints.length < requiredHours) return null;

  function avgScore(window) {
    let total = 0;
    for (const p of window) {
      if (p.score === null) return Infinity;
      total += p.score;
    }
    return total / window.length;
  }

  let bestWindow = null;
  let bestScore = Infinity;

  for (let i = 0; i <= futurePoints.length - requiredHours; i++) {
    const w = futurePoints.slice(i, i + requiredHours);
    const windowStart = w[0].time.substring(0, 16);
    const windowEnd   = w[w.length - 1].time.substring(0, 16);
    if (windowStart >= preferredStartTime.substring(0, 16) &&
        windowEnd   <= preferredEndTime.substring(0, 16)) {
      const s = avgScore(w);
      if (s < bestScore) { bestScore = s; bestWindow = w; }
    }
  }

  const isInPreferredRange = bestWindow !== null;

  let fallbackWindow = null;
  let fallbackScore  = Infinity;

  if (!bestWindow) {
    for (let i = 0; i <= futurePoints.length - requiredHours; i++) {
      const w = futurePoints.slice(i, i + requiredHours);
      const s = avgScore(w);
      if (s < fallbackScore) { fallbackScore = s; fallbackWindow = w; }
    }
  }

  const finalWindow = bestWindow || fallbackWindow;
  const finalScore  = isInPreferredRange ? bestScore : fallbackScore;

  if (!finalWindow || finalScore === Infinity) return null;

  let originalWindow = null;
  let originalAverageScore = null;

  const prefStart = preferredStartTime.substring(0, 16);
  const prefEnd   = preferredEndTime.substring(0, 16);
  const origIdx   = futurePoints.findIndex(p => p.time.substring(0, 16) >= prefStart);

  if (origIdx !== -1 && origIdx + requiredHours <= futurePoints.length) {
    const ow = futurePoints.slice(origIdx, origIdx + requiredHours);
    if (ow[0].time.substring(0, 16) <= prefEnd) {
      originalWindow = ow;
      const os = avgScore(ow);
      if (os !== Infinity) originalAverageScore = os;
    }
  }

  const qualityLabel = finalScore <= 35 ? 'Good' : finalScore <= 70 ? 'Moderate' : 'Poor';

  let message;
  if (isInPreferredRange) {
    if (finalScore > 70) {
      message = 'This is the least-polluted slot within your preferred time range, but forecast pollution remains high. This is a comparative recommendation — not a health clearance. Consider an indoor alternative or appropriate protective measures.';
    } else if (finalScore > 35) {
      message = 'This window has moderate forecast pollution and is the cleanest slot within your preferred range. Monitor local advisories before going outside.';
    } else {
      message = 'This window has relatively low forecast pollution within your preferred range. Always verify with local advisories before outdoor activity.';
    }
  } else {
    if (finalScore > 70) {
      message = 'No slot with complete data was found in your preferred time range. This is the least-polluted alternative found, but pollution is still forecast to be high. Consider staying indoors.';
    } else {
      message = 'No slot with complete data was found in your preferred time range. This is the cleanest alternative available in the next 48 hours.';
    }
  }

  return {
    recommendedWindow: finalWindow,
    averageScore: finalScore,
    isInPreferredRange,
    qualityLabel,
    originalWindow: isInPreferredRange ? null : originalWindow,
    originalAverageScore: isInPreferredRange ? null : originalAverageScore,
    message,
  };
}

module.exports = { calculatePollutionScore, processForecastData, getBestTimeWindow };
