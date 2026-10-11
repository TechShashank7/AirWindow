const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

// Enforce specific region for SES (Sandbox restrictions apply per region)
const sesClient = new SESClient({ region: process.env.SES_REGION || 'ap-south-1' });
const SOURCE_EMAIL = process.env.SOURCE_EMAIL || 'alerts@airwindow.example.com';
const APP_URL = process.env.APP_URL || 'https://main.d1leswby66so0.amplifyapp.com';

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

async function sendVerificationEmail(email, token) {
  // Use URL fragment (#) so the token is never sent to the static hosting server logs.
  // The React app extracts it and securely POSTs it to the API.
  const verifyLink = `${APP_URL}/alerts/verify#token=${token}`;
  
  const params = {
    Destination: { ToAddresses: [email] },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
            <h2>Verify your AirWindow Alert</h2>
            <p>You requested a personalized air quality alert. Please click the link below to verify your email address and activate the alert.</p>
            <p><a href="${verifyLink}">Verify and Activate Alert</a></p>
            <p>This link expires in 24 hours.</p>
            <p>If you did not request this, please ignore this email.</p>
          `
        },
        Text: {
          Charset: 'UTF-8',
          Data: `Verify your AirWindow Alert by visiting this link: ${verifyLink} (Expires in 24 hours)`
        }
      },
      Subject: { Charset: 'UTF-8', Data: 'AirWindow Alert Verification' }
    },
    Source: SOURCE_EMAIL,
  };
  
  return sesClient.send(new SendEmailCommand(params));
}

async function sendAlertEmail(email, alertId, locationStr, thresholdDesc, forecastDesc, manageToken) {
  const manageLink = `${APP_URL}/alerts/manage#token=${manageToken}`;
  
  const params = {
    Destination: { ToAddresses: [email] },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: `
            <h2>AirWindow Alert Triggered</h2>
            <p>Your threshold (${thresholdDesc}) for <strong>${locationStr}</strong> is forecast to be exceeded.</p>
            <p><strong>Forecast Details:</strong> ${forecastDesc}</p>
            <br/>
            <p><em>Note: These are modelled forecasts, not ground measurements. The custom Relative Score is AirWindow's own comparative metric, not the official CPCB AQI.</em></p>
            <hr/>
            <p><a href="${manageLink}">Manage, Pause, or Unsubscribe from this Alert</a></p>
          `
        }
      },
      Subject: { Charset: 'UTF-8', Data: `AirWindow Alert: Threshold Exceeded for ${locationStr}` }
    },
    Source: SOURCE_EMAIL,
  };
  
  return sesClient.send(new SendEmailCommand(params));
}

module.exports = {
  sesClient,
  generateToken,
  sendVerificationEmail,
  sendAlertEmail
};
