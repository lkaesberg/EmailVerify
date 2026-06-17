<meta name="description" content="EmailVerify Discord Bot Statistics - Track verified users, emails sent, and server growth over time.">
<meta name="keywords" content="EmailVerify Discord Bot Statistics Analytics">

# Statistics

<style>
/* Palette aligned with the EmailBot logo (blue circle + green verified
   checkmark). Neutral cool card surfaces let the brand colors do the work. */
:root {
    --accent-blue: #5865f2;   /* logo circle (Discord-blurple-adjacent) */
    --accent-green: #22c55e;  /* logo checkmark */
    --accent-teal: #0d9488;   /* supporting color for "emails" stat */
    --bg-card: #f6f8fa;
    --bg-hover: #eef2f7;
    --text-primary: #1f2937;
    --text-muted: #6b7280;
    --border-color: #d0d7de;
    --shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
    --shadow-hover: 0 4px 12px rgba(15, 23, 42, 0.10), 0 2px 4px rgba(15, 23, 42, 0.06);
}

.stats-wrapper {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 32px;
}

.stats-hero {
    display: flex;
}

.stats-hero .stat-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 32px;
}

.stats-hero .stat-value {
    font-size: 3.5rem;
}

.stats-hero .stat-label {
    font-size: 0.85rem;
}

.stats-column {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.stat-group {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 16px 20px;
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
}

.stat-group-icon {
    font-size: 1.5rem;
    opacity: 0.7;
}

.stat-group-content {
    display: flex;
    gap: 24px;
    flex: 1;
}

.stat-item {
    text-align: center;
}

.stat-card {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 20px;
    text-align: center;
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover, .stat-group:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
}

.stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent-green);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    margin-bottom: 2px;
}

.stat-value.teal { color: var(--accent-teal); }
.stat-value.blue { color: var(--accent-blue); }

.stat-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
}

@media (max-width: 600px) {
    .stats-wrapper {
        grid-template-columns: 1fr;
    }
    .stats-hero .stat-value {
        font-size: 2.5rem;
    }
    .stat-group-content {
        gap: 16px;
    }
}

.chart-section {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow);
}

.chart-title {
    color: var(--text-primary);
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-color);
}

.chart-wrapper {
    position: relative;
    height: 280px;
}

.controls {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    flex-wrap: wrap;
}

.control-btn {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s ease;
}

.control-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent-green);
    color: var(--text-primary);
}

.control-btn.active {
    background: var(--accent-green);
    color: white;
    border-color: var(--accent-green);
}

.legend {
    display: flex;
    gap: 16px;
    margin-top: 12px;
    justify-content: center;
    flex-wrap: wrap;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-muted);
}

.legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}

.legend-dot.green { background: var(--accent-green); }
.legend-dot.teal { background: var(--accent-teal); }
.legend-dot.blue { background: var(--accent-blue); }

.last-updated {
    text-align: right;
    color: var(--text-muted);
    font-size: 0.75rem;
    margin-top: 12px;
}
</style>

<div class="stats-wrapper">
    <div class="stats-hero">
        <div class="stat-card">
            <div class="stat-value blue" id="serverCount">-</div>
            <div class="stat-label">Discord Servers</div>
        </div>
    </div>
    <div class="stats-column">
        <div class="stat-group">
            <div class="stat-group-icon">✓</div>
            <div class="stat-group-content">
                <div class="stat-item">
                    <div class="stat-value" id="verifiedToday">-</div>
                    <div class="stat-label">Today</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" id="verifiedAll">-</div>
                    <div class="stat-label">All Time</div>
                </div>
            </div>
        </div>
        <div class="stat-group">
            <div class="stat-group-icon">✉</div>
            <div class="stat-group-content">
                <div class="stat-item">
                    <div class="stat-value teal" id="emailsToday">-</div>
                    <div class="stat-label">Today</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value teal" id="emailsAll">-</div>
                    <div class="stat-label">All Time</div>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="controls">
    <button class="control-btn active" data-days="7">7 Days</button>
    <button class="control-btn" data-days="14">14 Days</button>
    <button class="control-btn" data-days="30">30 Days</button>
    <button class="control-btn" data-days="90">90 Days</button>
    <button class="control-btn" data-days="all">All Time</button>
</div>

<div class="chart-section">
    <div class="chart-title">📊 Daily Activity</div>
    <div class="chart-wrapper">
        <canvas id="dailyChart"></canvas>
    </div>
    <div class="legend">
        <div class="legend-item"><span class="legend-dot green"></span> Users Verified</div>
        <div class="legend-item"><span class="legend-dot teal"></span> Emails Sent</div>
    </div>
</div>

<div class="chart-section">
    <div class="chart-title">📉 Verification Rate</div>
    <div class="chart-wrapper">
        <canvas id="verificationRateChart"></canvas>
    </div>
    <div class="legend">
        <div class="legend-item"><span class="legend-dot green"></span> Verified / Emails Sent (%)</div>
    </div>
</div>

<div class="chart-section">
    <div class="chart-title">📈 Total Users Verified</div>
    <div class="chart-wrapper">
        <canvas id="verifiedTotalChart"></canvas>
    </div>
</div>

<div class="chart-section">
    <div class="chart-title">✉️ Total Emails Sent</div>
    <div class="chart-wrapper">
        <canvas id="emailsTotalChart"></canvas>
    </div>
</div>

<div class="chart-section">
    <div class="chart-title">🌐 Server Growth</div>
    <div class="chart-wrapper">
        <canvas id="serversChart"></canvas>
    </div>
</div>

<div class="last-updated">Last updated: <span id="lastUpdated">-</span></div>

<script>
(function () {
'use strict';
const API_BASE = 'https://emailbotstats.larskaesberg.de';

// Load Chart.js on demand. With MkDocs Material's `navigation.instant`, page
// content (including this script) is re-executed after the body is swapped in,
// and a re-injected `<script src>` loads asynchronously — so `Chart` could be
// undefined the moment we first try to draw. Loading it through a tracked
// promise guarantees it's ready before `new Chart()` runs, on the first open
// and on every instant navigation alike.
function ensureChart() {
    if (window.Chart) return Promise.resolve();
    if (window.__chartLoading) return window.__chartLoading;
    window.__chartLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
    });
    return window.__chartLoading;
}

// Pull colors from Material's CSS vars so charts follow the active theme.
function getThemeColors() {
    const styles = getComputedStyle(document.body);
    return {
        text: styles.getPropertyValue('--md-default-fg-color--light').trim() || '#6b7280',
        // Neutral gridline that reads on both light and dark backgrounds.
        grid: 'rgba(128, 128, 128, 0.18)'
    };
}

function buildBaseOptions() {
    const c = getThemeColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
            x: {
                grid: { color: c.grid },
                ticks: { color: c.text }
            },
            y: {
                beginAtZero: true,
                grid: { color: c.grid },
                ticks: { color: c.text, precision: 0 }
            }
        }
    };
}

function buildAutoScaleOptions() {
    const c = getThemeColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
            x: {
                grid: { color: c.grid },
                ticks: { color: c.text }
            },
            y: {
                grid: { color: c.grid },
                ticks: { color: c.text, precision: 0 }
            }
        }
    };
}

let baseOptions = buildBaseOptions();
let autoScaleOptions = buildAutoScaleOptions();

let dailyChart, verificationRateChart, verifiedTotalChart, emailsTotalChart, serversChart;
let currentDays = 7;

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 10000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function fetchCurrentStats() {
    // The 30s refresh timer can outlive a navigation away from this page.
    if (!document.getElementById('serverCount')) return;
    try {
        const res = await fetch(`${API_BASE}/stats/current`);
        const data = await res.json();
        
        document.getElementById('serverCount').textContent = formatNumber(data.serverCount);
        document.getElementById('verifiedToday').textContent = formatNumber(data.usersVerifiedToday);
        document.getElementById('verifiedAll').textContent = formatNumber(data.usersVerifiedAll);
        document.getElementById('emailsToday').textContent = formatNumber(data.mailsSendToday);
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

function createDataset(data, color, label) {
    return {
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: color.replace('1)', '0.1)'),
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6
    };
}

async function updateCharts(days) {
    const history = await fetchHistoryStats(days);
    
    if (history.length === 0) return;
    
    const labels = history.map(h => formatDate(h.date));
    const verifiedDaily = history.map(h => h.usersVerifiedToday);
    const emailsDaily = history.map(h => h.mailsSendToday);
    const verifiedTotal = history.map(h => h.usersVerifiedAll);
    const emailsTotal = history.map(h => h.mailsSendAll);
    const servers = history.map(h => h.serverCount);
    
    // Destroy existing charts
    if (dailyChart) dailyChart.destroy();
    if (verificationRateChart) verificationRateChart.destroy();
    if (verifiedTotalChart) verifiedTotalChart.destroy();
    if (emailsTotalChart) emailsTotalChart.destroy();
    if (serversChart) serversChart.destroy();
    
    // Daily Activity Chart
    dailyChart = new Chart(document.getElementById('dailyChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                createDataset(verifiedDaily, 'rgba(34, 197, 94, 1)', 'Users Verified'),
                createDataset(emailsDaily, 'rgba(13, 148, 136, 1)', 'Emails Sent')
            ]
        },
        options: baseOptions
    });
    
    // Verification Rate Chart
    const verificationRate = history.map(h => {
        if (h.mailsSendToday === 0) return 0;
        return Math.min(((h.usersVerifiedToday / h.mailsSendToday) * 100), 100);
    });
    
    verificationRateChart = new Chart(document.getElementById('verificationRateChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                createDataset(verificationRate, 'rgba(34, 197, 94, 1)', 'Verification Rate (%)')
            ]
        },
        options: {
            ...baseOptions,
            scales: {
                ...baseOptions.scales,
                y: {
                    ...baseOptions.scales.y,
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        ...baseOptions.scales.y.ticks,
                        callback: function(value) { return value + '%'; }
                    }
                }
            },
            plugins: {
                ...baseOptions.plugins,
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
                        }
                    }
                }
            }
        }
    });
    
    // Total Users Verified Chart (auto-scale, not starting at 0)
    verifiedTotalChart = new Chart(document.getElementById('verifiedTotalChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                createDataset(verifiedTotal, 'rgba(34, 197, 94, 1)', 'Total Verified')
            ]
        },
        options: autoScaleOptions
    });
    
    // Total Emails Sent Chart (auto-scale, not starting at 0)
    emailsTotalChart = new Chart(document.getElementById('emailsTotalChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                createDataset(emailsTotal, 'rgba(13, 148, 136, 1)', 'Total Emails')
            ]
        },
        options: autoScaleOptions
    });
    
    // Server Growth Chart (auto-scale, not starting at 0)
    serversChart = new Chart(document.getElementById('serversChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                createDataset(servers, 'rgba(37, 99, 235, 1)', 'Servers')
            ]
        },
        options: autoScaleOptions
    });
}

// Control buttons. "all" passes a large number so the API returns the full
// recorded history (it caps at whatever the log file holds).
const ALL_TIME_DAYS = 99999;

function initStatsPage() {
    // This script also re-runs on pages that don't have the charts.
    if (!document.getElementById('dailyChart')) return;

    // Wire control buttons. The DOM is rebuilt on each instant navigation, so
    // attach to the fresh elements; the guard keeps a re-run from stacking
    // duplicate click handlers on the same element.
    document.querySelectorAll('.control-btn').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', function() {
            document.querySelectorAll('.control-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const raw = this.dataset.days;
            currentDays = raw === 'all' ? ALL_TIME_DAYS : parseInt(raw);
            updateCharts(currentDays);
        });
    });

    // Rebuild theme-dependent options now that the page's CSS is applied.
    baseOptions = buildBaseOptions();
    autoScaleOptions = buildAutoScaleOptions();

    fetchCurrentStats();

    // Wait for Chart.js before drawing so the very first open renders charts
    // (previously this raced the CDN load and only worked after a button click).
    ensureChart()
        .then(() => updateCharts(currentDays))
        .catch(err => console.error('Failed to load Chart.js:', err));

    // Auto-refresh every 30 seconds. Clear any timer left over from a previous
    // visit so it doesn't accumulate across instant navigations.
    if (window.__statsRefreshTimer) clearInterval(window.__statsRefreshTimer);
    window.__statsRefreshTimer = setInterval(fetchCurrentStats, 30000);
}

// Material re-executes this script after swapping in new page content, so
// running init here covers both the first open and every later navigation.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStatsPage);
} else {
    initStatsPage();
}
})();
</script>
