class DrainageAnalyzer {
    constructor() {
        this.history = [];
        this.maxHistory = 100;
    }

    analyze(flowResult, params) {
        const { negativePressure, drillAngle } = params;
        const {
            liquidPosition,
            liquidLevelHeight,
            drainageEfficiency,
            gasLock,
            gasLockSeverity,
            flowRegime,
            holdUp,
            liquidLevelProfile,
            pressureDistribution,
            criticalGasVelocity,
            gasVelocity
        } = flowResult;

        const risks = this.assessRisks(flowResult, params);
        const suggestions = this.generateSuggestions(flowResult, params, risks);
        const metrics = this.calculateMetrics(flowResult, params);

        this.history.push({
            timestamp: Date.now(),
            liquidPosition,
            liquidLevelHeight,
            drainageEfficiency,
            negativePressure,
            drillAngle
        });

        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        return {
            risks,
            suggestions,
            metrics,
            trend: this.calculateTrend(),
            status: this.determineStatus(risks)
        };
    }

    assessRisks(flowResult, params) {
        const risks = [];
        const { negativePressure, drillAngle } = params;
        const {
            liquidPosition,
            gasLock,
            gasLockSeverity,
            flowRegime,
            holdUp,
            drainageEfficiency,
            gasVelocity,
            criticalGasVelocity
        } = flowResult;

        if (gasLock) {
            risks.push({
                level: 'critical',
                type: 'gas_lock',
                message: '发生气锁，排水效率严重下降',
                value: gasLockSeverity,
                threshold: 0.3
            });
        }

        if (flowRegime === 'transition') {
            risks.push({
                level: 'warning',
                type: 'flow_transition',
                message: '流态接近气锁临界值，需密切关注',
                value: gasLockSeverity,
                threshold: 0.15
            });
        }

        if (holdUp > 0.6) {
            risks.push({
                level: 'warning',
                type: 'high_holdup',
                message: '持液率过高，存在积液堵塞风险',
                value: holdUp,
                threshold: 0.6
            });
        }

        if (drainageEfficiency < 30 && !gasLock) {
            risks.push({
                level: 'warning',
                type: 'low_efficiency',
                message: '排水效率偏低，建议调整抽采参数',
                value: drainageEfficiency,
                threshold: 30
            });
        }

        if (liquidPosition < 30) {
            risks.push({
                level: 'warning',
                type: 'deep_liquid',
                message: '积液位置较深，可能影响抽采效果',
                value: liquidPosition,
                threshold: 30
            });
        }

        if (drillAngle < -10) {
            risks.push({
                level: 'warning',
                type: 'downward_angle',
                message: '下斜角度过大，重力排液困难',
                value: drillAngle,
                threshold: -10
            });
        }

        return risks;
    }

    generateSuggestions(flowResult, params, risks) {
        const suggestions = [];
        const { negativePressure, drillAngle } = params;
        const {
            gasLock,
            gasLockSeverity,
            flowRegime,
            drainageEfficiency,
            holdUp,
            criticalGasVelocity,
            gasVelocity
        } = flowResult;

        if (gasLock) {
            suggestions.push({
                priority: 'high',
                category: 'gas_lock',
                action: '降低抽采负压',
                description: `当前气相速度${gasVelocity.toFixed(1)}m/s超过临界气速${criticalGasVelocity.toFixed(1)}m/s，建议将负压降至${Math.max(10, negativePressure - 20)}kPa以下`,
                targetPressure: Math.max(10, negativePressure - 20)
            });

            suggestions.push({
                priority: 'high',
                category: 'gas_lock',
                action: '考虑采用间歇抽采',
                description: '气锁严重时建议采用间歇抽采方式，周期性降低压力排出积液'
            });
        }

        if (flowRegime === 'transition') {
            suggestions.push({
                priority: 'medium',
                category: 'optimization',
                action: '微调抽采参数',
                description: `当前接近气锁临界，建议降低负压5-10kPa或调整钻孔倾角增加上斜角度`,
                targetPressure: negativePressure - 5
            });
        }

        if (!gasLock && drainageEfficiency < 50) {
            const suggestedPressure = Math.min(80, negativePressure + 10);
            if (suggestedPressure < criticalGasVelocity * 10 - 50) {
                suggestions.push({
                    priority: 'medium',
                    category: 'efficiency',
                    action: '提高抽采负压',
                    description: `当前排水效率${drainageEfficiency.toFixed(1)}%偏低，建议提高负压至${suggestedPressure}kPa以增强排液能力`,
                    targetPressure: suggestedPressure
                });
            }
        }

        if (drillAngle < 5 && !gasLock) {
            suggestions.push({
                priority: 'medium',
                category: 'design',
                action: '优化钻孔倾角',
                description: `上斜角度较小，建议调整至5°-15°以利用重力助排，预计可提升效率${Math.max(5, (5 - drillAngle) * 2).toFixed(0)}%`,
                targetAngle: Math.min(30, Math.max(drillAngle + 10, 5))
            });
        }

        if (holdUp > 0.4 && !gasLock) {
            suggestions.push({
                priority: 'low',
                category: 'maintenance',
                action: '考虑排水作业',
                description: `持液率${(holdUp * 100).toFixed(1)}%偏高，建议定期进行人工排水维护`
            });
        }

        if (risks.length === 0 && drainageEfficiency > 70) {
            suggestions.push({
                priority: 'low',
                category: 'maintenance',
                action: '维持当前参数',
                description: '当前工况良好，排水效率较高，建议维持现有抽采参数'
            });
        }

        return suggestions.sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    }

    calculateMetrics(flowResult, params) {
        const {
            liquidPosition,
            liquidLevelHeight,
            drainageEfficiency,
            gasVelocity,
            liquidVelocity,
            holdUp,
            pressureDrop,
            pipeLength,
            pipeDiameter
        } = flowResult;
        const { negativePressure } = params;

        return {
            specificEnergyConsumption: (negativePressure * 1000) / Math.max(1, drainageEfficiency),
            liquidRemovalRate: liquidVelocity * Math.PI * pipeDiameter * pipeDiameter / 4 * holdUp,
            relativeLiquidPosition: liquidPosition / pipeLength,
            pressureGradient: pressureDrop / pipeLength,
            flowStabilityIndex: this.calculateStabilityIndex(flowResult),
            comprehensiveScore: this.calculateComprehensiveScore(flowResult, params)
        };
    }

    calculateStabilityIndex(flowResult) {
        const { flowRegime, gasLockSeverity, holdUp } = flowResult;
        let score = 100;
        if (flowRegime === 'slug') score -= 50;
        if (flowRegime === 'transition') score -= 20;
        score -= gasLockSeverity * 30;
        score -= Math.max(0, (holdUp - 0.3) * 50);
        return Math.max(0, score);
    }

    calculateComprehensiveScore(flowResult, params) {
        const { drainageEfficiency, gasLock, holdUp } = flowResult;
        const { negativePressure } = params;

        let score = drainageEfficiency * 0.5;
        if (gasLock) score -= 30;
        score -= holdUp * 20;
        score -= negativePressure * 0.3;
        return Math.max(0, Math.min(100, score));
    }

    calculateTrend() {
        if (this.history.length < 5) return null;

        const recent = this.history.slice(-5);
        const older = this.history.slice(-10, -5);

        if (older.length === 0) return null;

        const avgRecent = recent.reduce((sum, h) => sum + h.liquidLevelHeight, 0) / recent.length;
        const avgOlder = older.reduce((sum, h) => sum + h.liquidLevelHeight, 0) / older.length;
        const change = avgRecent - avgOlder;

        return {
            liquidLevelTrend: change > 0.001 ? 'rising' : change < -0.001 ? 'falling' : 'stable',
            changeRate: change,
            dataPoints: this.history.length
        };
    }

    determineStatus(risks) {
        const criticalCount = risks.filter(r => r.level === 'critical').length;
        const warningCount = risks.filter(r => r.level === 'warning').length;

        if (criticalCount > 0) return 'critical';
        if (warningCount > 1) return 'warning';
        if (warningCount === 1) return 'caution';
        return 'normal';
    }
}

module.exports = DrainageAnalyzer;
