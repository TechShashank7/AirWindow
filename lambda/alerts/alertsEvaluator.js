const { DynamoDBClient, QueryCommand, UpdateItemCommand, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('crypto');
const { processForecastData } = require('../recommendation'); 
const { emitMetric } = require('./emfLogger');

const dbClient = new DynamoDBClient({});
const sqsClient = new SQSClient({});
const ALERTS_TABLE = process.env.ALERTS_TABLE_NAME || 'AirWindow-Alerts';
const CACHE_TABLE = process.env.CACHE_TABLE_NAME || 'AirWindow-ForecastCache';
const QUEUE_URL = process.env.ALERTS_QUEUE_URL || 'https://sqs.region.amazonaws.com/123/AirWindow-AlertsQueue';

async function fetchFromOpenMeteo(lat, lon) {
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto&forecast_days=2`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=windspeed_10m,winddirection_10m&timezone=auto&forecast_days=2`;
  
  const [aqRes, weatherRes] = await Promise.all([ fetch(aqUrl), fetch(weatherUrl) ]);
  if (!aqRes.ok || !weatherRes.ok) {
    emitMetric('UpstreamFailures', 1);
    throw new Error('Upstream failed');
  }

  const aqData = await aqRes.json();
  const weatherData = await weatherRes.json();

  if (aqData.hourly && weatherData.hourly) {
    aqData.hourly.windspeed_10m = weatherData.hourly.windspeed_10m;
    aqData.hourly.winddirection_10m = weatherData.hourly.winddirection_10m;
  }
  return aqData;
}

async function getForecast(lat, lon) {
  const cacheKey = `PROVIDER#OpenMeteo|LOC#${lat.toFixed(2)},${lon.toFixed(2)}|VARS#pm10,pm2_5,windspeed_10m,winddirection_10m`;
  let rawForecast = null;

  try {
    const cacheRes = await dbClient.send(new GetItemCommand({
      TableName: CACHE_TABLE, Key: marshall({ CacheKey: cacheKey })
    }));
    
    if (cacheRes.Item) {
      const cachedItem = unmarshall(cacheRes.Item);
      if (Date.now() < cachedItem.staleAfter) {
        emitMetric('CacheHits', 1);
        return cachedItem.rawForecast;
      }
    }
  } catch (err) {
    console.error('Cache read error:', err);
  }

  emitMetric('CacheMisses', 1);
  try {
    return await fetchFromOpenMeteo(lat, lon);
  } catch (err) {
    return null; // Safe stale rejection
  }
}

exports.handler = async () => {
  const queryRes = await dbClient.send(new QueryCommand({
    TableName: ALERTS_TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: 'GSI1PK = :status',
    ExpressionAttributeValues: marshall({ ':status': 'STATUS#ACTIVE' })
  }));
  
  const alerts = (queryRes.Items || []).map(item => unmarshall(item));
  if (alerts.length === 0) return { message: 'No active alerts.' };

  emitMetric('AlertsEvaluated', alerts.length);

  for (const alert of alerts) {
    try {
      const rawForecast = await getForecast(alert.lat, alert.lon);
      if (!rawForecast) continue; 

      const dataPoints = processForecastData(rawForecast);
      const currentTimeStr = new Date().toISOString().substring(0, 16);
      const futurePoints = dataPoints.filter(p => p.time >= currentTimeStr).slice(0, 12);
      
      let thresholdExceeded = false;
      let worstPoint = null;

      for (const p of futurePoints) {
        let valueToCheck = alert.threshold.type === 'PM25' ? p.pm25 : p.score;
        if (valueToCheck !== null && valueToCheck > alert.threshold.value) {
          thresholdExceeded = true;
          if (!worstPoint || valueToCheck > (alert.threshold.type === 'PM25' ? worstPoint.pm25 : worstPoint.score)) {
            worstPoint = p;
          }
        }
      }

      const alertKey = marshall({ PK: `EMAIL#${alert.email}`, SK: `ALERT#${alert.alertId}` });
      const nowEpoch = Math.floor(Date.now() / 1000);

      if (thresholdExceeded) {
        if (alert.isBreached && alert.deliveryStatus === 'SENT') continue;

        const evalId = crypto.randomUUID();
        
        // 1. Transactional Outbox State: Claim lock and mark ENQUEUED
        try {
          await dbClient.send(new UpdateItemCommand({
            TableName: ALERTS_TABLE, Key: alertKey,
            UpdateExpression: 'SET deliveryStatus = :pending, currentEvalId = :evalId, lockExpiresAt = :expiresAt, isBreached = :true',
            ConditionExpression: '(isBreached = :false) OR (deliveryStatus = :pending AND lockExpiresAt < :now) OR (deliveryStatus = :idle)',
            ExpressionAttributeValues: marshall({ 
              ':pending': 'ENQUEUED', ':evalId': evalId, ':expiresAt': nowEpoch + 300, 
              ':true': true, ':false': false, ':now': nowEpoch, ':idle': 'IDLE'
            })
          }));
        } catch (err) {
          continue; // Concurrency check failed (already enqueued by another worker)
        }

        // 2. Generate management token for the email
        const tokenStr = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(tokenStr).digest('hex');
        await dbClient.send(new PutItemCommand({
          TableName: ALERTS_TABLE,
          Item: marshall({ PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}`, type: 'MANAGE', email: alert.email, alertId: alert.alertId, expiresAt: nowEpoch + 2592000 })
        }));

        // 3. Enqueue to SQS
        try {
          const forecastDesc = `At ${worstPoint.time}, ${alert.threshold.type} is forecast to reach ${alert.threshold.type === 'PM25' ? worstPoint.pm25.toFixed(1) : worstPoint.score.toFixed(1)}.`;
          
          await sqsClient.send(new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
              alertId: alert.alertId,
              email: alert.email,
              evalId: evalId,
              locationStr: `${alert.lat}, ${alert.lon}`,
              thresholdDesc: `> ${alert.threshold.value} ${alert.threshold.type}`,
              forecastDesc: forecastDesc,
              manageToken: tokenStr
            })
          }));
          emitMetric('NotificationsEnqueued', 1);

        } catch (sqsErr) {
          console.error(`SQS Enqueue Failed for alert ${alert.alertId}:`, sqsErr);
          // 4. Rollback outbox state if SQS completely fails, so retry can grab it
          await dbClient.send(new UpdateItemCommand({
            TableName: ALERTS_TABLE, Key: alertKey,
            UpdateExpression: 'SET deliveryStatus = :idle REMOVE lockExpiresAt, currentEvalId',
            ExpressionAttributeValues: marshall({ ':idle': 'IDLE' })
          }));
        }

      } else {
        // Recovery transition
        if (alert.isBreached || alert.deliveryStatus !== 'IDLE') {
          await dbClient.send(new UpdateItemCommand({
            TableName: ALERTS_TABLE, Key: alertKey,
            UpdateExpression: 'SET isBreached = :false, deliveryStatus = :idle REMOVE lockExpiresAt, currentEvalId',
            ExpressionAttributeValues: marshall({ ':false': false, ':idle': 'IDLE' })
          }));
        }
      }
    } catch (err) {
      console.error(`Error evaluating alert ${alert.alertId}:`, err);
    }
  }

  return { message: 'Evaluation complete.' };
};
