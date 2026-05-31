const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const db = require('./database');
const { PipeFlowModel, calculateFlow } = require('./flowModel');
const DrainageAnalyzer = require('./analyzer');

const app = express();
const PORT = 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const analyzer = new DrainageAnalyzer();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const connectedClients = new Set();
let realtimeData = null;
let simulationInterval = null;
let isSimulationRunning = false;

wss.on('connection', (ws) => {
    console.log('WebSocket客户端已连接');
    connectedClients.add(ws);

    if (realtimeData) {
        ws.send(JSON.stringify({ type: 'initial', data: realtimeData }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(ws, data);
        } catch (e) {
            console.error('消息解析失败:', e);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket客户端已断开');
        connectedClients.delete(ws);
        if (connectedClients.size === 0) {
            stopSimulation();
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
        connectedClients.delete(ws);
    });
});

function handleClientMessage(ws, data) {
    switch (data.type) {
        case 'start_simulation':
            startSimulation(data.params);
            break;
        case 'stop_simulation':
            stopSimulation();
            break;
        case 'update_params':
            if (isSimulationRunning) {
                realtimeData.params = { ...realtimeData.params, ...data.params };
            }
            break;
        default:
            break;
    }
}

function startSimulation(params) {
    if (isSimulationRunning) return;

    isSimulationRunning = true;
    realtimeData = {
        params: {
            negativePressure: params.negativePressure || 30,
            drillAngle: params.drillAngle || 15,
            pipeDiameter: params.pipeDiameter || 0.1,
            pipeLength: params.pipeLength || 100
        },
        flowHistory: [],
        analysis: null,
        timestamp: Date.now()
    };

    console.log('启动实时模拟:', realtimeData.params);
    broadcast({ type: 'status', running: true });

    simulationInterval = setInterval(() => {
        updateSimulation();
    }, 1000);
}

function stopSimulation() {
    isSimulationRunning = false;
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    console.log('停止实时模拟');
    broadcast({ type: 'status', running: false });
}

function updateSimulation() {
    if (!realtimeData) return;

    const { negativePressure, drillAngle, pipeDiameter, pipeLength } = realtimeData.params;
    const noise = {
        pressure: (Math.random() - 0.5) * 2,
        angle: (Math.random() - 0.5) * 0.5
    };

    let flowResult;
    if (pipeDiameter !== 0.1 || pipeLength !== 100) {
        const model = new PipeFlowModel({ PIPE_DIAMETER: pipeDiameter, PIPE_LENGTH: pipeLength });
        flowResult = model.calculate(
            Math.max(5, Math.min(80, negativePressure + noise.pressure)),
            Math.max(-10, Math.min(45, drillAngle + noise.angle))
        );
    } else {
        flowResult = calculateFlow(
            Math.max(5, Math.min(80, negativePressure + noise.pressure)),
            Math.max(-10, Math.min(45, drillAngle + noise.angle))
        );
    }

    const analysis = analyzer.analyze(flowResult, realtimeData.params);

    realtimeData.flowHistory.push({
        timestamp: Date.now(),
        liquidLevelHeight: flowResult.liquidLevelHeight,
        liquidPosition: flowResult.liquidPosition,
        drainageEfficiency: flowResult.drainageEfficiency,
        negativePressure: realtimeData.params.negativePressure
    });

    if (realtimeData.flowHistory.length > 60) {
        realtimeData.flowHistory.shift();
    }

    realtimeData.flowResult = flowResult;
    realtimeData.analysis = analysis;
    realtimeData.timestamp = Date.now();

    broadcast({
        type: 'update',
        flowResult,
        analysis,
        history: realtimeData.flowHistory.slice(-30),
        params: realtimeData.params
    });
}

function broadcast(message) {
    const data = JSON.stringify(message);
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

app.post('/api/calculate', (req, res) => {
    const { negativePressure, drillAngle, pipeDiameter, pipeLength } = req.body;
    let result;
    if (pipeDiameter || pipeLength) {
        const config = {};
        if (pipeDiameter) config.PIPE_DIAMETER = pipeDiameter;
        if (pipeLength) config.PIPE_LENGTH = pipeLength;
        const model = new PipeFlowModel(config);
        result = model.calculate(negativePressure, drillAngle);
    } else {
        result = calculateFlow(negativePressure, drillAngle);
    }

    const analysis = analyzer.analyze(result, { negativePressure, drillAngle });
    res.json({ ...result, analysis });
});

app.post('/api/analyze', (req, res) => {
    const { flowResult, params } = req.body;
    const analysis = analyzer.analyze(flowResult, params);
    res.json(analysis);
});

app.get('/api/optimize', (req, res) => {
    const { currentPressure, currentAngle, targetEfficiency = 70 } = req.query;
    const suggestions = generateOptimizationSuggestions(
        parseFloat(currentPressure),
        parseFloat(currentAngle),
        parseFloat(targetEfficiency)
    );
    res.json(suggestions);
});

function generateOptimizationSuggestions(currentPressure, currentAngle, targetEfficiency) {
    const scenarios = [];

    for (let p = Math.max(10, currentPressure - 20); p <= Math.min(80, currentPressure + 20); p += 5) {
        for (let a = Math.max(-10, currentAngle - 20); a <= Math.min(45, currentAngle + 20); a += 5) {
            const result = calculateFlow(p, a);
            scenarios.push({
                pressure: p,
                angle: a,
                efficiency: result.drainageEfficiency,
                gasLock: result.gasLock,
                flowRegime: result.flowRegime,
                liquidPosition: result.liquidPosition
            });
        }
    }

    const validScenarios = scenarios.filter(s => !s.gasLock && s.efficiency >= targetEfficiency)
        .sort((a, b) => a.pressure - b.pressure);

    const best = validScenarios.length > 0 ? validScenarios[0] : null;

    return {
        current: {
            pressure: currentPressure,
            angle: currentAngle,
            efficiency: calculateFlow(currentPressure, currentAngle).drainageEfficiency
        },
        recommended: best,
        alternatives: validScenarios.slice(1, 5),
        allScenarios: scenarios
    };
}

app.post('/api/parameters', (req, res) => {
    const { negativePressure, drillAngle, pipeDiameter = 0.1, pipeLength = 100 } = req.body;
    db.run(
        'INSERT INTO parameters (negative_pressure, drill_angle, pipe_diameter, pipe_length) VALUES (?, ?, ?, ?)',
        [negativePressure, drillAngle, pipeDiameter, pipeLength],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, negativePressure, drillAngle, pipeDiameter, pipeLength });
        }
    );
});

app.get('/api/parameters', (req, res) => {
    db.all('SELECT * FROM parameters ORDER BY created_at DESC LIMIT 20', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post('/api/snapshots', (req, res) => {
    const {
        parameterId, liquidPosition, liquidLevelHeight,
        drainageEfficiency, gasLock, gasLockSeverity,
        flowRegime, holdUp, reynoldsGas, reynoldsLiquid,
        frictionGas, frictionLiquid, pressureDrop,
        gasVelocity, liquidVelocity, criticalGasVelocity,
        liquidLevelProfile, pressureDistribution, gasDistribution, liquidDistribution
    } = req.body;

    db.run(
        `INSERT INTO snapshots (
            parameter_id, liquid_position, liquid_level_height,
            drainage_efficiency, gas_lock, gas_lock_severity,
            flow_regime, hold_up, reynolds_gas, reynolds_liquid,
            friction_gas, friction_liquid, pressure_drop,
            gas_velocity, liquid_velocity, critical_gas_velocity,
            liquid_level_profile, pressure_distribution, gas_distribution, liquid_distribution
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            parameterId, liquidPosition, liquidLevelHeight,
            drainageEfficiency, gasLock ? 1 : 0, gasLockSeverity,
            flowRegime, holdUp, reynoldsGas, reynoldsLiquid,
            frictionGas, frictionLiquid, pressureDrop,
            gasVelocity, liquidVelocity, criticalGasVelocity,
            JSON.stringify(liquidLevelProfile),
            JSON.stringify(pressureDistribution),
            JSON.stringify(gasDistribution),
            JSON.stringify(liquidDistribution)
        ],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID });
        }
    );
});

app.get('/api/snapshots', (req, res) => {
    db.all(
        `SELECT s.*, p.negative_pressure, p.drill_angle, p.pipe_diameter, p.pipe_length
         FROM snapshots s
         LEFT JOIN parameters p ON s.parameter_id = p.id
         ORDER BY s.created_at DESC LIMIT 20`,
        [], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows.map(row => ({
                id: row.id,
                parameter_id: row.parameter_id,
                liquid_position: row.liquid_position,
                liquid_level_height: row.liquid_level_height,
                drainage_efficiency: row.drainage_efficiency,
                gas_lock: row.gas_lock === 1,
                gas_lock_severity: row.gas_lock_severity,
                flow_regime: row.flow_regime,
                hold_up: row.hold_up,
                reynolds_gas: row.reynolds_gas,
                reynolds_liquid: row.reynolds_liquid,
                friction_gas: row.friction_gas,
                friction_liquid: row.friction_liquid,
                pressure_drop: row.pressure_drop,
                gas_velocity: row.gas_velocity,
                liquid_velocity: row.liquid_velocity,
                critical_gas_velocity: row.critical_gas_velocity,
                negative_pressure: row.negative_pressure,
                drill_angle: row.drill_angle,
                pipe_diameter: row.pipe_diameter,
                pipe_length: row.pipe_length,
                liquid_level_profile: row.liquid_level_profile ? JSON.parse(row.liquid_level_profile) : null,
                pressure_distribution: row.pressure_distribution ? JSON.parse(row.pressure_distribution) : null,
                gas_distribution: row.gas_distribution ? JSON.parse(row.gas_distribution) : null,
                liquid_distribution: row.liquid_distribution ? JSON.parse(row.liquid_distribution) : null,
                created_at: row.created_at
            })));
        }
    );
});

server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`WebSocket服务已启用`);
});
