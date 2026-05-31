const canvas = document.getElementById('simulationCanvas');
const ctx = canvas.getContext('2d');

const pressureSlider = document.getElementById('pressureSlider');
const angleSlider = document.getElementById('angleSlider');
const diameterSlider = document.getElementById('diameterSlider');
const speedSlider = document.getElementById('speedSlider');
const pressureValue = document.getElementById('pressureValue');
const angleValue = document.getElementById('angleValue');
const diameterValue = document.getElementById('diameterValue');
const speedValue = document.getElementById('speedValue');
const realtimeBtn = document.getElementById('realtimeBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const saveBtn = document.getElementById('saveBtn');
const optimizeBtn = document.getElementById('optimizeBtn');
const snapshotList = document.getElementById('snapshotList');
const connectionStatus = document.getElementById('connectionStatus');

let negativePressure = 30;
let drillAngle = 15;
let pipeDiameter = 0.1;
let animationSpeed = 1;
let isRunning = false;
let isRealtimeMode = false;
let animationId = null;
let currentResult = null;
let currentAnalysis = null;
let currentParameterId = null;
let time = 0;
let bubbles = [];
let droplets = [];
let flowHistory = [];

const PIPE_LENGTH = 100;
const CANVAS_PADDING = 50;
const PIPE_START_X = CANVAS_PADDING;
const PIPE_END_X = canvas.width - CANVAS_PADDING;
const PIPE_CENTER_Y = canvas.height / 2;
const PIPE_WIDTH = PIPE_END_X - PIPE_START_X;
const PIPE_HEIGHT = 60;

let ws = null;
let trendChart = null;
let profileChart = null;

function initCharts() {
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '液位高度 (m)',
                data: [],
                borderColor: '#1E90FF',
                backgroundColor: 'rgba(30, 144, 255, 0.1)',
                fill: true,
                tension: 0.4
            }, {
                label: '排水效率 (%)',
                data: [],
                borderColor: '#FF6347',
                backgroundColor: 'rgba(255, 99, 71, 0.1)',
                fill: true,
                tension: 0.4,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 0.1,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#fff' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: { display: false },
                    ticks: { color: '#fff' }
                },
                x: {
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#fff', maxTicksLimit: 10 }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#fff' }
                }
            }
        }
    });

    const profileCtx = document.getElementById('profileChart').getContext('2d');
    profileChart = new Chart(profileCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '液位剖面',
                data: [],
                borderColor: '#1E90FF',
                backgroundColor: 'rgba(30, 144, 255, 0.3)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 0.1,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#fff' },
                    title: { display: true, text: '液位 (m)', color: '#fff' }
                },
                x: {
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#fff', maxTicksLimit: 10 },
                    title: { display: true, text: '钻孔深度 (m)', color: '#fff' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#fff' }
                }
            }
        }
    });
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WebSocket已连接');
        connectionStatus.textContent = '在线';
        connectionStatus.className = 'status-online';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = () => {
        console.log('WebSocket已断开');
        connectionStatus.textContent = '离线';
        connectionStatus.className = 'status-offline';
        if (isRealtimeMode) {
            setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'update':
            currentResult = data.flowResult;
            currentAnalysis = data.analysis;
            flowHistory = data.history || flowHistory;
            updateResultsDisplay();
            updateAnalysisDisplay();
            updateCharts();
            if (isRealtimeMode && !isRunning) {
                isRunning = true;
                animate();
            }
            break;
        case 'status':
            if (!data.running) {
                isRunning = false;
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
            }
            break;
        case 'initial':
            if (data.data) {
                currentResult = data.data.flowResult;
                flowHistory = data.data.flowHistory || [];
                updateResultsDisplay();
                updateCharts();
            }
            break;
    }
}

function startRealtimeMode() {
    if (isRealtimeMode) return;
    
    isRealtimeMode = true;
    realtimeBtn.classList.add('active');
    realtimeBtn.textContent = '实时模式';
    connectWebSocket();
    
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'start_simulation',
            params: { negativePressure, drillAngle, pipeDiameter }
        }));
    } else {
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: 'start_simulation',
                params: { negativePressure, drillAngle, pipeDiameter }
            }));
        };
    }
}

function stopRealtimeMode() {
    isRealtimeMode = false;
    realtimeBtn.classList.remove('active');
    realtimeBtn.textContent = '实时模式';
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop_simulation' }));
        ws.close();
    }
    
    isRunning = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

pressureSlider.addEventListener('input', (e) => {
    negativePressure = parseFloat(e.target.value);
    pressureValue.textContent = negativePressure;
    if (isRealtimeMode && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_params',
            params: { negativePressure }
        }));
    } else if (isRunning) {
        calculateAndUpdate();
    }
});

angleSlider.addEventListener('input', (e) => {
    drillAngle = parseFloat(e.target.value);
    angleValue.textContent = drillAngle;
    if (isRealtimeMode && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_params',
            params: { drillAngle }
        }));
    } else if (isRunning) {
        calculateAndUpdate();
    }
});

diameterSlider.addEventListener('input', (e) => {
    pipeDiameter = parseFloat(e.target.value);
    diameterValue.textContent = pipeDiameter.toFixed(2);
    if (isRealtimeMode && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'update_params',
            params: { pipeDiameter }
        }));
    } else if (isRunning) {
        calculateAndUpdate();
    }
});

speedSlider.addEventListener('input', (e) => {
    animationSpeed = parseFloat(e.target.value);
    speedValue.textContent = animationSpeed.toFixed(1);
});

realtimeBtn.addEventListener('click', () => {
    if (isRealtimeMode) {
        stopRealtimeMode();
    } else {
        startRealtimeMode();
    }
});

startBtn.addEventListener('click', () => {
    if (isRealtimeMode) {
        stopRealtimeMode();
    }
    if (!isRunning) {
        isRunning = true;
        saveParameters();
        calculateAndUpdate();
        animate();
    }
});

pauseBtn.addEventListener('click', () => {
    if (isRealtimeMode) {
        stopRealtimeMode();
    }
    isRunning = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
});

saveBtn.addEventListener('click', () => {
    if (currentResult && currentParameterId) {
        saveSnapshot();
    }
});

optimizeBtn.addEventListener('click', () => {
    showOptimizationModal();
});

async function saveParameters() {
    try {
        const response = await fetch('/api/parameters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ negativePressure, drillAngle, pipeDiameter })
        });
        const data = await response.json();
        currentParameterId = data.id;
    } catch (err) {
        console.error('保存参数失败:', err);
    }
}

async function calculateAndUpdate() {
    try {
        const response = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ negativePressure, drillAngle, pipeDiameter })
        });
        const data = await response.json();
        currentResult = data;
        currentAnalysis = data.analysis;
        
        flowHistory.push({
            timestamp: Date.now(),
            liquidLevelHeight: data.liquidLevelHeight,
            drainageEfficiency: data.drainageEfficiency
        });
        if (flowHistory.length > 30) flowHistory.shift();
        
        updateResultsDisplay();
        updateAnalysisDisplay();
        updateCharts();
    } catch (err) {
        console.error('计算失败:', err);
    }
}

async function saveSnapshot() {
    try {
        await fetch('/api/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parameterId: currentParameterId,
                liquidPosition: currentResult.liquidPosition,
                liquidLevelHeight: currentResult.liquidLevelHeight,
                drainageEfficiency: currentResult.drainageEfficiency,
                gasLock: currentResult.gasLock,
                gasLockSeverity: currentResult.gasLockSeverity,
                flowRegime: currentResult.flowRegime,
                holdUp: currentResult.holdUp,
                reynoldsGas: currentResult.reynoldsGas,
                reynoldsLiquid: currentResult.reynoldsLiquid,
                frictionGas: currentResult.frictionGas,
                frictionLiquid: currentResult.frictionLiquid,
                pressureDrop: currentResult.pressureDrop,
                gasVelocity: currentResult.gasVelocity,
                liquidVelocity: currentResult.liquidVelocity,
                criticalGasVelocity: currentResult.criticalGasVelocity,
                liquidLevelProfile: currentResult.liquidLevelProfile,
                pressureDistribution: currentResult.pressureDistribution,
                gasDistribution: currentResult.gasDistribution,
                liquidDistribution: currentResult.liquidDistribution
            })
        });
        loadSnapshots();
    } catch (err) {
        console.error('保存快照失败:', err);
    }
}

async function loadSnapshots() {
    try {
        const response = await fetch('/api/snapshots');
        const snapshots = await response.json();
        displaySnapshots(snapshots);
    } catch (err) {
        console.error('加载快照失败:', err);
    }
}

function displaySnapshots(snapshots) {
    snapshotList.innerHTML = '';
    snapshots.forEach(snapshot => {
        const item = document.createElement('div');
        item.className = 'snapshot-item';
        const gasLockText = snapshot.gas_lock
            ? `<span style="color:#ff4444;">气锁 (${(snapshot.gas_lock_severity * 100).toFixed(0)}%)</span>`
            : '<span style="color:#44ff44;">正常</span>';
        const regimeText = snapshot.flow_regime || '未知';
        const regimeColor = regimeText === 'slug' ? '#ff8800' : regimeText === 'transition' ? '#ffaa00' : '#44ff44';
        item.innerHTML = `
            <p><strong>${snapshot.negative_pressure ? snapshot.negative_pressure.toFixed(1) : '--'} kPa / ${snapshot.drill_angle ? snapshot.drill_angle.toFixed(1) : '--'}°</strong></p>
            <p>管径: ${snapshot.pipe_diameter ? snapshot.pipe_diameter.toFixed(3) : '0.100'} m</p>
            <p>积液位置: ${snapshot.liquid_position.toFixed(1)} m</p>
            <p>液位高度: ${snapshot.liquid_level_height.toFixed(4)} m</p>
            <p>持液率: ${(snapshot.hold_up * 100).toFixed(1)}%</p>
            <p>排水效率: ${snapshot.drainage_efficiency.toFixed(1)}%</p>
            <p>流态: <span style="color:${regimeColor};">${regimeText}</span></p>
            <p>状态: ${gasLockText}</p>
            <p class="time">${new Date(snapshot.created_at).toLocaleString()}</p>
        `;
        snapshotList.appendChild(item);
    });
}

function updateResultsDisplay() {
    if (!currentResult) return;
    document.getElementById('liquidPosition').textContent = currentResult.liquidPosition.toFixed(2);
    document.getElementById('liquidLevelHeight').textContent = currentResult.liquidLevelHeight.toFixed(4);
    document.getElementById('drainageEfficiency').textContent = currentResult.drainageEfficiency.toFixed(1);
    document.getElementById('gasVelocity').textContent = currentResult.gasVelocity.toFixed(2);
    document.getElementById('criticalGasVelocity').textContent = currentResult.criticalGasVelocity.toFixed(2);
    document.getElementById('liquidVelocity').textContent = currentResult.liquidVelocity.toFixed(2);
    document.getElementById('pressureDrop').textContent = currentResult.pressureDrop.toFixed(0);
    document.getElementById('holdUp').textContent = (currentResult.holdUp * 100).toFixed(1);
    document.getElementById('flowRegime').textContent = currentResult.flowRegime;
    
    const lockEl = document.getElementById('gasLockStatus');
    if (currentResult.gasLock) {
        lockEl.innerHTML = `<span style="color:#ff4444;">⚠ 气锁 (${(currentResult.gasLockSeverity * 100).toFixed(0)}%)</span>`;
    } else {
        lockEl.innerHTML = '<span style="color:#44ff44;">正常</span>';
    }
    
    const statusEl = document.getElementById('systemStatus');
    if (currentAnalysis) {
        const statusClass = `system-status-${currentAnalysis.status}`;
        statusEl.innerHTML = `<span class="${statusClass}">${getStatusText(currentAnalysis.status)}</span>`;
    }
}

function getStatusText(status) {
    const map = {
        'normal': '正常',
        'caution': '注意',
        'warning': '警告',
        'critical': '严重'
    };
    return map[status] || status;
}

function updateAnalysisDisplay() {
    const riskListEl = document.getElementById('riskList');
    const suggestionListEl = document.getElementById('suggestionList');
    
    if (!currentAnalysis) {
        riskListEl.innerHTML = '<p style="color:#888;">暂无分析数据</p>';
        suggestionListEl.innerHTML = '';
        return;
    }
    
    if (currentAnalysis.risks && currentAnalysis.risks.length > 0) {
        riskListEl.innerHTML = currentAnalysis.risks.map(risk => `
            <div class="risk-item risk-${risk.level}">
                <strong>${risk.type === 'gas_lock' ? '⚠️ ' : ''}${risk.message}</strong>
                ${risk.value !== undefined ? `<br>当前值: ${risk.value.toFixed(2)} / 阈值: ${risk.threshold}` : ''}
            </div>
        `).join('');
    } else {
        riskListEl.innerHTML = '<p style="color:#44ff44;">✓ 无风险告警</p>';
    }
    
    if (currentAnalysis.suggestions && currentAnalysis.suggestions.length > 0) {
        suggestionListEl.innerHTML = currentAnalysis.suggestions.map(sug => `
            <div class="suggestion-item">
                <span class="priority priority-${sug.priority}">${sug.priority === 'high' ? '高' : sug.priority === 'medium' ? '中' : '低'}</span>
                <strong>${sug.action}</strong><br>
                ${sug.description}
            </div>
        `).join('');
    } else {
        suggestionListEl.innerHTML = '';
    }
}

function updateCharts() {
    if (!currentResult) return;
    
    if (flowHistory.length > 0 && trendChart) {
        const labels = flowHistory.map((h, i) => i + 1);
        trendChart.data.labels = labels;
        trendChart.data.datasets[0].data = flowHistory.map(h => h.liquidLevelHeight);
        trendChart.data.datasets[1].data = flowHistory.map(h => h.drainageEfficiency);
        trendChart.update('none');
    }
    
    if (currentResult.liquidLevelProfile && profileChart) {
        const profile = currentResult.liquidLevelProfile;
        profileChart.data.labels = profile.map(p => p.x.toFixed(0));
        profileChart.data.datasets[0].data = profile.map(p => p.liquidHeight);
        profileChart.update('none');
    }
}

async function showOptimizationModal() {
    const modal = document.getElementById('optimizationModal');
    const resultsEl = document.getElementById('optimizationResults');
    
    resultsEl.innerHTML = '<p>正在计算优化方案...</p>';
    modal.style.display = 'flex';
    
    try {
        const response = await fetch(`/api/optimize?currentPressure=${negativePressure}&currentAngle=${drillAngle}&targetEfficiency=70`);
        const data = await response.json();
        
        let html = `<div class="optimization-item recommended">
            <h4>当前工况</h4>
            <p>负压: <span class="value">${data.current.pressure} kPa</span></p>
            <p>倾角: <span class="value">${data.current.angle}°</span></p>
            <p>效率: <span class="value">${data.current.efficiency.toFixed(1)}%</span></p>
        </div>`;
        
        if (data.recommended) {
            html += `<div class="optimization-item recommended">
                <h4>✓ 推荐方案</h4>
                <p>负压: <span class="value">${data.recommended.pressure} kPa</span></p>
                <p>倾角: <span class="value">${data.recommended.angle}°</span></p>
                <p>效率: <span class="value">${data.recommended.efficiency.toFixed(1)}%</span></p>
                <p>流态: <span class="value">${data.recommended.flowRegime}</span></p>
                <p>气锁风险: <span class="value" style="color:${data.recommended.gasLock ? '#ff4444' : '#44ff44'}">${data.recommended.gasLock ? '是' : '否'}</span></p>
            </div>`;
        } else {
            html += `<div class="optimization-item">
                <h4 style="color:#ff8800;">未找到满足目标效率的可行方案</h4>
                <p>建议降低目标效率或扩大参数范围</p>
            </div>`;
        }
        
        if (data.alternatives && data.alternatives.length > 0) {
            html += `<h4 style="margin:15px 0 10px;color:#00d4ff;">备选方案</h4>`;
            data.alternatives.forEach(alt => {
                html += `<div class="optimization-item">
                    <p>负压: <span class="value">${alt.pressure} kPa</span> | 倾角: <span class="value">${alt.angle}°</span> | 效率: <span class="value">${alt.efficiency.toFixed(1)}%</span></p>
                </div>`;
            });
        }
        
        resultsEl.innerHTML = html;
    } catch (err) {
        resultsEl.innerHTML = '<p style="color:#ff4444;">计算失败</p>';
        console.error(err);
    }
}

window.closeOptimizationModal = function() {
    document.getElementById('optimizationModal').style.display = 'none';
};

function createBubble() {
    if (!currentResult) return;
    const startX = PIPE_START_X + Math.random() * PIPE_WIDTH * 0.3;
    const isLock = currentResult.gasLock;
    bubbles.push({
        x: startX,
        y: PIPE_CENTER_Y + (Math.random() - 0.5) * PIPE_HEIGHT * (isLock ? 0.9 : 0.6),
        radius: (isLock ? 3 : 2) + Math.random() * (isLock ? 8 : 4),
        speed: currentResult.gasVelocity * 0.5 + Math.random() * (isLock ? 5 : 2),
        wobble: Math.random() * Math.PI * 2,
        wobbleAmp: isLock ? 3 : 0.5
    });
}

function createDroplet() {
    if (!currentResult) return;
    const liquidX = PIPE_START_X + (currentResult.liquidPosition / PIPE_LENGTH) * PIPE_WIDTH;
    droplets.push({
        x: liquidX + (Math.random() - 0.5) * 30,
        y: PIPE_CENTER_Y + PIPE_HEIGHT / 2 - 10,
        radius: 3 + Math.random() * 5,
        speed: currentResult.liquidVelocity * 0.3 + Math.random() * 1,
        falling: false
    });
}

function updateParticles() {
    if (!currentResult) return;
    
    time += 0.016 * animationSpeed;
    
    if (Math.random() < 0.1 * animationSpeed) {
        createBubble();
    }
    
    if (Math.random() < 0.05 * animationSpeed) {
        createDroplet();
    }
    
    bubbles = bubbles.filter(bubble => {
        bubble.x += bubble.speed * animationSpeed;
        bubble.wobble += 0.1 * animationSpeed;
        bubble.y += Math.sin(bubble.wobble) * (bubble.wobbleAmp || 0.5);
        return bubble.x < PIPE_END_X + 20;
    });
    
    droplets = droplets.filter(droplet => {
        if (!droplet.falling && Math.random() < 0.02 * animationSpeed) {
            droplet.falling = true;
        }
        if (droplet.falling) {
            droplet.y += droplet.speed * 2 * animationSpeed;
        }
        droplet.x -= droplet.speed * 0.5 * animationSpeed;
        return droplet.y < canvas.height + 20 && droplet.x > PIPE_START_X - 20;
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawCoalSeam();
    drawDrillHole();
    
    if (currentResult) {
        drawFluidDistribution();
        drawPressureGraph();
        drawParticles();
        drawGasLockIndicator();
    }
    
    drawLabels();
}

function drawCoalSeam() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#3d2817');
    gradient.addColorStop(0.5, '#5c3d2e');
    gradient.addColorStop(1, '#3d2817');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const size = 2 + Math.random() * 8;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawDrillHole() {
    const angleRad = drillAngle * Math.PI / 180;
    const pipeTopY = PIPE_CENTER_Y - PIPE_HEIGHT / 2;
    const pipeBottomY = PIPE_CENTER_Y + PIPE_HEIGHT / 2;
    
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(PIPE_START_X, pipeTopY - 10);
    ctx.lineTo(PIPE_END_X, pipeTopY - 10 + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.lineTo(PIPE_END_X, pipeBottomY + 10 + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.lineTo(PIPE_START_X, pipeBottomY + 10);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(PIPE_START_X, pipeTopY);
    ctx.lineTo(PIPE_END_X, pipeTopY + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.lineTo(PIPE_END_X, pipeBottomY + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.lineTo(PIPE_START_X, pipeBottomY);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PIPE_START_X, pipeTopY);
    ctx.lineTo(PIPE_END_X, pipeTopY + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(PIPE_START_X, pipeBottomY);
    ctx.lineTo(PIPE_END_X, pipeBottomY + Math.tan(angleRad) * PIPE_WIDTH);
    ctx.stroke();
}

function drawFluidDistribution() {
    if (!currentResult) return;
    
    const angleRad = drillAngle * Math.PI / 180;
    const pipeTopY = PIPE_CENTER_Y - PIPE_HEIGHT / 2;
    const pipeBottomY = PIPE_CENTER_Y + PIPE_HEIGHT / 2;
    const liquidX = PIPE_START_X + (currentResult.liquidPosition / PIPE_LENGTH) * PIPE_WIDTH;

    if (currentResult.gasLock) {
        const slugCount = 6;
        const slugWidth = (PIPE_END_X - PIPE_START_X) / slugCount;
        for (let i = 0; i < slugCount; i++) {
            const isGasSlug = (i + Math.floor(time * 2)) % 2 === 0;
            const sx = PIPE_START_X + i * slugWidth;
            const ex = sx + slugWidth;
            const syT = pipeTopY + Math.tan(angleRad) * (sx - PIPE_START_X);
            const eyT = pipeTopY + Math.tan(angleRad) * (ex - PIPE_START_X);
            const syB = pipeBottomY + Math.tan(angleRad) * (sx - PIPE_START_X);
            const eyB = pipeBottomY + Math.tan(angleRad) * (ex - PIPE_START_X);
            if (isGasSlug) {
                const g = ctx.createLinearGradient(sx, syT, ex, eyB);
                g.addColorStop(0, 'rgba(255, 99, 71, 0.6)');
                g.addColorStop(1, 'rgba(255, 69, 0, 0.7)');
                ctx.fillStyle = g;
            } else {
                const g = ctx.createLinearGradient(sx, syT, ex, eyB);
                g.addColorStop(0, 'rgba(30, 144, 255, 0.85)');
                g.addColorStop(1, 'rgba(0, 80, 180, 0.9)');
                ctx.fillStyle = g;
            }
            ctx.beginPath();
            ctx.moveTo(sx, syT);
            ctx.lineTo(ex, eyT);
            ctx.lineTo(ex, eyB);
            ctx.lineTo(sx, syB);
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(PIPE_START_X, pipeTopY - 10);
        ctx.lineTo(PIPE_END_X, pipeTopY + Math.tan(angleRad) * PIPE_WIDTH - 10);
        ctx.stroke();
        ctx.setLineDash([]);
    } else {
        const liquidGradient = ctx.createLinearGradient(liquidX, pipeTopY, PIPE_END_X, pipeBottomY);
        liquidGradient.addColorStop(0, 'rgba(30, 144, 255, 0.8)');
        liquidGradient.addColorStop(1, 'rgba(0, 100, 200, 0.9)');
        
        ctx.fillStyle = liquidGradient;
        ctx.beginPath();
        ctx.moveTo(liquidX, pipeTopY + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.lineTo(PIPE_END_X, pipeTopY + Math.tan(angleRad) * PIPE_WIDTH);
        ctx.lineTo(PIPE_END_X, pipeBottomY + Math.tan(angleRad) * PIPE_WIDTH);
        ctx.lineTo(liquidX, pipeBottomY + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.closePath();
        ctx.fill();
        
        const gasGradient = ctx.createLinearGradient(PIPE_START_X, pipeTopY, liquidX, pipeBottomY);
        gasGradient.addColorStop(0, 'rgba(255, 99, 71, 0.3)');
        gasGradient.addColorStop(1, 'rgba(255, 165, 0, 0.2)');
        
        ctx.fillStyle = gasGradient;
        ctx.beginPath();
        ctx.moveTo(PIPE_START_X, pipeTopY);
        ctx.lineTo(liquidX, pipeTopY + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.lineTo(liquidX, pipeBottomY + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.lineTo(PIPE_START_X, pipeBottomY);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(liquidX, pipeTopY - 20 + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.lineTo(liquidX, pipeBottomY + 20 + Math.tan(angleRad) * (liquidX - PIPE_START_X));
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#00ff88';
        ctx.font = '12px Arial';
        ctx.fillText('积液面', liquidX - 20, pipeTopY - 30 + Math.tan(angleRad) * (liquidX - PIPE_START_X));
    }
}

function drawPressureGraph() {
    if (!currentResult) return;
    
    const graphWidth = 180;
    const graphHeight = 100;
    const graphX = canvas.width - graphWidth - 20;
    const graphY = 20;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(graphX, graphY, graphWidth, graphHeight);
    
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(graphX, graphY, graphWidth, graphHeight);
    
    const pressures = currentResult.pressureDistribution;
    const maxPressure = Math.max(...pressures.map(p => p.pressure));
    
    ctx.strokeStyle = '#ff6347';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    pressures.forEach((point, i) => {
        const x = graphX + (i / (pressures.length - 1)) * graphWidth;
        const y = graphY + graphHeight - (point.pressure / maxPressure) * (graphHeight - 20) - 10;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    ctx.fillStyle = '#fff';
    ctx.font = '11px Arial';
    ctx.fillText('压力分布', graphX + 5, graphY + 15);
}

function drawParticles() {
    bubbles.forEach(bubble => {
        const gradient = ctx.createRadialGradient(bubble.x, bubble.y, 0, bubble.x, bubble.y, bubble.radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 99, 71, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 99, 71, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
        ctx.fill();
    });
    
    droplets.forEach(droplet => {
        const gradient = ctx.createRadialGradient(droplet.x, droplet.y, 0, droplet.x, droplet.y, droplet.radius);
        gradient.addColorStop(0, 'rgba(135, 206, 250, 0.9)');
        gradient.addColorStop(1, 'rgba(30, 144, 255, 0.7)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(droplet.x, droplet.y, droplet.radius, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawGasLockIndicator() {
    if (!currentResult || !currentResult.gasLock) return;
    
    const flashAlpha = 0.3 + 0.3 * Math.sin(Date.now() * 0.005);
    ctx.fillStyle = `rgba(255, 50, 50, ${flashAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ff3333';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ 气锁发生 ⚠', canvas.width / 2, 40);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#ff6666';
    ctx.fillText(`气锁强度: ${(currentResult.gasLockSeverity * 100).toFixed(0)}%`, canvas.width / 2, 65);
    ctx.textAlign = 'left';
}

function drawLabels() {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('钻孔入口', PIPE_START_X, PIPE_CENTER_Y + PIPE_HEIGHT / 2 + 30);
    ctx.fillText('钻孔出口', PIPE_END_X - 60, PIPE_CENTER_Y + PIPE_HEIGHT / 2 + 30 + Math.tan(drillAngle * Math.PI / 180) * PIPE_WIDTH);
    
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(`倾角: ${drillAngle}° | 管径: ${pipeDiameter.toFixed(2)}m`, PIPE_START_X + 20, PIPE_CENTER_Y - PIPE_HEIGHT / 2 - 20);
}

function animate() {
    if (!isRunning) return;
    
    updateParticles();
    draw();
    animationId = requestAnimationFrame(animate);
}

initCharts();
loadSnapshots();
draw();
