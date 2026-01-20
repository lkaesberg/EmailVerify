<meta name="description" content="Status page for EmailVerify services including the mail server and bot API.">
<meta name="keywords" content="EmailVerify Status Services Health Check">

# Service Status

<style>
.status-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 24px 0;
}

.status-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  background: #fafafa;
}

.status-card h3 {
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  animation: pulse 2s infinite;
}

.status-indicator.online {
  background-color: #4caf50;
  box-shadow: 0 0 8px #4caf50;
}

.status-indicator.offline {
  background-color: #f44336;
  box-shadow: 0 0 8px #f44336;
  animation: none;
}

.status-indicator.checking {
  background-color: #ff9800;
  box-shadow: 0 0 8px #ff9800;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.status-text {
  font-size: 14px;
  color: #666;
  margin: 4px 0 0 24px;
}

.status-url {
  font-size: 12px;
  color: #888;
  margin: 8px 0 0 24px;
  font-family: monospace;
}

.last-checked {
  font-size: 12px;
  color: #999;
  margin-top: 16px;
  text-align: right;
}
</style>

<div class="status-container">
  <div class="status-card">
    <h3>
      <span id="api-indicator" class="status-indicator checking"></span>
      EmailBot API
    </h3>
    <div id="api-status" class="status-text">Checking...</div>
    <div class="status-url">https://emailbotstats.larskaesberg.de</div>
  </div>

  <div class="status-card">
    <h3>
      <span id="mail-indicator" class="status-indicator checking"></span>
      Mail Server
    </h3>
    <div id="mail-status" class="status-text">Checking...</div>
    <div class="status-url">mail.larskaesberg.de</div>
  </div>

  <div class="status-card">
    <h3>
      <span id="delivery-indicator" class="status-indicator checking"></span>
      Email Delivery
    </h3>
    <div id="delivery-status" class="status-text">Checking...</div>
    <div id="delivery-details" class="status-url"></div>
  </div>
</div>

<div id="last-checked" class="last-checked"></div>

## Service Details

| Service | Description | Endpoint |
|---------|-------------|----------|
| EmailBot API | Provides statistics and bot functionality | `emailbotstats.larskaesberg.de` |
| Mail Server | SMTP server for sending verification emails | `mail.larskaesberg.de` |
| Email Delivery | Monitors email send/verification ratio | - |

## Need Help?

If you're experiencing issues with the bot, please join our [Support Server](https://discord.com/invite/fEBSHUQXu2).

<script>
const apiIndicator = document.getElementById('api-indicator');
const apiStatus = document.getElementById('api-status');
const mailIndicator = document.getElementById('mail-indicator');
const mailStatus = document.getElementById('mail-status');
const deliveryIndicator = document.getElementById('delivery-indicator');
const deliveryStatus = document.getElementById('delivery-status');
const deliveryDetails = document.getElementById('delivery-details');
const lastChecked = document.getElementById('last-checked');

let latestStats = null;

function updateLastChecked() {
  const now = new Date();
  lastChecked.textContent = 'Last checked: ' + now.toLocaleTimeString();
}

async function checkApiStatus() {
  try {
    const response = await fetch('https://emailbotstats.larskaesberg.de/stats/current', {
      method: 'GET',
      mode: 'cors'
    });
    if (response.ok) {
      const data = await response.json();
      latestStats = data;
      apiIndicator.className = 'status-indicator online';
      apiStatus.textContent = 'Operational - Serving ' + data.serverCount + ' servers';
    } else {
      latestStats = null;
      apiIndicator.className = 'status-indicator offline';
      apiStatus.textContent = 'Degraded - HTTP ' + response.status;
    }
  } catch (error) {
    latestStats = null;
    apiIndicator.className = 'status-indicator offline';
    apiStatus.textContent = 'Offline or unreachable';
  }
}

async function checkMailStatus() {
  try {
    // Check mail server via HTTPS (if webmail is available)
    const response = await fetch('https://mail.larskaesberg.de', {
      method: 'HEAD',
      mode: 'no-cors'
    });
    // no-cors mode always returns opaque response, so we assume it's online if no network error
    mailIndicator.className = 'status-indicator online';
    mailStatus.textContent = 'Operational';
  } catch (error) {
    mailIndicator.className = 'status-indicator offline';
    mailStatus.textContent = 'Offline or unreachable';
  }
}

function checkDeliveryStatus() {
  if (!latestStats) {
    deliveryIndicator.className = 'status-indicator offline';
    deliveryStatus.textContent = 'Unable to check - API unavailable';
    deliveryDetails.textContent = '';
    return;
  }

  const emailsSent = latestStats.mailsSendToday || 0;
  const usersVerified = latestStats.usersVerifiedToday || 0;

  deliveryDetails.textContent = 'Today: ' + emailsSent + ' emails sent, ' + usersVerified + ' users verified';

  // No emails sent today
  if (emailsSent === 0) {
    deliveryIndicator.className = 'status-indicator checking';
    deliveryStatus.textContent = 'No activity - No emails sent today';
    return;
  }

  // Calculate verification rate
  const verificationRate = usersVerified / emailsSent;

  // If verification rate is below 30% and at least 5 emails sent, there might be a problem
  if (emailsSent >= 5 && verificationRate < 0.3) {
    deliveryIndicator.className = 'status-indicator offline';
    deliveryStatus.textContent = 'Potential issue - Low verification rate (' + Math.round(verificationRate * 100) + '%)';
  }
  // If verification rate is below 50% and significant volume, show warning
  else if (emailsSent >= 10 && verificationRate < 0.5) {
    deliveryIndicator.className = 'status-indicator checking';
    deliveryStatus.textContent = 'Warning - Below average verification rate (' + Math.round(verificationRate * 100) + '%)';
  }
  // All good
  else {
    deliveryIndicator.className = 'status-indicator online';
    deliveryStatus.textContent = 'Healthy - ' + Math.round(verificationRate * 100) + '% verification rate';
  }
}

async function checkAllServices() {
  await Promise.all([checkApiStatus(), checkMailStatus()]);
  checkDeliveryStatus();
  updateLastChecked();
}

// Initial check
checkAllServices();

// Refresh every 30 seconds
setInterval(checkAllServices, 30000);
</script>
