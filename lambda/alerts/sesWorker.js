const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { sendAlertEmail } = require('./emailService');
const { emitMetric } = require('./emfLogger');

const dbClient = new DynamoDBClient({});
const ALERTS_TABLE = process.env.ALERTS_TABLE_NAME || 'AirWindow-Alerts';

exports.handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      let payload;
      try {
        payload = JSON.parse(record.body);
      } catch (err) {
        console.error('Invalid message format. Dropping message.', err);
        continue; // Unrecoverable format, drop message
      }

      const { alertId, email, evalId, locationStr, thresholdDesc, forecastDesc, manageToken } = payload;
      const alertKey = marshall({ PK: `EMAIL#${email}`, SK: `ALERT#${alertId}` });

      // 1. Send the email (this is where we might get throttled by SES)
      await sendAlertEmail(email, alertId, locationStr, thresholdDesc, forecastDesc, manageToken);
      emitMetric('EmailsDelivered', 1);

      // 2. Commit delivery success to DynamoDB
      try {
        await dbClient.send(new UpdateItemCommand({
          TableName: ALERTS_TABLE,
          Key: alertKey,
          UpdateExpression: 'SET deliveryStatus = :sent, lastNotifiedAt = :nowStr REMOVE lockExpiresAt',
          // IDEMPOTENCY GUARD: Only update if this is STILL the active evaluation
          ConditionExpression: 'currentEvalId = :evalId',
          ExpressionAttributeValues: marshall({ ':sent': 'SENT', ':nowStr': new Date().toISOString(), ':evalId': evalId })
        }));
      } catch (dbErr) {
        if (dbErr.name === 'ConditionalCheckFailedException') {
          console.warn(`Idempotency check failed for evalId ${evalId}. Likely already sent or superseded.`);
        } else {
          // DB failure after successful email. Report failure so SQS retries it (at-least-once)
          emitMetric('EmailDeliveryDbFailures', 1);
          throw dbErr;
        }
      }
    } catch (err) {
      console.error(`Message processing failed for record ${record.messageId}:`, err);
      emitMetric('EmailFailures', 1);
      // Mark for retry
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  // AWS Best Practice: Return partial batch failures
  return { batchItemFailures };
};
