---
title: EmailVerify Statistics — Live Discord Bot Usage
description: Live usage statistics for the EmailVerify Discord bot, with servers running it, members verified and verification emails delivered, plus history charts.
---

# Statistics

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
const API_BASE = 'https://stats.getemailverified.com';

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

    // Repaint when the palette toggle flips. Chart.js bakes tick and gridline
    // colours in at construction time, so the options have to be rebuilt and
    // the charts redrawn; `ev:scheme-change` comes from javascripts/extra.js.
    // Registered once per full page load — initStatsPage re-runs on every
    // instant navigation and must not stack duplicate listeners.
    if (!window.__statsSchemeListener) {
        window.__statsSchemeListener = true;
        document.addEventListener('ev:scheme-change', function () {
            if (!document.getElementById('dailyChart')) return;
            baseOptions = buildBaseOptions();
            autoScaleOptions = buildAutoScaleOptions();
            updateCharts(currentDays);
        });
    }

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
