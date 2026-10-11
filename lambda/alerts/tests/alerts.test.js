const { handler: apiHandler } = require('../alertsApi');
const { handler: evalHandler } = require('../alertsEvaluator');
const { handler: sesWorkerHandler } = require('../sesWorker');
const dbClient = require('@aws-sdk/client-dynamodb');
const sesClient = require('@aws-sdk/client-ses');
const emailService = require('../emailService');

jest.mock('@aws-sdk/client-dynamodb', () => {
  const original = jest.requireActual('@aws-sdk/client-dynamodb');
  const mockSend = jest.fn();
  return { ...original, DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })), __mockDbSend: mockSend };
});

jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn();
  return { SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })), SendEmailCommand: jest.fn(), __mockSesSend: mockSend };
});

jest.mock('@aws-sdk/client-sqs', () => {
  const mockSend = jest.fn();
  return { SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })), SendMessageCommand: jest.fn(), __mockSqsSend: mockSend };
});

const mockDbSend = require('@aws-sdk/client-dynamodb').__mockDbSend;
const mockSesSend = require('@aws-sdk/client-ses').__mockSesSend;
const mockSqsSend = require('@aws-sdk/client-sqs').__mockSqsSend;

const makeEvent = (method, path, body = null, qs = null) => ({ requestContext: { http: { method } }, rawPath: path, body: body ? JSON.stringify(body) : null, queryStringParameters: qs });

describe('Phase 2 Alerts - Detailed Tests', () => {
  beforeEach(() => {
    mockDbSend.mockReset();
    mockSesSend.mockReset();
    mockSqsSend.mockReset();
    jest.spyOn(emailService, 'generateToken').mockReturnValue({ token: '123', hash: 'abc' });
  });

  afterEach(() => { jest.restoreAllMocks(); });

  // 1. Invalid and out-of-range inputs
  test('API: Reject invalid lat/lon and email', async () => {
    let res = await apiHandler(makeEvent('POST', '/alerts/create', { email: 'invalid', latitude: 1, longitude: 1, thresholdType: 'SCORE', thresholdValue: 100 }));
    expect(res.statusCode).toBe(400); expect(JSON.parse(res.body).error).toMatch(/Invalid email/);
    
    res = await apiHandler(makeEvent('POST', '/alerts/create', { email: 'a@b.com', latitude: 100, longitude: 1, thresholdType: 'SCORE', thresholdValue: 100 }));
    expect(res.statusCode).toBe(400); expect(JSON.parse(res.body).error).toMatch(/Invalid latitude/);
  });

  // 2. Concurrent alert creation at 3-alert limit
  test('API: Concurrent creation enforces 3-alert limit via Transaction', async () => {
    const error = new Error('ConditionalCheckFailed');
    error.name = 'TransactionCanceledException';
    error.message = 'ConditionalCheckFailed';
    mockDbSend.mockRejectedValueOnce(error);

    const res = await apiHandler(makeEvent('POST', '/alerts/create', { email: 'a@b.com', latitude: 1, longitude: 1, thresholdType: 'SCORE', thresholdValue: 100 }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/Maximum of 3 alerts/);
  });

  // 3. Token reuse & concurrent verification
  test('API: Concurrent verification fails gracefully if token already consumed', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { PK: { S: 'TOKEN#abc' }, type: { S: 'VERIFY' }, expiresAt: { N: (Date.now()/1000 + 1000).toString() }, email: { S: 'a@b.com' }, alertId: { S: '1' } } });
    
    const error = new Error('TransactionCanceledException');
    error.name = 'TransactionCanceledException';
    mockDbSend.mockRejectedValueOnce(error); // Simulate delete condition failed

    const res = await apiHandler(makeEvent('POST', '/alerts/verify', { token: '123' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Token already consumed/);
  });

  // 4. Pause, resume, delete (Management actions)
  test('API: Pause and Delete alert via valid management token', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { PK: { S: 'TOKEN#abc' }, type: { S: 'MANAGE' }, expiresAt: { N: (Date.now()/1000 + 1000).toString() }, email: { S: 'a@b.com' }, alertId: { S: '1' } } });
    mockDbSend.mockResolvedValueOnce({}); // Update successful
    
    let res = await apiHandler(makeEvent('POST', '/alerts/manage', { token: '123', action: 'PAUSE' }));
    expect(res.statusCode).toBe(200);
    
    mockDbSend.mockResolvedValueOnce({ Item: { PK: { S: 'TOKEN#abc' }, type: { S: 'MANAGE' }, expiresAt: { N: (Date.now()/1000 + 1000).toString() }, email: { S: 'a@b.com' }, alertId: { S: '1' } } });
    res = await apiHandler(makeEvent('POST', '/alerts/manage', { token: '123', action: 'DELETE' }));
    expect(res.statusCode).toBe(200);
  });

  // 5. Missing / Stale forecast data handling
  test('Evaluator: Skips evaluation safely when data is stale and upstream fails', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [{ PK: { S: 'EMAIL#a@b.com' }, SK: { S: 'ALERT#1' }, email: { S: 'a@b.com' }, alertId: { S: '1' }, lat: { N: "1" }, lon: { N: "1" }, threshold: { M: { type: { S: 'SCORE' }, value: { N: "50" } } }, isBreached: { BOOL: false } }] });
    
    // Cache miss
    mockDbSend.mockResolvedValueOnce({});
    // Upstream fails
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    await evalHandler();
    // SES should not be called because forecast is unavailable
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  // 6. SQS Outbox Failure -> Rollback
  test('Evaluator: SQS failure rolls back deliveryStatus', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [{ PK: { S: 'EMAIL#a@b.com' }, SK: { S: 'ALERT#1' }, email: { S: 'a@b.com' }, alertId: { S: '1' }, lat: { N: "1" }, lon: { N: "1" }, threshold: { M: { type: { S: 'SCORE' }, value: { N: "50" } } }, isBreached: { BOOL: false } }] });
    mockDbSend.mockResolvedValueOnce({}); // Cache miss
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hourly: { time: [new Date().toISOString().substring(0, 16)], pm10: [100], pm2_5: [100] } }) });

    mockDbSend.mockResolvedValueOnce({}); // Lock success (ENQUEUED)
    mockDbSend.mockResolvedValueOnce({}); // Put token
    mockSqsSend.mockRejectedValueOnce(new Error('SQS Down')); // SQS fails
    mockDbSend.mockResolvedValueOnce({}); // Rollback to IDLE

    await evalHandler();
    const rollbackCall = mockDbSend.mock.calls[4][0].input;
    expect(rollbackCall.UpdateExpression).toMatch(/SET deliveryStatus = :idle REMOVE lockExpiresAt, currentEvalId/);
  });

  // 7. Threshold recovery
  test('Evaluator: Transitions isBreached to false upon recovery', async () => {
    mockDbSend.mockResolvedValueOnce({ Items: [{ PK: { S: 'EMAIL#a@b.com' }, SK: { S: 'ALERT#1' }, email: { S: 'a@b.com' }, alertId: { S: '1' }, lat: { N: "1" }, lon: { N: "1" }, threshold: { M: { type: { S: 'SCORE' }, value: { N: "500" } } }, isBreached: { BOOL: true } }] });
    mockDbSend.mockResolvedValueOnce({}); // Cache miss
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hourly: { time: [new Date().toISOString().substring(0, 16)], pm10: [100], pm2_5: [100] } }) });

    await evalHandler();
    const updateCall = mockDbSend.mock.calls[2][0].input;
    expect(updateCall.UpdateExpression).toMatch(/SET isBreached = :false/);
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  // 8. SES Worker Success
  test('SESWorker: Sends email and commits SENT state', async () => {
    const event = { Records: [{ body: JSON.stringify({ email: 'a@b.com', alertId: '1', evalId: 'uuid123' }) }] };
    mockSesSend.mockResolvedValueOnce({}); // SES success
    mockDbSend.mockResolvedValueOnce({}); // DB update success

    await sesWorkerHandler(event);
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const dbCall = mockDbSend.mock.calls[0][0].input;
    expect(dbCall.UpdateExpression).toMatch(/SET deliveryStatus = :sent/);
    expect(dbCall.ConditionExpression).toMatch(/currentEvalId = :evalId/);
  });

  // 9. SES Worker Crash (At-least-once delivery demo)
  test('SESWorker: SQS Retry due to DB update failure via partial batch response', async () => {
    const event = { Records: [{ messageId: 'msg-123', body: JSON.stringify({ email: 'a@b.com', alertId: '1', evalId: 'uuid123' }) }] };
    mockSesSend.mockResolvedValueOnce({}); // SES success
    mockDbSend.mockRejectedValueOnce(new Error('DynamoDB down')); // DB update crashes!

    const response = await sesWorkerHandler(event);
    
    // SES was called, but DB failed. SQS gets batchItemFailures to retry.
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'msg-123' }]);
  });

  // 10. Abandoned Lock Recovery
  test('Evaluator: State machine recovers abandoned ENQUEUED locks', async () => {
    const alertBase = { PK: { S: 'EMAIL#a@b.com' }, SK: { S: 'ALERT#1' }, email: { S: 'a@b.com' }, alertId: { S: '1' }, lat: { N: "1" }, lon: { N: "1" }, threshold: { M: { type: { S: 'SCORE' }, value: { N: "50" } } } };
    
    // Simulate an abandoned lock (lockExpiresAt was 10 mins ago)
    mockDbSend.mockResolvedValueOnce({ Items: [{ ...alertBase, isBreached: { BOOL: true }, deliveryStatus: { S: 'ENQUEUED' }, lockExpiresAt: { N: (Math.floor(Date.now()/1000) - 600).toString() } }] });
    mockDbSend.mockResolvedValueOnce({}); // Cache miss
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hourly: { time: [new Date().toISOString().substring(0, 16)], pm10: [100], pm2_5: [100] } }) });

    mockDbSend.mockResolvedValueOnce({}); // Lock recovery success
    mockDbSend.mockResolvedValueOnce({}); // Put token
    mockSqsSend.mockResolvedValueOnce({}); // SQS succeeds

    await evalHandler();
    const lockRecoveryCall = mockDbSend.mock.calls[2][0].input;
    expect(lockRecoveryCall.ConditionExpression).toMatch(/lockExpiresAt < :now/);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });
});
