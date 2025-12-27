<meta name="description" content="EmailVerify Discord Bot Statistics - Track verified users, emails sent, and server growth over time.">
<meta name="keywords" content="EmailVerify Discord Bot Statistics Analytics">

# Statistics

<style>
:root {
    --accent-gold: #f5a623;
    --bg-dark: #1a1a2e;
    --bg-card: #16213e;
    --text-primary: #e8e8e8;
    --text-muted: #8a8a9a;
    --border-glow: rgba(245, 166, 35, 0.3);
}

.stats-container {
    background: linear-gradient(135deg, var(--bg-dark) 0%, #0f0f23 100%);
    border-radius: 16px;
    padding: 32px;
    margin: 24px 0;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-bottom: 40px;
}

.stat-card {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    border: 1px solid var(--border-glow);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 32px rgba(245, 166, 35, 0.15);
}

.stat-value {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--accent-gold);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    margin-bottom: 8px;
}

.stat-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.chart-section {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
    border: 1px solid var(--border-glow);
}

.chart-title {
    color: var(--text-primary);
    font-size: 1.2rem;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(245, 166, 35, 0.2);
}

.chart-wrapper {
    position: relative;
    height: 300px;
}

.controls {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
}

.control-btn {
    background: var(--bg-card);
    border: 1px solid var(--border-glow);
    color: var(--text-muted);
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
}

.control-btn:hover, .control-btn.active {
    background: var(--accent-gold);
    color: var(--bg-dark);
    border-color: var(--accent-gold);
}

.loading {
    text-align: center;
    color: var(--text-muted);
    padding: 40px;
}

.loading-spinner {
    display: inline-block;
    width: 40px;
    height: 40px;
    border: 3px solid var(--bg-card);
    border-top-color: var(--accent-gold);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.last-updated {
    text-align: right;
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-top: 16px;
}
</style>

<div class="stats-container">
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" id="serverCount">-</div>
            <div class="stat-label">Discord Servers</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="verifiedToday">-</div>
            <div class="stat-label">Verified Today</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="verifiedAll">-</div>
            <div class="stat-label">Total Verified</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="emailsAll">-</div>
            <div class="stat-label">Emails Sent</div>
        </div>
    </div>

    <div class="controls">
        <button class="control-btn active" data-days="7">7 Days</button>
        <button class="control-btn" data-days="14">14 Days</button>
        <button class="control-btn" data-days="30">30 Days</button>
        <button class="control-btn" data-days="90">90 Days</button>
    </div>

    <div class="chart-section">
        <div class="chart-title">📊 Daily Verifications</div>
        <div class="chart-wrapper">
            <canvas id="verificationsChart"></canvas>
        </div>
    </div>

    <div class="chart-section">
        <div class="chart-title">📈 Server Growth</div>
        <div class="chart-wrapper">
            <canvas id="serversChart"></canvas>
        </div>
    </div>

    <div class="chart-section">
        <div class="chart-title">✉️ Emails Sent per Day</div>
        <div class="chart-wrapper">
            <canvas id="emailsChart"></canvas>
        </div>
    </div>

    <div class="last-updated">Last updated: <span id="lastUpdated">-</span></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
const API_BASE = 'https://emailbotstats.larskaesberg.de';

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: false
        }
    },
    scales: {
        x: {
            grid: {
                color: 'rgba(245, 166, 35, 0.1)'
            },
            ticks: {
                color: '#8a8a9a'
            }
        },
        y: {
            beginAtZero: true,
            grid: {
                color: 'rgba(245, 166, 35, 0.1)'
            },
            ticks: {
                color: '#8a8a9a'
            }
        }
    }
};

let verificationsChart, serversChart, emailsChart;
let currentDays = 7;

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function fetchCurrentStats() {
    try {
        const res = await fetch(`${API_BASE}/stats/current`);
        const data = await res.json();
        
        document.getElementById('serverCount').textContent = formatNumber(data.serverCount);
        document.getElementById('verifiedToday').textContent = formatNumber(data.usersVerifiedToday);
        document.getElementById('verifiedAll').textContent = formatNumber(data.usersVerifiedAll);
        document.getElementById('emailsAll').textContent = formatNumber(data.mailsSendAll);
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
    } catch (err) {
        console.error('Failed to fetch current stats:', err);
    }
}

async function fetchHistoryStats(days) {
    try {
        const res = await fetch(`${API_BASE}/stats/history?days=${days}`);
        return await res.json();
    } catch (err) {
        console.error('Failed to fetch history:', err);
        return [];
    }
}

function createChart(ctx, labels, data, color) {
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                borderColor: color,
                backgroundColor: color.replace('1)', '0.1)'),
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: chartOptions
    });
}

async function updateCharts(days) {
    const history = await fetchHistoryStats(days);
    
    if (history.length === 0) return;
    
    const labels = history.map(h => formatDate(h.date));
    const verifications = history.map(h => h.usersVerifiedToday);
    const servers = history.map(h => h.serverCount);
    const emails = history.map(h => h.mailsSendToday);
    
    // Destroy existing charts
    if (verificationsChart) verificationsChart.destroy();
    if (serversChart) serversChart.destroy();
    if (emailsChart) emailsChart.destroy();
    
    // Create new charts
    verificationsChart = createChart(
        document.getElementById('verificationsChart'),
        labels, verifications, 'rgba(245, 166, 35, 1)'
    );
    
    serversChart = createChart(
        document.getElementById('serversChart'),
        labels, servers, 'rgba(99, 179, 237, 1)'
    );
    
    emailsChart = createChart(
        document.getElementById('emailsChart'),
        labels, emails, 'rgba(129, 230, 217, 1)'
    );
}

// Control buttons
document.querySelectorAll('.control-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.control-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentDays = parseInt(this.dataset.days);
        updateCharts(currentDays);
    });
});

// Initial load
fetchCurrentStats();
updateCharts(currentDays);

// Auto-refresh every 30 seconds
setInterval(fetchCurrentStats, 30000);
</script>

