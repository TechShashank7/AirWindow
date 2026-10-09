/**
 * recommendation.js
 *
 * Ported directly from src/utils/recommendation.ts.
 * Pure functions — no AWS SDK, no HTTP calls.
 *
 * Relative Pollution Score: PM2.5 + (0.5 × PM10)
 *   • PM2.5 is weighted higher due to its greater respiratory health impact.
 *   • This is a DIMENSIONLESS COMPARISON INDEX only.
 *   • It is NOT India's official CPCB AQI and carries NO health-safety guarantee.
 */

'use strict';

/**
 * Returns null if either value is missing — we never impute zeros for nulls.
 * @param {number|null} pm25
 * @param {number|null} pm10
 * @returns {number|null}
 */
function calculatePollutionScore(pm25, pm10) {
  if (pm25 === null || pm25 === undefined || pm10 === null || pm10 === undefined) {
    return null;
  }
  return pm25 + 0.5 * pm10;
}

/**
 * Build DataPoint array from a raw Open-Meteo hourly response.
 * @param {{ hourly: { time: string[], pm2_5: (number|null)[], pm10: (number|null)[] } }} data
 * @returns {Array<{ time: string, pm25: number|null, pm10: number|null, score: number|null }>}
 */
function processForecastData(data) {
  const points = [];
  const len = data.hourly.time.length;
  for (let i = 0; i < len; i++) {
    const pm25 = data.hourly.pm2_5[i] ?? null;
    const pm10 = data.hourly.pm10[i] ?? null;
    points.push({
      time: data.hourly.time[i],
      pm25,
      pm10,
      score: calculatePollutionScore(pm25, pm10),
    });
  }
  return points;
}

/**
 * Find the best continuous time window for an outdoor activity.
 *
 * Algorithm:
 *   1. Exclude all data points in the past (strictly < currentTimeStr).
 *   2. Determine required hours: 30 min → 1 h slot, 60 min → 1 h slot, 90 min → 2 h slots.
 *   3. Scan every sliding window that fits completely inside [preferredStart, preferredEnd].
 *      Skip any window containing a null score — we never silently treat nulls as zero.
 *   4. If no valid window exists in the preferred range, fall back to the global best future window.
 *   5. Return structured result including the "original" preferred window score for comparison.
 *
 * @param {Array} dataPoints
 * @param {number} durationMinutes  30 | 60 | 90
 * @param {string} preferredStartTime  "YYYY-MM-DDTHH:mm"
 * @param {string} preferredEndTime    "YYYY-MM-DDTHH:mm"
 * @param {string} currentTimeStr      "YYYY-MM-DDTHH:mm"
 * @returns {{ recommendedWindow, averageScore, isInPreferredRange, originalWindow, originalAverageScore, qualityLabel, message } | null}
 */
function getBestTimeWindow(dataPoints, durationMinutes, preferredStartTime, preferredEndTime, currentTimeStr) {
  // 1. Future-only filter — compare first 16 chars "YYYY-MM-DDTHH:mm"
  const currentPrefix = currentTimeStr.substring(0, 16);
  const futurePoints = dataPoints.filter(p => p.time.substring(0, 16) >= currentPrefix);

  if (futurePoints.length === 0) return null;

  // 2. Required hours (30-min activities still need a full 1-hour forecast slot)
  const requiredHours = durationMinutes <= 60 ? 1 : 2;

  if (futurePoints.length < requiredHours) return null;

  // Helper: average score for a window, returns Infinity if any value is null
  function avgScore(window) {
    let total = 0;
    for (const p of window) {
      if (p.score === null) return Infinity;
      total += p.score;
    }
    return total / window.length;
  }

  // 3a. Best window within preferred range
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

  // 3b. Fallback: best global future window (used when preferred range has no data)
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

  // 4. Compute the "original" (first-available-in-preferred-range) window for comparison
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

  // 5. Quality label and message
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
