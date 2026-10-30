(() => {
  'use strict';
  const F = window.Fleet;
  const h = F.h;
  const ui = { mode: 'camera', camera: 'main', filter: 'all', query: '' };
  const cameras = {
    main: { file: 'camera-main.jpg', title: '前视高清主摄', tag: 'CAM 01 · 前视融合感知' },
    left: { file: 'camera-left.jpg', title: '左后环视', tag: 'CAM 02 · 左后环视' },
    right: { file: 'camera-right.jpg', title: '右后环视', tag: 'CAM 03 · 右后环视' },
    cabin: { file: 'camera-cabin.jpg', title: '乘员舱内', tag: 'CAM 04 · 乘员舱内' }
  };
  let root;
  const current = () => F.vehicle();
  const online = vehicle => vehicle.status !== 'offline';
  const eligible = vehicle => online(vehicle) && ['waiting', 'standby'].includes(vehicle.status) && Number(vehicle.soc) >= 20;
  function plan(vehicle) {
    return F.state.plans.find(item => item.id === F.state.selectedPlan && item.vehicleId === vehicle.id && !['cancelled', 'completed'].includes(item.status)) || F.state.plans.find(item => item.vehicleId === vehicle.id && !['cancelled', 'completed'].includes(item.status));
  }
  function queueCars() {
    const ids = ['RT-021', 'RT-008', 'RT-046'];
    if (!ids.includes(F.state.selectedId)) ids.unshift(F.state.selectedId);
    return ids.map(id => F.state.vehicles.find(vehicle => vehicle.id === id)).filter(Boolean);
  }
  function group(vehicle) { return !online(vehicle) ? 'offline' : ['waiting', 'standby'].includes(vehicle.status) ? 'waiting' : 'monitor'; }
  function queueLabel(vehicle) {
    if (!online(vehicle)) return '通信超时 · 画面已离线';
    if (vehicle.remoteStopped) return '已模拟停车 · 等待恢复';
    if (vehicle.status === 'waiting' || vehicle.status === 'standby') return '等待发车确认';
    if (vehicle.remoteStarted) return '模拟行驶中';
    if (vehicle.id === 'RT-008') return '前方施工延误 +7 min';
    return F.status[vehicle.status]?.[0] || '状态监控中';
  }
  function renderQueue() {
    const query = ui.query.trim().toUpperCase();
    const items = queueCars().filter(vehicle => (ui.filter === 'all' || group(vehicle) === ui.filter) && (!query || vehicle.id.includes(query) || vehicle.plate.toUpperCase().includes(query)));
    return items.length ? items.map(vehicle => `<button class="queue-item ${vehicle.id === F.state.selectedId ? 'active' : ''}" data-action="remote-vehicle" data-id="${h(vehicle.id)}" aria-pressed="${vehicle.id === F.state.selectedId}"><div class="row between"><strong>${h(vehicle.id)}</strong><small class="${online(vehicle) ? 'blue' : 'red'}">${online(vehicle) ? `SOC ${h(vehicle.soc)}%` : '离线'}</small></div><p class="${group(vehicle) === 'waiting' ? 'amber' : group(vehicle) === 'offline' ? 'red' : ''}">${h(queueLabel(vehicle))}</p></button>`).join('') : `<div style="padding:22px 0;font-size:12px;line-height:1.8" class="muted">没有匹配的待处理车辆。<br><button class="btn subtle" style="margin-top:10px" data-action="remote-clear">显示全部</button></div>`;
  }
  function source() { return ui.mode === 'map' ? 'assets/detail-map.png' : 'assets/' + cameras[ui.camera].file; }
  function renderCamera(vehicle) {
    const p = plan(vehicle);
    const offline = !online(vehicle);
    const cameraTitle = ui.mode === 'map' ? '全局路线地图' : cameras[ui.camera].title;
    return `<section class="panel"><header class="camera-header"><div><h3><span class="${offline ? 'red' : 'green'}">●</span> ${h(vehicle.id)} · ${h(cameraTitle)} <span class="muted">${ui.mode === 'lidar' ? ' / 感知标注层' : ''}</span></h3><p>素材来源：Figma 原稿 <span class="${offline ? 'red' : 'green'}" style="margin-left:10px">${offline ? '通信离线（演示）' : '18 ms · 模拟链路'}</span></p></div><button class="icon-btn" data-action="remote-fullscreen" aria-label="放大静态画面" title="放大静态画面">⛶</button></header><div class="telemetry"><span><b class="blue">${vehicle.status === 'running' ? 'D' : 'P'}</b>　${vehicle.status === 'running' ? Number(vehicle.speed || 32).toFixed(1) : '0.0'} km/h</span><span>转向角：0.0°</span><span style="margin-left:auto">航向角：142.8° SE</span></div><div class="camera-main"><img src="${source()}" alt="${h(cameraTitle)}，原稿静态素材，非实时监控" style="${offline ? 'filter:grayscale(1);opacity:.35' : ''}">${ui.mode === 'lidar' && !offline ? `<svg viewBox="0 0 700 360" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><g fill="none" stroke="#2debc9" opacity=".7"><path d="M350 120 0 360M350 120 140 360M350 120 280 360M350 120 420 360M350 120 560 360M350 120 700 360M0 300H700M70 250H630M140 210H560"/><rect x="130" y="145" width="105" height="105" rx="3"/><rect x="450" y="165" width="90" height="80" rx="3"/></g><text x="138" y="138" fill="#3df5d1" font-size="10">OBJECT · DEMO</text><text x="458" y="158" fill="#3df5d1" font-size="10">OBJECT · DEMO</text></svg>` : ''}<div class="camera-overlay" style="${offline ? 'color:#ff6570' : ''}">${offline ? '● 通信已断开 · 保留示例画面' : vehicle.remoteStopped ? '■ 模拟停车完成' : vehicle.status === 'running' ? '● 模拟运行中' : '⌛ 等待运营员确认发车'}</div><div class="camera-simulation">静态示例素材 · 非实时视频${ui.mode === 'map' ? ' · 原稿路线示例' : ''}</div></div><div class="camera-controls"><div class="row" role="group" aria-label="画面模式">${[['camera', '▣', '摄像头'], ['lidar', '⌘', '感知标注'], ['map', '◫', '路线地图']].map(([mode, icon, label]) => `<button class="btn ${ui.mode === mode ? 'primary' : 'subtle'}" style="min-height:26px;padding:4px 8px;font-size:11px" data-action="remote-mode" data-mode="${mode}" aria-pressed="${ui.mode === mode}" title="${label}">${icon} ${label}</button>`).join('')}</div><button class="icon-btn" data-action="remote-camera" data-camera="main" aria-label="返回前视主摄" title="返回前视主摄">▦</button></div><div class="camera-thumbs">${['left', 'right', 'cabin'].map(key => `<button class="camera-thumb ${ui.camera === key && ui.mode !== 'map' ? 'active' : ''}" data-action="remote-camera" data-camera="${key}" aria-label="查看${cameras[key].title}静态示例" aria-pressed="${ui.camera === key && ui.mode !== 'map'}"><img src="assets/${cameras[key].file}" alt=""><span><i class="green">●</i> ${cameras[key].tag}</span></button>`).join('')}</div></section><div class="remote-health"><span>感知计算负载：34% / 48°C</span><span>丢包率：<b class="green">${offline ? '—' : '0.00%'}</b></span><span>${offline ? '链路离线' : '9 ms（示例）'}</span></div><div class="demo-note" style="margin-top:10px">摄像头、链路及遥测均为演示数据。此页面不会连接或控制真实车辆。</div>${vehicle.remoteStarted && !vehicle.remoteStopped ? `<div class="remote-run-banner" style="margin-top:12px">${F.icon('play')} 已模拟发车：${h(vehicle.id)} 正以 ${h(vehicle.speed)} km/h 行驶。${p ? `计划 ${h(p.id)} 已更新为执行中。` : '车辆状态已同步。'}</div>` : ''}${vehicle.remoteStopped ? `<div class="remote-stopped-banner" style="margin-top:12px">■ ${h(vehicle.id)} 已模拟停车，速度 0 km/h。重新检查发车条件后可恢复模拟运行。</div>` : ''}`;
  }
  function renderConditions(vehicle) {
    const p = plan(vehicle);
    const conditions = [
      ['规划路线校验缓存', Boolean(p), p ? '已载入' : '待创建计划'],
      ['四门及行李厢闭锁', online(vehicle), online(vehicle) ? '锁止' : '无法核验'],
      ['红外与重力空舱确认', online(vehicle) && vehicle.status !== 'running', !online(vehicle) ? '无法核验' : vehicle.status === 'running' ? '运行中' : '空载'],
      ['远程网络时延符合要求', online(vehicle), online(vehicle) ? '18 ms' : '离线'],
      ['电池电量 ≥ 20%', Number(vehicle.soc) >= 20, `${vehicle.soc}%`]
    ];
    return `<section class="panel remote-conditions"><h3>发车条件</h3><ul class="check-list">${conditions.map(([label, pass, result]) => `<li><span class="${pass ? 'green' : 'amber'}">${pass ? '⊙' : '!'}</span><span>${label}</span><span style="color:${pass ? 'var(--green)' : 'var(--amber)'}">${result}</span></li>`).join('')}</ul><p class="muted" style="font-size:10px;margin-top:12px;line-height:1.6">${vehicle.remoteCheckAt ? `最近模拟自检：${h(vehicle.remoteCheckAt)}` : '条件为演示检查结果，发车前需人工确认。'}</p></section>`;
  }
  function render() {
    const vehicle = current();
    const p = plan(vehicle);
    const queue = queueCars();
    const actionLabel = !online(vehicle) ? '车辆离线 · 无法发车' : vehicle.status === 'running' ? '已在运行中' : ['charging', 'maintenance'].includes(vehicle.status) ? '当前状态不可发车' : Number(vehicle.soc) < 20 ? '电量不足 · 请先补能' : vehicle.remoteStopped ? '恢复模拟运行' : '发送模拟发车请求';
    return `<section class="remote-page"><div class="remote-statusbar"><span>控制台节点 SH-ZJ-NODE-04　 /　 <span class="${online(vehicle) ? 'green' : 'red'}">● ${online(vehicle) ? '双路 5G 主备专网在线（演示）' : '所选车辆通信离线'}</span></span><span class="muted">远程运营工作台</span></div><div class="remote-columns"><aside class="stack"><section class="panel remote-queue"><div class="row between"><h3>${F.icon('remote', 16)} 待处理队列</h3><button class="icon-btn" data-action="remote-clear" title="显示全部车辆" aria-label="显示全部队列">↺</button></div><div class="queue-tabs">${[['waiting', '待确认', 'amber'], ['monitor', '监控告警', 'blue'], ['offline', '离线异常', 'red']].map(([type, label, color]) => `<button data-action="remote-filter" data-filter="${type}" aria-pressed="${ui.filter === type}" style="padding:0;background:transparent;color:inherit"><span style="display:block;${ui.filter === type ? 'outline:1px solid #6586bc;' : ''}"><b class="${color}" style="font-weight:500">${label}</b><br>${queue.filter(item => group(item) === type).length}</span></button>`).join('')}</div><label style="display:block"><span class="sr-only">搜索待处理队列</span><input id="remote-search" type="search" value="${h(ui.query)}" placeholder="⌕ 车辆编号 / 车牌" style="width:100%;font-size:11px;padding:7px"></label><div id="remote-queue-items" aria-live="polite">${renderQueue()}</div></section><div class="panel" style="padding:12px;font-size:10px;line-height:1.9"><p class="muted">座舱视频硬件状态</p><p>方向盘 / 踏板 <span class="green" style="float:right">模拟就绪</span></p><p>双向语音链路 <span class="green" style="float:right">DEMO</span></p></div><button class="btn subtle" data-action="remote-detail">查看车辆详情 →</button></aside><section id="remote-camera-area" aria-label="摄像头与遥测">${renderCamera(vehicle)}</section><aside class="stack"><section class="panel remote-car"><header><h2>${F.icon('vehicles')} ${h(vehicle.id)}</h2><img src="assets/car.png" alt="车辆示意图"></header><div class="meta"><div><span class="muted">目标：</span><span style="text-align:right;max-width:180px">${h(p?.destination || '暂无运行计划')}</span></div><div><span class="muted">计划：</span><button class="blue" style="background:transparent;padding:0;font-size:11px" data-action="remote-plan">${h(p?.id || '创建计划 →')}</button></div><div><span class="muted">状态：</span>${F.badge(vehicle.status)}</div></div><div class="row"><div><strong class="${Number(vehicle.soc) < 40 ? 'amber' : 'green'}">${h(vehicle.soc)}%</strong><small class="muted">（可用 ${h(vehicle.range)} km）</small><div style="height:4px;background:#394151;margin-top:8px;border-radius:2px"><div style="height:100%;width:${Math.min(100, Math.max(0, Number(vehicle.soc)))}%;background:var(--amber);border-radius:2px"></div></div></div><div class="green" style="white-space:nowrap">${vehicle.status === 'running' ? '执行任务中' : '空舱 · 0 人'}</div></div></section>${renderConditions(vehicle)}<section class="panel remote-actions"><h3>远程操作</h3><button class="btn primary" style="width:100%" data-action="remote-start" ${!eligible(vehicle) ? 'disabled' : ''}>${F.icon('play')} ${actionLabel}</button><div class="row"><button class="btn subtle" data-action="remote-broadcast" ${!online(vehicle) ? 'disabled' : ''}>⚑ 发起车载广播</button><button class="btn subtle" data-action="remote-selfcheck" ${!online(vehicle) ? 'disabled' : ''}>↻ 传感器自检</button></div>${vehicle.remoteBroadcast ? `<p class="muted" style="font-size:10px;margin-top:12px;line-height:1.7">最近模拟广播：${h(vehicle.remoteBroadcast)}</p>` : ''}</section><section class="panel estop"><h3>紧急避险 · 模拟</h3><button class="btn danger" style="width:100%" data-action="remote-stop" ${!online(vehicle) ? 'disabled' : ''}>✋ 模拟紧急停车（E-STOP）</button><p style="font-size:10px;opacity:.75;margin-top:8px">仅更新原型状态，不发送真实控制指令</p></section></aside></div></section>`;
  }
  function mount(container) {
    root = container;
    const search = container.querySelector('#remote-search');
    if (search) search.oninput = event => { ui.query = event.target.value; container.querySelector('#remote-queue-items').innerHTML = renderQueue(); };
  }
  function repaint() { F.render(); }
  function start() {
    const vehicle = current();
    if (!eligible(vehicle)) { F.toast('该车辆当前不满足模拟发车条件', 'warning'); return; }
    const p = plan(vehicle);
    if (!p) {
      F.modal('请先创建运行计划', `<p class="dialog-description">${h(vehicle.id)} 还没有可执行的运行计划。创建计划后可继续模拟发车。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="button" class="btn primary" data-action="remote-create">创建运行计划</button></div>`);
      return;
    }
    F.modal('确认模拟发车 · ' + vehicle.id, `<p class="dialog-description">将 ${h(vehicle.id)} 的演示状态更新为“运行中”，并启动计划 ${h(p.id)}。</p><div class="panel" style="padding:12px;margin:16px 0;font-size:12px;line-height:1.9"><div>出发地：${h(p.origin)}</div><div>目的地：${h(p.destination)}</div><div>电量：<span class="amber">${h(vehicle.soc)}%</span>　链路：<span class="green">18 ms（模拟）</span></div></div><label class="row" style="align-items:flex-start;line-height:1.6;font-size:12px"><input type="checkbox" name="reviewed" required value="yes" style="margin-top:3px"><span>已检查路线、车门、空舱和网络条件，确认执行本次模拟发车。</span></label><p class="muted" style="font-size:11px;line-height:1.7;margin-top:12px">演示操作仅保存在本地浏览器中。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="submit" class="btn primary">确认模拟发车</button></div>`, data => {
      if (data.get('reviewed') !== 'yes') return false;
      if (!eligible(vehicle)) { F.toast('车辆状态已变化，请重新检查', 'warning'); return false; }
      vehicle.status = 'running'; vehicle.speed = 32; vehicle.remoteStarted = true; vehicle.remoteStopped = false;
      p.status = 'running'; F.state.selectedPlan = p.id;
      F.log(`${vehicle.id} 通过条件确认，模拟发车；计划 ${p.id} 开始执行`);
      F.save(); repaint(); F.toast(`${vehicle.id} 已模拟发车，计划状态已同步`);
    });
  }
  function stop() {
    const vehicle = current();
    if (!online(vehicle)) { F.toast('离线车辆无法接收模拟控制指令', 'warning'); return; }
    if (['running', 'waiting', 'standby'].includes(vehicle.status)) vehicle.status = 'waiting'; vehicle.speed = 0; vehicle.remoteStopped = true; vehicle.remoteStarted = false;
    const p = plan(vehicle); if (p) p.status = 'waiting';
    F.log(`${vehicle.id} 执行模拟紧急停车，速度归零，计划暂停等待重新确认`);
    F.save(); repaint(); F.toast(`${vehicle.id} 已模拟停车 · 速度 0 km/h`, 'warning');
  }
  function broadcast() {
    const vehicle = current(); if (!online(vehicle)) return;
    F.modal('模拟车载广播 · ' + vehicle.id, `<label class="field">广播内容<select name="phrase" required><option>车辆即将出发，请系好安全带。</option><option>前方道路施工，车辆将调整行驶路线。</option><option>车辆已安全停靠，请留意周围环境。</option><option>运营员正在处理异常，请稍候。</option></select></label><p class="muted" style="margin-top:15px;font-size:12px;line-height:1.7">确认后记录本次广播，不播放音频或连接真实车载扬声器。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="submit" class="btn primary">发送模拟广播</button></div>`, data => {
      const phrase = String(data.get('phrase') || '');
      if (!phrase || !online(vehicle)) return false;
      vehicle.remoteBroadcast = phrase; F.log(`${vehicle.id} 模拟车载广播：${phrase}`); F.save(); repaint(); F.toast('模拟广播已记录');
    });
  }
  function selfcheck() {
    const vehicle = current(); if (!online(vehicle)) return;
    vehicle.remoteCheckAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    F.log(`${vehicle.id} 完成模拟传感器自检：摄像头、激光雷达、制动及车门通信通过`); F.save(); repaint();
    F.modal('模拟自检结果 · ' + vehicle.id, `<ul class="check-list">${['前视与环视摄像头', '激光雷达与定位模块', '制动与转向通信', '车门及行李厢传感器'].map(label => `<li><span class="green">⊙</span><span>${label}</span><span>通过</span></li>`).join('')}</ul><p class="muted" style="margin-top:16px;font-size:12px;line-height:1.7">检查时间 ${h(vehicle.remoteCheckAt)}。以上为演示结果，不能用于判断真实车辆是否安全。</p><div class="dialog-actions"><button type="submit" class="btn primary">完成</button></div>`);
  }
  function action(name, element) {
    if (!name.startsWith('remote-')) return;
    if (name === 'remote-vehicle') { F.state.selectedId = element.dataset.id; const p = plan(current()); if (p) F.state.selectedPlan = p.id; F.save(); repaint(); }
    if (name === 'remote-filter') { ui.filter = ui.filter === element.dataset.filter ? 'all' : element.dataset.filter; repaint(); }
    if (name === 'remote-clear') { ui.query = ''; ui.filter = 'all'; repaint(); }
    if (name === 'remote-mode') { ui.mode = element.dataset.mode; repaint(); }
    if (name === 'remote-camera') { ui.camera = element.dataset.camera; ui.mode = 'camera'; repaint(); }
    if (name === 'remote-fullscreen') F.modal('静态画面预览 · ' + current().id, `<img class="screenshot-preview" src="${source()}" alt="原稿静态画面"><p class="detail-video-title">${ui.mode === 'map' ? '原稿地图示例' : cameras[ui.camera].title} · 静态素材，非实时监控</p><div class="dialog-actions"><button type="submit" class="btn primary">关闭</button></div>`);
    if (name === 'remote-detail') F.go('detail');
    if (name === 'remote-plan') { const p = plan(current()); if (p) { F.state.selectedPlan = p.id; F.save(); F.go('plans'); } else F.go('create'); }
    if (name === 'remote-create') { document.querySelector('#modal').close(); F.go('create'); }
    if (name === 'remote-start') start();
    if (name === 'remote-stop') stop();
    if (name === 'remote-broadcast') broadcast();
    if (name === 'remote-selfcheck') selfcheck();
  }
  F.pages.remote = { render, mount, action };
})();
