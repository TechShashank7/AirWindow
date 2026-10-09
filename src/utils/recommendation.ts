import type { AirQualityForecast } from '../api/openmeteo';

export interface DataPoint {
  time: string; // ISO string without Z, e.g. "2026-10-09T00:00"
  pm25: number | null;
  pm10: number | null;
  score: number | null;
}

export interface RecommendationResult {
  recommendedWindow: DataPoint[];
  averageScore: number;
  originalWindow: DataPoint[] | null;
  originalAverageScore: number | null;
  message: string;
}

// Relative Pollution Score formula
// PM2.5 is weighted heavier than PM10 due to higher health impact.
export function calculatePollutionScore(pm25: number | null, pm10: number | null): number | null {
  if (pm25 === null || pm10 === null) return null;
  return pm25 + 0.5 * pm10;
}

export function processForecastData(data: AirQualityForecast): DataPoint[] {
  const points: DataPoint[] = [];
  const len = data.hourly.time.length;
  for (let i = 0; i < len; i++) {
    points.push({
      time: data.hourly.time[i],
      pm25: data.hourly.pm2_5[i],
      pm10: data.hourly.pm10[i],
      score: calculatePollutionScore(data.hourly.pm2_5[i], data.hourly.pm10[i]),
    });
  }
  return points;
}

export function getBestTimeWindow(
  dataPoints: DataPoint[],
  durationMinutes: number,
  preferredStartTime: string, // ISO string
  preferredEndTime: string,   // ISO string
  currentTimeStr: string      // current time to ensure we only look at future forecasts
): RecommendationResult | null {
  
  // Filter for future points
  const futurePoints = dataPoints.filter(p => {
      // open-meteo hourly.time returns like "2026-10-09T00:00"
      return p.time >= currentTimeStr.substring(0, 16); 
  });

  if (futurePoints.length === 0) return null;

  // Determine how many hours we need based on duration
  const requiredHours = durationMinutes <= 60 ? 1 : Math.ceil(durationMinutes / 60);
  
  let bestWindow: DataPoint[] | null = null;
  let bestScore = Infinity;

  // Find best window in the preferred time range
  for (let i = 0; i <= futurePoints.length - requiredHours; i++) {
    const window = futurePoints.slice(i, i + requiredHours);
    
    // Check if window is completely within preferred range
    const windowStart = window[0].time;
    const windowEnd = window[window.length - 1].time;
    
    if (windowStart >= preferredStartTime && windowEnd <= preferredEndTime) {
      // Valid window. Calculate avg score
      let totalScore = 0;
      let hasNull = false;
      for (const p of window) {
        if (p.score === null) {
          hasNull = true;
          break;
        }
        totalScore += p.score;
      }
      
      if (!hasNull) {
        const avgScore = totalScore / requiredHours;
        if (avgScore < bestScore) {
          bestScore = avgScore;
          bestWindow = window;
        }
      }
    }
  }

  // If no window found in preferred range, find best overall future window
  let fallbackWindow: DataPoint[] | null = null;
  let fallbackScore = Infinity;
  
  if (!bestWindow) {
      for (let i = 0; i <= futurePoints.length - requiredHours; i++) {
        const window = futurePoints.slice(i, i + requiredHours);
        let totalScore = 0;
        let hasNull = false;
        for (const p of window) {
          if (p.score === null) {
            hasNull = true;
            break;
          }
          totalScore += p.score;
        }
        
        if (!hasNull) {
          const avgScore = totalScore / requiredHours;
          if (avgScore < fallbackScore) {
            fallbackScore = avgScore;
            fallbackWindow = window;
          }
        }
      }
  }

  const finalWindow = bestWindow || fallbackWindow;
  const finalScore = bestWindow ? bestScore : fallbackScore;

  if (!finalWindow) return null; // No valid data at all

  // Calculate the score of the originally preferred time if it was exactly the required length
  // For simplicity, we just find the first available window in the preferred time to act as original
  let originalWindow: DataPoint[] | null = null;
  let originalScore: number | null = null;

  const originalStartIdx = futurePoints.findIndex(p => p.time >= preferredStartTime);
  if (originalStartIdx !== -1 && originalStartIdx + requiredHours <= futurePoints.length) {
      const w = futurePoints.slice(originalStartIdx, originalStartIdx + requiredHours);
      if (w[0].time <= preferredEndTime) {
          originalWindow = w;
          let tScore = 0;
          let nulls = false;
          for (const p of w) {
              if (p.score === null) { nulls = true; break; }
              tScore += p.score;
          }
          if (!nulls) {
              originalScore = tScore / requiredHours;
          }
      }
  }

  let message = "";
  if (bestWindow) {
      if (finalScore > 50) {
          message = "Forecasts indicate relatively high pollution even in your preferred time window. Consider an indoor alternative or wearing a mask if you proceed.";
      } else {
          message = "This is the lowest-pollution window during your preferred time. Enjoy your activity!";
      }
  } else {
      if (finalScore > 50) {
          message = "No suitable windows were found in your preferred time. We found an alternative, but pollution is still high. Consider staying indoors.";
      } else {
          message = "Your preferred time was unavailable or had missing data. We recommend this alternative time which has lower forecast pollution.";
      }
  }

  return {
    recommendedWindow: finalWindow,
    averageScore: finalScore,
    originalWindow: bestWindow ? null : originalWindow,
    originalAverageScore: bestWindow ? null : originalScore,
    message
  };
}
