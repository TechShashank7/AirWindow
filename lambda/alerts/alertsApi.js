const { DynamoDBClient, TransactWriteItemsCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('crypto');
const { generateToken, sendVerificationEmail } = require('./emailService');

const dbClient = new DynamoDBClient({});
const ALERTS_TABLE = process.env.ALERTS_TABLE_NAME || 'AirWindow-Alerts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(body) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// CREATE ALERT
async function createAlert(body) {
  const { email, latitude, longitude, timezone, thresholdType, thresholdValue } = body;
  
  // Validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond(400, { error: 'Invalid email' });
  const lat = Number(latitude); const lon = Number(longitude); const val = Number(thresholdValue);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return respond(400, { error: 'Invalid latitude' });
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return respond(400, { error: 'Invalid longitude' });
  if (thresholdType !== 'PM25' && thresholdType !== 'SCORE') return respond(400, { error: 'Invalid thresholdType' });
  if (!Number.isFinite(val) || val <= 0) return respond(400, { error: 'Invalid thresholdValue' });

  const alertId = crypto.randomUUID();
  const alertItem = {
    PK: `EMAIL#${email}`, SK: `ALERT#${alertId}`,
    GSI1PK: 'STATUS#PENDING', GSI1SK: `ALERT#${alertId}`,
    status: 'PENDING', alertId, email, lat, lon, timezone,
    threshold: { type: thresholdType, value: val },
    isBreached: false, 
    deliveryStatus: 'IDLE', // State machine: IDLE -> PENDING -> SENT
    createdAt: new Date().toISOString()
  };

  const { token, hash } = generateToken();
  const tokenItem = {
    PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}`,
    type: 'VERIFY', email, alertId, expiresAt: Math.floor(Date.now() / 1000) + 86400
  };

  try {
    await dbClient.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: ALERTS_TABLE,
            Key: marshall({ PK: `EMAIL#${email}`, SK: 'PROFILE' }),
            UpdateExpression: 'SET activeAlertCount = if_not_exists(activeAlertCount, :zero) + :one',
            ConditionExpression: 'attribute_not_exists(activeAlertCount) OR activeAlertCount < :max',
            ExpressionAttributeValues: marshall({ ':zero': 0, ':one': 1, ':max': 3 })
          }
        },
        { Put: { TableName: ALERTS_TABLE, Item: marshall(alertItem, { removeUndefinedValues: true }) } },
        { Put: { TableName: ALERTS_TABLE, Item: marshall(tokenItem, { removeUndefinedValues: true }) } }
      ]
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException' && err.message.includes('ConditionalCheckFailed')) {
      return respond(403, { error: 'Maximum of 3 alerts allowed per email address.' });
    }
    throw err;
  }

  await sendVerificationEmail(email, token);
  return respond(201, { message: 'Alert created. Please check your email to verify.', alertId });
}

// VERIFY ALERT
async function verifyAlert(body) {
  const { token } = body;
  if (!token) return respond(400, { error: 'Token is required' });

  const hash = hashToken(token);
  const tokenRes = await dbClient.send(new GetItemCommand({
    TableName: ALERTS_TABLE, Key: marshall({ PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}` })
  }));

  if (!tokenRes.Item) return respond(404, { error: 'Invalid or expired token' });
  const tokenData = unmarshall(tokenRes.Item);
  if (tokenData.expiresAt * 1000 < Date.now()) return respond(400, { error: 'Token expired' });
  if (tokenData.type !== 'VERIFY') return respond(400, { error: 'Invalid token type' });

  try {
    await dbClient.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Delete: {
            TableName: ALERTS_TABLE,
            Key: marshall({ PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}` }),
            ConditionExpression: 'attribute_exists(PK)'
          }
        },
        {
          Update: {
            TableName: ALERTS_TABLE,
            Key: marshall({ PK: `EMAIL#${tokenData.email}`, SK: `ALERT#${tokenData.alertId}` }),
            UpdateExpression: 'SET #status = :s, GSI1PK = :gsi',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':s': 'ACTIVE', ':gsi': 'STATUS#ACTIVE' })
          }
        }
      ]
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return respond(400, { error: 'Token already consumed' });
    throw err;
  }

  return respond(200, { message: 'Alert verified and activated.' });
}

// MANAGE ALERT
async function manageAlert(body) {
  const { token, action } = body;
  if (!token || !['LIST', 'PAUSE', 'RESUME', 'DELETE'].includes(action)) return respond(400, { error: 'Invalid request' });

  const hash = hashToken(token);
  const tokenRes = await dbClient.send(new GetItemCommand({
    TableName: ALERTS_TABLE, Key: marshall({ PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}` })
  }));

  if (!tokenRes.Item) return respond(404, { error: 'Invalid or expired token' });
  const tokenData = unmarshall(tokenRes.Item);
  if (tokenData.type !== 'MANAGE') return respond(400, { error: 'Invalid token type' });

  const alertKey = marshall({ PK: `EMAIL#${tokenData.email}`, SK: `ALERT#${tokenData.alertId}` });
  
  if (action === 'LIST') {
    const alertRes = await dbClient.send(new GetItemCommand({ TableName: ALERTS_TABLE, Key: alertKey }));
    if (!alertRes.Item) return respond(404, { error: 'Alert not found' });
    const alert = unmarshall(alertRes.Item);
    return respond(200, { alertId: alert.alertId, status: alert.status, threshold: alert.threshold, lat: alert.lat, lon: alert.lon });
  }

  if (action === 'DELETE') {
    await dbClient.send(new TransactWriteItemsCommand({
      TransactItems: [
        { Delete: { TableName: ALERTS_TABLE, Key: alertKey } },
        {
          Update: {
            TableName: ALERTS_TABLE, Key: marshall({ PK: `EMAIL#${tokenData.email}`, SK: 'PROFILE' }),
            UpdateExpression: 'SET activeAlertCount = activeAlertCount - :one',
            ExpressionAttributeValues: marshall({ ':one': 1 })
          }
        },
        { Delete: { TableName: ALERTS_TABLE, Key: marshall({ PK: `TOKEN#${hash}`, SK: `TOKEN#${hash}` }) } }
      ]
    }));
    return respond(200, { message: 'Alert deleted' });
  }

  const newStatus = action === 'PAUSE' ? 'PAUSED' : 'ACTIVE';
  await dbClient.send(new UpdateItemCommand({
    TableName: ALERTS_TABLE, Key: alertKey,
    UpdateExpression: 'SET #status = :s, GSI1PK = :gsi',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: marshall({ ':s': newStatus, ':gsi': `STATUS#${newStatus}` })
  }));

  return respond(200, { message: `Alert updated to ${newStatus}` });
}

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return respond(204, {});
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  try {
    if (method === 'POST') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      if (path === '/alerts/create') return await createAlert(body);
      if (path === '/alerts/verify') return await verifyAlert(body);
      if (path === '/alerts/manage') return await manageAlert(body);
    }
    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('API Error:', err);
    return respond(500, { error: 'Internal Server Error' });
  }
};
