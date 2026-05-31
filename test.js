const assert = require('assert');
const http = require('http');
const { calculateFlow } = require('./flowModel');

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
  console.log('===== 瓦斯抽采排水模拟系统测试 =====\n');
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

  console.log('--- 场景1: 钻孔倾角从-30°到30°变化时液位是否变化 ---');
  const resultsAngles = [];
  for (let angle = -30; angle <= 30; angle += 15) {
    const r = calculateFlow(30, angle);
    resultsAngles.push({ angle, liquidPosition: r.liquidPosition, liquidLevelHeight: r.liquidLevelHeight });
  }

  test('倾角-30°时积液位置应大于15°时积液位置（上斜积液减少）', () => {
    const rDown = calculateFlow(30, -30);
    const rUp = calculateFlow(30, 15);
    assert(rDown.liquidPosition > rUp.liquidPosition,
      `下斜积液(${rDown.liquidPosition.toFixed(2)}m)应大于上斜积液(${rUp.liquidPosition.toFixed(2)}m)`);
  });

  test('倾角30°时排水效率应大于-30°时（上斜重力助排）', () => {
    const rDown = calculateFlow(30, -30);
    const rUp = calculateFlow(30, 30);
    assert(rUp.drainageEfficiency > rDown.drainageEfficiency,
      `上斜效率(${rUp.drainageEfficiency.toFixed(1)}%)应大于下斜效率(${rDown.drainageEfficiency.toFixed(1)}%)`);
  });

  test('不同倾角下液位高度应不同', () => {
    const heights = resultsAngles.map(r => r.liquidLevelHeight.toFixed(4));
    const unique = new Set(heights);
    assert(unique.size > 1, `所有倾角液位高度相同: ${heights.join(', ')}`);
  });

  test('倾角为0时积液位置应在-30°和30°之间', () => {
    const rDown = calculateFlow(30, -30);
    const rUp = calculateFlow(30, 30);
    const rZero = calculateFlow(30, 0);
    assert(rZero.liquidPosition > rUp.liquidPosition && rZero.liquidPosition < rDown.liquidPosition,
      `0°积液(${rZero.liquidPosition.toFixed(2)}m)应在-30°(${rDown.liquidPosition.toFixed(2)}m)和30°(${rUp.liquidPosition.toFixed(2)}m)之间`);
  });

  console.log(`  倾角测试数据: ${resultsAngles.map(r => `${r.angle}°:${r.liquidPosition.toFixed(1)}m`).join(' | ')}\n`);

  console.log('--- 场景2: 负压从10到30kPa变化时排水量是否增加 ---');
  const resultsPressures = [];
  for (let p = 10; p <= 30; p += 5) {
    const r = calculateFlow(p, 15);
    resultsPressures.push({ pressure: p, drainageEfficiency: r.drainageEfficiency, liquidPosition: r.liquidPosition });
  }

  test('负压30kPa时排水效率应大于10kPa时', () => {
    const rLow = calculateFlow(10, 15);
    const rHigh = calculateFlow(30, 15);
    assert(rHigh.drainageEfficiency > rLow.drainageEfficiency,
      `30kPa效率(${rHigh.drainageEfficiency.toFixed(1)}%)应大于10kPa效率(${rLow.drainageEfficiency.toFixed(1)}%)`);
  });

  test('负压30kPa时积液位置应小于10kPa时（高负压排液更多）', () => {
    const rLow = calculateFlow(10, 15);
    const rHigh = calculateFlow(30, 15);
    assert(rHigh.liquidPosition < rLow.liquidPosition,
      `30kPa积液(${rHigh.liquidPosition.toFixed(2)}m)应小于10kPa积液(${rLow.liquidPosition.toFixed(2)}m)`);
  });

  test('负压升高时排水效率单调不减', () => {
    for (let i = 1; i < resultsPressures.length; i++) {
      const prev = resultsPressures[i - 1];
      const curr = resultsPressures[i];
      assert(curr.drainageEfficiency >= prev.drainageEfficiency - 0.1,
        `${curr.pressure}kPa效率(${curr.drainageEfficiency.toFixed(1)}%)低于${prev.pressure}kPa(${prev.drainageEfficiency.toFixed(1)}%)`);
    }
  });

  test('负压升高时积液位置单调不增', () => {
    for (let i = 1; i < resultsPressures.length; i++) {
      const prev = resultsPressures[i - 1];
      const curr = resultsPressures[i];
      assert(curr.liquidPosition <= prev.liquidPosition + 0.1,
        `${curr.pressure}kPa积液(${curr.liquidPosition.toFixed(2)}m)大于${prev.pressure}kPa(${prev.liquidPosition.toFixed(2)}m)`);
    }
  });

  console.log(`  负压测试数据: ${resultsPressures.map(r => `${r.pressure}kPa:${r.drainageEfficiency.toFixed(0)}%`).join(' | ')}\n`);

  console.log('--- 场景3: 后端排水数据是否已增加液位高度数值 ---');

  let calcResult;
  try {
    calcResult = await api('/api/calculate', 'POST', { negativePressure: 25, drillAngle: 10 });
  } catch (e) {
    console.log(`  ✗ API连接失败: ${e.message}`);
  }

  test('POST /api/calculate 应返回 liquidLevelHeight 字段', () => {
    assert(calcResult, 'API调用失败，calcResult未定义');
    assert('liquidLevelHeight' in calcResult, '响应缺少 liquidLevelHeight 字段');
    assert(typeof calcResult.liquidLevelHeight === 'number', 'liquidLevelHeight 不是数字');
    assert(calcResult.liquidLevelHeight >= 0, 'liquidLevelHeight 为负数');
  });

  test('POST /api/calculate 应返回 gasLock 和 gasLockSeverity 字段', () => {
    assert(calcResult, 'API调用失败，calcResult未定义');
    assert('gasLock' in calcResult, '响应缺少 gasLock 字段');
    assert('gasLockSeverity' in calcResult, '响应缺少 gasLockSeverity 字段');
    assert('criticalGasVelocity' in calcResult, '响应缺少 criticalGasVelocity 字段');
  });

  let paramId;
  try {
    const res = await api('/api/parameters', 'POST', { negativePressure: 25, drillAngle: 10 });
    paramId = res.id;
  } catch (e) {}

  test('POST /api/parameters 应成功保存参数', () => {
    assert(paramId > 0, '未返回参数ID');
  });

  let snapId;
  try {
    const res = await api('/api/snapshots', 'POST', {
      parameterId: paramId,
      liquidPosition: calcResult.liquidPosition,
      liquidLevelHeight: calcResult.liquidLevelHeight,
      drainageEfficiency: calcResult.drainageEfficiency,
      gasLock: calcResult.gasLock,
      gasLockSeverity: calcResult.gasLockSeverity,
      pressureDistribution: calcResult.pressureDistribution,
      gasDistribution: calcResult.gasDistribution,
      liquidDistribution: calcResult.liquidDistribution
    });
    snapId = res.id;
  } catch (e) {}

  test('POST /api/snapshots 应成功保存包含液位高度的快照', () => {
    assert(snapId > 0, '未返回快照ID');
  });

  let snapList;
  try {
    snapList = await api('/api/snapshots', 'GET');
  } catch (e) {}

  test('GET /api/snapshots 应返回包含液位高度的快照列表', () => {
    assert(Array.isArray(snapList), '返回不是数组');
    assert(snapList.length > 0, '快照列表为空');
    const latest = snapList[0];
    assert('liquid_level_height' in latest, '快照缺少 liquid_level_height 字段');
    assert(latest.liquid_level_height > 0, `液位高度为${latest.liquid_level_height}，应大于0`);
    assert('negative_pressure' in latest, '快照缺少 negative_pressure 字段（未JOIN参数表）');
    assert('drill_angle' in latest, '快照缺少 drill_angle 字段（未JOIN参数表）');
    assert('gas_lock' in latest, '快照缺少 gas_lock 字段');
  });

  test('液位高度数值范围应合理 (0 ~ 管径0.1m)', () => {
    assert(Array.isArray(snapList) && snapList.length > 0, '无快照数据');
    const latest = snapList[0];
    assert(latest.liquid_level_height >= 0 && latest.liquid_level_height <= 0.1,
      `液位高度${latest.liquid_level_height}超出合理范围(0~0.1m)`);
  });

  if (calcResult) {
    console.log(`  液位高度测试: API返回液位=${calcResult.liquidLevelHeight.toFixed(4)}m\n`);
  }

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
    console.log('\n✅ 所有测试通过！');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('测试执行异常:', e.message);
  process.exit(2);
});
