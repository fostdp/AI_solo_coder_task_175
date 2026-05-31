class PipeFlowModel {
    constructor(config = {}) {
        this.params = {
            GAS_DENSITY: 0.716,
            LIQUID_DENSITY: 1000,
            PIPE_DIAMETER: 0.1,
            PIPE_LENGTH: 100,
            GAS_VISCOSITY: 1.8e-5,
            LIQUID_VISCOSITY: 1e-3,
            SURFACE_TENSION: 0.072,
            GRAVITY: 9.81,
            ROUGHNESS: 0.00015,
            WALLIS_COEFFICIENT: 1.0,
            ...config
        };
    }

    calculate(negativePressure, drillAngle) {
        const angleRad = drillAngle * Math.PI / 180;
        const {
            GAS_DENSITY: ρg, LIQUID_DENSITY: ρl,
            PIPE_DIAMETER: D, PIPE_LENGTH: L,
            GRAVITY: g, ROUGHNESS: ε,
            WALLIS_COEFFICIENT: Cw, SURFACE_TENSION: σ
        } = this.params;

        const jg = this.calcGasVelocity(negativePressure);
        const jl = this.calcLiquidVelocity(negativePressure);

        const Re_g = this.reynoldsNumber(jg, D, ρg, this.params.GAS_VISCOSITY);
        const Re_l = this.reynoldsNumber(jl, D, ρl, this.params.LIQUID_VISCOSITY);
        const fg = this.frictionFactor(Re_g, ε, D);
        const fl = this.frictionFactor(Re_l, ε, D);

        const gravityTerm = g * Math.sin(angleRad);
        const hydrostaticHead = (ρl - ρg) * g * Math.sin(angleRad);

        const wallisResult = this.wallisGasLockCriterion(jg, jl, ρg, ρl, D, g, Cw);
        const { isGasLock, gasLockSeverity, flowRegime } = wallisResult;

        let holdUp, pressureDrop;

        if (isGasLock) {
            const slugResult = this.slugFlowModel(jg, jl, D, g, gravityTerm, hydrostaticHead, fg, fl, ρg, ρl, gasLockSeverity);
            holdUp = slugResult.holdUp;
            pressureDrop = slugResult.pressureDrop;
        } else {
            const stratifiedResult = this.stratifiedFlowModel(jg, jl, D, g, gravityTerm, hydrostaticHead, fg, fl, ρg, ρl, angleRad, σ);
            holdUp = stratifiedResult.holdUp;
            pressureDrop = stratifiedResult.pressureDrop;
        }

        const criticalGasVelocity = this.calculateCriticalGasVelocity(ρg, ρl, D, g);
        const liquidLevelProfile = this.calculateLiquidLevelProfile(holdUp, L, D, angleRad, negativePressure);
        const liquidPosition = this.findLiquidPosition(liquidLevelProfile, L);
        const avgLiquidLevel = this.calculateAverageLiquidLevel(liquidLevelProfile);
        const drainageEfficiency = this.calculateDrainageEfficiency(negativePressure, angleRad, isGasLock, gasLockSeverity);

        const pressureDistribution = this.calculatePressureProfile(negativePressure, pressureDrop, L, hydrostaticHead, holdUp);
        const gasDistribution = this.calculateGasDistribution(liquidLevelProfile, L);
        const liquidDistribution = this.calculateLiquidDistribution(liquidLevelProfile, L);

        return {
            pipeLength: L,
            pipeDiameter: D,
            drillAngle: drillAngle,
            negativePressure: negativePressure,
            liquidPosition,
            liquidLevelHeight: avgLiquidLevel,
            liquidLevelProfile,
            drainageEfficiency,
            pressureDistribution,
            gasDistribution,
            liquidDistribution,
            gasVelocity: jg,
            liquidVelocity: jl,
            criticalGasVelocity,
            gasLock: isGasLock,
            gasLockSeverity,
            flowRegime,
            holdUp,
            pressureDrop: pressureDrop * L,
            reynoldsGas: Re_g,
            reynoldsLiquid: Re_l,
            frictionGas: fg,
            frictionLiquid: fl,
            gravityTerm,
            hydrostaticHead
        };
    }

    calcGasVelocity(negativePressure) {
        return 5 + negativePressure * 0.1;
    }

    calcLiquidVelocity(negativePressure) {
        return 0.1 + negativePressure * 0.005;
    }

    reynoldsNumber(v, D, ρ, μ) {
        return (ρ * v * D) / μ;
    }

    frictionFactor(Re, ε, D) {
        if (Re < 2000) return 64 / Re;
        const f0 = 0.02;
        let f = f0;
        for (let i = 0; i < 10; i++) {
            const lhs = 1 / Math.sqrt(Math.max(f, 1e-10));
            const rhs = -2 * Math.log10(ε / (3.7 * D) + 2.51 / (Re * Math.sqrt(Math.max(f, 1e-10))));
            f = f * 0.8 + (1 / (rhs * rhs)) * 0.2;
        }
        return Math.max(0.008, Math.min(0.1, f));
    }

    wallisGasLockCriterion(jg, jl, ρg, ρl, D, g, Cw) {
        const jgStar = Math.sqrt(ρg) * jg / Math.sqrt((ρl - ρg) * g * D);
        const jlStar = Math.sqrt(ρl) * jl / Math.sqrt((ρl - ρg) * g * D);
        const lockValue = Math.pow(jgStar, 0.5) + Math.pow(jlStar, 0.5);
        const criticalValue = 0.45 + 0.25 * Math.pow(ρl / ρg, 0.1);
        const margin = criticalValue - lockValue;

        let flowRegime, severity;
        if (margin < -0.05) {
            flowRegime = 'slug';
            severity = Math.min(1, Math.abs(margin) / 0.3);
        } else if (margin < 0.15) {
            flowRegime = 'transition';
            severity = Math.min(0.3, (0.15 - margin) / 0.2);
        } else {
            flowRegime = 'stratified';
            severity = 0;
        }

        return {
            isGasLock: margin < -0.05,
            gasLockSeverity: severity,
            flowRegime,
            jgStar,
            jlStar,
            criticalValue,
            lockValue
        };
    }

    stratifiedFlowModel(jg, jl, D, g, gravityTerm, hydrostaticHead, fg, fl, ρg, ρl, angleRad, σ) {
        const Fr = Math.sqrt((ρl - ρg) * g * D / ρg) / jg;
        let hL_D = 0.3 * (1 + Math.exp(-Fr * 2)) * (1 + 0.5 * Math.sin(-angleRad));
        hL_D = Math.max(0.01, Math.min(0.95, hL_D));

        const Ag = Math.PI * D * D / 4 * (1 - hL_D);
        const Al = Math.PI * D * D / 4 * hL_D;
        const vg = Ag > 0 ? jg * Math.PI * D * D / 4 / Ag : jg;
        const vl = Al > 0 ? jl * Math.PI * D * D / 4 / Al : jl;

        const dPdx_gravity = hydrostaticHead * hL_D;
        const dPdx_friction_gas = fg * (ρg * vg * vg / 2) * (4 / D);
        const dPdx_friction_liquid = fl * (ρl * vl * vl / 2) * (4 / D);
        const dPdx_total = dPdx_gravity + dPdx_friction_gas + dPdx_friction_liquid;

        return {
            holdUp: hL_D,
            pressureDrop: dPdx_total,
            gasArea: Ag,
            liquidArea: Al
        };
    }

    slugFlowModel(jg, jl, D, g, gravityTerm, hydrostaticHead, fg, fl, ρg, ρl, severity) {
        const hL_D = 0.4 + severity * 0.25;
        const slugFrequency = 1 + severity * 2;

        const Ag = Math.PI * D * D / 4 * (1 - hL_D);
        const Al = Math.PI * D * D / 4 * hL_D;
        const vg = Ag > 0 ? jg * Math.PI * D * D / 4 / Ag : jg;
        const vl = Al > 0 ? jl * Math.PI * D * D / 4 / Al : jl;

        const dPdx_gravity = hydrostaticHead * hL_D * 1.2;
        const dPdx_friction_gas = fg * (ρg * vg * vg / 2) * (4 / D) * 1.5;
        const dPdx_friction_liquid = fl * (ρl * vl * vl / 2) * (4 / D) * 1.5;
        const dPdx_surge = 0.5 * ρl * jg * jg * slugFrequency / D;
        const dPdx_total = dPdx_gravity + dPdx_friction_gas + dPdx_friction_liquid + dPdx_surge;

        return {
            holdUp: hL_D,
            pressureDrop: dPdx_total,
            slugFrequency,
            gasArea: Ag,
            liquidArea: Al
        };
    }

    calculateCriticalGasVelocity(ρg, ρl, D, g) {
        const v_c = 0.35 * Math.sqrt((ρl - ρg) * g * D / ρg);
        return v_c;
    }

    calculateLiquidLevelProfile(holdUp, L, D, angleRad, negativePressure) {
        const profile = [];
        const numPoints = 100;
        const gravityDrain = 0.3 * Math.sin(angleRad);
        const pressureDrain = negativePressure / 120;
        const drainFactor = Math.min(0.95, Math.max(0.05, gravityDrain + pressureDrain));

        for (let i = 0; i < numPoints; i++) {
            const x = (i / (numPoints - 1)) * L;
            const normalizedX = x / L;
            let levelFactor;
            if (normalizedX < drainFactor) {
                levelFactor = 0.05 + (normalizedX / drainFactor) * holdUp * 0.4;
            } else {
                levelFactor = holdUp * (0.4 + 0.6 * Math.pow((normalizedX - drainFactor) / (1 - drainFactor), 0.5));
            }
            profile.push({
                x,
                holdUp: Math.max(0, Math.min(0.95, levelFactor)),
                liquidHeight: levelFactor * D
            });
        }
        return profile;
    }

    findLiquidPosition(profile, L) {
        for (let i = profile.length - 1; i >= 0; i--) {
            if (profile[i].holdUp > 0.03) {
                return profile[i].x;
            }
        }
        return L;
    }

    calculateAverageLiquidLevel(profile) {
        if (!profile || profile.length === 0) return 0;
        const sum = profile.reduce((acc, p) => acc + p.liquidHeight, 0);
        return sum / profile.length;
    }

    calculatePressureProfile(negativePressure, totalPressureDrop, L, hydrostaticHead, holdUp) {
        const distribution = [];
        const numPoints = 50;
        const dPdx = totalPressureDrop / L;

        for (let i = 0; i < numPoints; i++) {
            const x = (i / (numPoints - 1)) * L;
            const pressure = Math.max(0, negativePressure * 1000 - dPdx * x);
            distribution.push({ x, pressure });
        }
        return distribution;
    }

    calculateGasDistribution(liquidLevelProfile, L) {
        return liquidLevelProfile.map(p => ({
            x: p.x,
            fraction: 1 - p.holdUp
        }));
    }

    calculateLiquidDistribution(liquidLevelProfile, L) {
        return liquidLevelProfile.map(p => ({
            x: p.x,
            fraction: p.holdUp
        }));
    }

    calculateDrainageEfficiency(negativePressure, drillAngle, isGasLock, gasLockSeverity) {
        const angleRad = drillAngle * Math.PI / 180;
        const gravityFactor = Math.sin(angleRad);

        if (isGasLock) {
            return Math.max(5, 30 * (1 - gasLockSeverity));
        }
        const baseEfficiency = (negativePressure / 60) * 100;
        const gravityBoost = gravityFactor * 25;
        return Math.min(100, Math.max(0, baseEfficiency + gravityBoost));
    }
}

const defaultModel = new PipeFlowModel();

function calculateFlow(negativePressure, drillAngle) {
    return defaultModel.calculate(negativePressure, drillAngle);
}

module.exports = {
    PipeFlowModel,
    calculateFlow,
    PIPE_LENGTH: defaultModel.params.PIPE_LENGTH,
    PIPE_DIAMETER: defaultModel.params.PIPE_DIAMETER
};
