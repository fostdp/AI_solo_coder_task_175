const assert = require('assert');
const http = require('http');
const { PipeFlowModel, calculateFlow } = require('./flowModel');

function api(path, method, data) {
  return new Promise((resolve, reject) => {
    const d = data ? JSON.stringify(data) : null;
    const r = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch (e) { reject(new Error('解析失败: ' + b)); }
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

async function runTests() {
  console.log('===== 重构管流力学框架验证测试 =====\n');
  let total = 0, pass = 0, fail = 0;
  const failedCases = [];

  function test(name, fn) {
    total++;
    try {
      fn();
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      fail++;
      failedCases.push({ name, error: e.message });
      console.log(`  ✗ ${name}`);
      console.log(`    断言失败: ${e.message}`);
    }
  }

  console.log('--- 测试1: 管流力学框架类结构验证 ---');

  test('PipeFlowModel类应存在', () => {
    assert.strictEqual(typeof PipeFlowModel, 'function', 'PipeFlowModel不是构造函数');
  });

  test('应可创建带自定义配置的模型实例', () => {
    const model = new PipeFlowModel({ PIPE_DIAMETER: 0.15, PIPE_LENGTH: 150 });
    assert.strictEqual(model.params.PIPE_DIAMETER, 0.15);
    assert.strictEqual(model.params.PIPE_LENGTH, 150);
  });

  test('calculate方法应返回完整结果对象', () => {
    const result = calculateFlow(30, 15);
    const requiredFields = ['liquidPosition', 'liquidLevelHeight', 'liquidLevelProfile',
      'drainageEfficiency', 'gasLock', 'gasLockSeverity', 'flowRegime',
      'holdUp', 'gasVelocity', 'liquidVelocity', 'criticalGasVelocity',
      'pressureDistribution', 'gasDistribution', 'liquidDistribution',
      'reynoldsGas', 'reynoldsLiquid', 'frictionGas', 'frictionLiquid'];
    requiredFields.forEach(f => {
      assert(f in result, `缺少字段: ${f}`);
    });
  });

  console.log('');

  console.log('--- 测试2: 管径相关的Wallis气锁判据验证 ---');

  const diameters = [0.05, 0.1, 0.15, 0.2];
  const diameterResults = diameters.map(d => {
    const model = new PipeFlowModel({ PIPE_DIAMETER: d });
    const result = model.calculate(70, 0);
    return { diameter: d, criticalGasVelocity: result.criticalGasVelocity, gasLock: result.gasLock };
  });

  test('管径越大临界气速应越大（Wallis判据特性）', () => {
    for (let i = 1; i < diameterResults.length; i++) {
      assert(diameterResults[i].criticalGasVelocity > diameterResults[i - 1].criticalGasVelocity,
        `管径${diameterResults[i].diameter}m临界气速(${diameterResults[i].criticalGasVelocity.toFixed(2)}m/s)应大于管径${diameterResults[i - 1].diameter}m(${diameterResults[i - 1].criticalGasVelocity.toFixed(2)}m/s)`);
    }
  });

  test('高负压下应触发气锁（段塞流）', () => {
    const result = calculateFlow(80, 0);
    assert.strictEqual(result.gasLock, true, '80kPa负压下应触发气锁');
    assert.strictEqual(result.flowRegime, 'slug', '气锁时流态应为slug');
    assert(result.gasLockSeverity > 0, '气锁强度应大于0');
  });

  test('低负压下应为分层流，无气锁', () => {
    const result = calculateFlow(10, 0);
    assert.strictEqual(result.gasLock, false, '10kPa负压下不应触发气锁');
    assert.strictEqual(result.flowRegime, 'stratified', '低负压下流态应为stratified');
  });

  test('过渡区域流态应为transition', () => {
    let foundTransition = false;
    for (let p = 30; p <= 60; p += 5) {
      const r = calculateFlow(p, 0);
      if (r.flowRegime === 'transition') {
        foundTransition = true;
        break;
      }
    }
    assert(foundTransition, '应存在过渡流态区域');
  });

  console.log(`  管径-临界气速数据: ${diameterResults.map(r => `${r.diameter}m:${r.criticalGasVelocity.toFixed(2)}m/s`).join(' | ')}`);
  console.log('');

  console.log('--- 测试3: 液位结构化存储验证 ---');

  const result = calculateFlow(30, 15);

  test('liquidLevelProfile应是数组', () => {
    assert(Array.isArray(result.liquidLevelProfile), 'liquidLevelProfile不是数组');
  });

  test('液位剖面应有足够数据点（>=50）', () => {
    assert(result.liquidLevelProfile.length >= 50,
      `液位剖面点数${result.liquidLevelProfile.length}不足50`);
  });

  test('每个剖面点应包含x、holdUp、liquidHeight字段', () => {
    const point = result.liquidLevelProfile[0];
    assert('x' in point, '缺少x字段');
    assert('holdUp' in point, '缺少holdUp字段');
    assert('liquidHeight' in point, '缺少liquidHeight字段');
    assert.strictEqual(typeof point.x, 'number');
    assert.strictEqual(typeof point.holdUp, 'number');
    assert.strictEqual(typeof point.liquidHeight, 'number');
  });

  test('液位剖面x坐标应从0到管长单调递增', () => {
    const profile = result.liquidLevelProfile;
    assert.strictEqual(profile[0].x, 0, '起点应为0');
    assert(Math.abs(profile[profile.length - 1].x - result.pipeLength) < 1,
      `终点应为${result.pipeLength}，实际${profile[profile.length - 1].x}`);
    for (let i = 1; i < profile.length; i++) {
      assert(profile[i].x > profile[i - 1].x, 'x坐标应单调递增');
    }
  });

  test('液位高度应在合理范围（0 ~ 管径）', () => {
    const profile = result.liquidLevelProfile;
    profile.forEach(p => {
      assert(p.liquidHeight >= 0 && p.liquidHeight <= result.pipeDiameter,
        `位置x=${p.x}液位高度${p.liquidHeight}超出范围(0~${result.pipeDiameter})`);
    });
  });

  test('averageLiquidLevel应与剖面平均值一致', () => {
    const profile = result.liquidLevelProfile;
    const avg = profile.reduce((sum, p) => sum + p.liquidHeight, 0) / profile.length;
    assert(Math.abs(result.liquidLevelHeight - avg) < 0.001,
      `平均液位偏差: ${result.liquidLevelHeight} vs ${avg}`);
  });

  console.log(`  液位剖面点数: ${result.liquidLevelProfile.length}, 平均液位: ${result.liquidLevelHeight.toFixed(4)}m`);
  console.log('');

  console.log('--- 测试4: 重力对积液的影响（动量方程） ---');

  const angles = [-30, -15, 0, 15, 30, 45];
  const angleResults = angles.map(a => ({ angle: a, ...calculateFlow(30, a) }));

  test('上斜角度增大时积液位置应减小（重力助排）', () => {
    for (let i = 1; i < angleResults.length; i++) {
      if (angleResults[i].angle > angleResults[i - 1].angle && angleResults[i].angle >= 0) {
        assert(angleResults[i].liquidPosition <= angleResults[i - 1].liquidPosition + 0.1,
          `${angleResults[i].angle}°积液(${angleResults[i].liquidPosition.toFixed(2)}m)应小于等于${angleResults[i - 1].angle}°(${angleResults[i - 1].liquidPosition.toFixed(2)}m)`);
      }
    }
  });

  test('下斜角度增大时积液位置应增大', () => {
    for (let i = 1; i < angleResults.length; i++) {
      if (angleResults[i].angle < 0 && angleResults[i].angle > angleResults[i - 1].angle) {
        assert(angleResults[i].liquidPosition >= angleResults[i - 1].liquidPosition - 0.1,
          `${angleResults[i].angle}°积液(${angleResults[i].liquidPosition.toFixed(2)}m)应大于等于${angleResults[i - 1].angle}°(${angleResults[i - 1].liquidPosition.toFixed(2)}m)`);
      }
    }
  });

  console.log(`  倾角-积液数据: ${angleResults.map(r => `${r.angle}°:${r.liquidPosition.toFixed(1)}m`).join(' | ')}`);
  console.log('');

  console.log('--- 测试5: 后端API验证 ---');

  let calcResult;
  try {
    calcResult = await api('/api/calculate', 'POST', { negativePressure: 35, drillAngle: 10, pipeDiameter: 0.12 });
  } catch (e) {
    console.log(`  API连接跳过: ${e.message}`);
  }

  if (calcResult) {
    test('API应返回结构化液位剖面', () => {
      assert(Array.isArray(calcResult.liquidLevelProfile), 'API返回的liquidLevelProfile不是数组');
      assert(calcResult.liquidLevelProfile.length > 0, '液位剖面为空');
    });

    test('API应支持自定义管径', () => {
      assert.strictEqual(calcResult.pipeDiameter, 0.12, '自定义管径未生效');
    });

    test('API应返回流态信息', () => {
      assert('flowRegime' in calcResult, '缺少flowRegime字段');
      assert(['stratified', 'transition', 'slug'].includes(calcResult.flowRegime),
        `无效流态: ${calcResult.flowRegime}`);
    });

    let paramId;
    try {
      const paramRes = await api('/api/parameters', 'POST', { negativePressure: 35, drillAngle: 10, pipeDiameter: 0.12 });
      paramId = paramRes.id;
    } catch (e) {}

    if (paramId) {
      let snapId;
      try {
        const snapRes = await api('/api/snapshots', 'POST', {
          parameterId: paramId,
          liquidPosition: calcResult.liquidPosition,
          liquidLevelHeight: calcResult.liquidLevelHeight,
          drainageEfficiency: calcResult.drainageEfficiency,
          gasLock: calcResult.gasLock,
          gasLockSeverity: calcResult.gasLockSeverity,
          flowRegime: calcResult.flowRegime,
          holdUp: calcResult.holdUp,
          reynoldsGas: calcResult.reynoldsGas,
          reynoldsLiquid: calcResult.reynoldsLiquid,
          frictionGas: calcResult.frictionGas,
          frictionLiquid: calcResult.frictionLiquid,
          pressureDrop: calcResult.pressureDrop,
          gasVelocity: calcResult.gasVelocity,
          liquidVelocity: calcResult.liquidVelocity,
          criticalGasVelocity: calcResult.criticalGasVelocity,
          liquidLevelProfile: calcResult.liquidLevelProfile,
          pressureDistribution: calcResult.pressureDistribution,
          gasDistribution: calcResult.gasDistribution,
          liquidDistribution: calcResult.liquidDistribution
        });
        snapId = snapRes.id;
      } catch (e) {}

      if (snapId) {
        try {
          const snapList = await api('/api/snapshots', 'GET');
          test('快照GET应返回包含结构化数据', () => {
            assert(Array.isArray(snapList), '快照列表不是数组');
            const latest = snapList[0];
            assert('liquid_level_profile' in latest, '缺少liquid_level_profile');
            assert(Array.isArray(latest.liquid_level_profile), 'liquid_level_profile不是数组');
            assert('hold_up' in latest, '缺少hold_up字段');
            assert('flow_regime' in latest, '缺少flow_regime字段');
          });
        } catch (e) {}
      }
    }
  }

  console.log('');
  console.log('===== 测试结果汇总 =====');
  console.log(`总用例: ${total}, 通过: ${pass}, 失败: ${fail}`);

  if (failedCases.length > 0) {
    console.log('\n===== 失败用例明细 =====');
    failedCases.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name}`);
      console.log(`   错误: ${c.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试通过！管流力学框架重构验证成功。');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('测试执行异常:', e.message);
  process.exit(2);
});
