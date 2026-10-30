(function () {
  'use strict';
  const F = window.Fleet;
  const types = [
    { name: '接送任务', icon: '♙', detail: '安排乘客接送与目的地行程', distance: 8.2, minutes: 26, cost: 7 },
    { name: '回场补能', icon: 'ϟ', detail: '返回运营中心并进入充电泊位', distance: 4.6, minutes: 18, cost: 4 },
    { name: '车辆调位', icon: '⇅', detail: '根据区域需求重新分配车辆', distance: 3.2, minutes: 12, cost: 3 },
    { name: '循环运行', icon: '∞', detail: '按固定线路循环巡航', distance: 12.4, minutes: 42, cost: 11 },
    { name: '停运检修', icon: '⚒', detail: '返回维修区域进行检查', distance: 5.6, minutes: 20, cost: 5 }
  ];
  const points = ['科苑路 03 机位', '张江运营中心 4 号超充桩', '张江运营中心入口', '金科路地铁站', '浦东软件园', '张江高科技园区', '维保厂区'];
  const steps = ['选择任务', '路径设定', '分配车辆', '检查与下发'];
  const statusNames = { running: '正在执行任务', standby: '就绪待命', charging: '正在充电', maintenance: '维修中', offline: '通信离线', waiting: '等待发车' };
  function draft() {
    if (!F.state.draft || !F.state.draft.type) {
      const selected = F.state.vehicles.find(v => v.id === F.state.selectedId && eligible(v));
      const candidate = selected || F.state.vehicles.find(eligible);
      F.state.draft = { step: 1, type: '回场补能', origin: points[0], destination: points[1], date: '2026-10-23', start: '11:10', vehicleId: candidate ? candidate.id : '', note: '', savedAt: null };
    }
    return F.state.draft;
  }
  function eligible(v) { return ['standby', 'waiting'].includes(v.status) && v.soc > 10; }
  function task() { return types.find(t => t.name === draft().type) || types[1]; }
  function vehicle() { return F.state.vehicles.find(v => v.id === draft().vehicleId); }
  function addMinutes(time, minutes) {
    const [h, m] = (time || '11:10').split(':').map(Number);
    const total = h * 60 + m + minutes;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }
  function planId() {
    const prefix = 'S-' + draft().date.slice(5).replace('-', '') + '-';
    let n = 29;
    while ((F.state.plans || []).some(p => p.id === prefix + String(n).padStart(3, '0'))) n++;
    return prefix + String(n).padStart(3, '0');
  }
  function field(label, name, control, extra = '') { return '<label class="create-field"><span>' + label + '</span>' + control + (extra ? '<small>' + extra + '</small>' : '') + '</label>'; }
  function pointSelect(name, selected) { return '<select class="field" name="' + name + '" required>' + points.map(p => '<option' + (selected === p ? ' selected' : '') + '>' + F.h(p) + '</option>').join('') + '</select>'; }
  function typeCards() {
    const d = draft();
    return '<section class="panel create-types"><div class="create-section-head"><h2>选择任务类型</h2><span class="muted">根据运营目标配置运行计划</span></div><div class="create-type-grid">' + types.map(t => '<button type="button" class="create-type' + (d.type === t.name ? ' selected' : '') + '" data-action="create-type" data-type="' + t.name + '" aria-pressed="' + (d.type === t.name) + '"><span class="create-type-icon">' + t.icon + '</span><strong>' + t.name + '</strong>' + (d.type === t.name ? '<span class="create-check">✓</span>' : '') + '</button>').join('') + '</div><p class="create-task-description">' + task().detail + '</p></section>';
  }
  function routeSummary() {
    const d = draft(), t = task();
    return '<section class="panel create-route-summary"><span class="create-origin">◉ ' + F.h(d.origin) + '</span><span class="create-route-arrow">╌╌╌╌ → ╌╌╌╌</span><span class="create-destination">⚑ ' + F.h(d.destination) + '</span><div class="create-route-metric"><b>' + t.distance + '</b><small>km</small></div><div class="create-route-metric cyan"><b>' + t.minutes + '</b><small>min</small></div><div class="create-route-metric amber"><b>−' + t.cost + '%</b><small>SOC</small></div></section>';
  }
  function routeForm() {
    const d = draft();
    return '<section class="panel create-route-form"><div class="create-section-head"><h2>设置路线与时间</h2><span class="badge">模拟路由</span></div><div class="create-field-grid">' + field('起点', 'origin', pointSelect('origin', d.origin)) + field('目的地', 'destination', pointSelect('destination', d.destination)) + field('计划日期', 'date', '<input class="field" type="date" name="date" value="' + F.h(d.date) + '" required>') + field('出发时间', 'start', '<input class="field" type="time" name="start" value="' + F.h(d.start) + '" required>', '预计 ' + addMinutes(d.start, task().minutes) + ' 到达') + '</div>' + field('调度备注（可选）', 'note', '<textarea class="field" name="note" rows="3" maxlength="160" placeholder="例如：到达后停靠 4 号充电泊位">' + F.h(d.note) + '</textarea>') + '<div class="create-inline-note">ⓘ 路程与耗时为原型演示值，未连接实时导航服务。</div></section>';
  }
  function vehicleList() {
    const d = draft(), t = task();
    const available = F.state.vehicles.filter(eligible);
    const featuredIds = [d.vehicleId, 'RT-021', 'RT-034', 'RT-008', 'RT-046'];
    const featured = featuredIds.map(id => F.state.vehicles.find(v => v.id === id)).filter(Boolean);
    const candidates = [...new Map([...featured, ...available].map(v => [v.id, v])).values()];
    return '<section class="panel create-vehicle-section"><div class="create-section-head"><h2>选择车辆</h2><span class="muted">' + available.length + ' 台可分配</span></div><div class="create-vehicle-list">' + candidates.map(v => {
      const ok = eligible(v) && v.soc > t.cost + 8;
      const reason = !eligible(v) ? (statusNames[v.status] || '当前不可用') : (v.soc <= t.cost + 8 ? '到达电量不足安全余量' : '预计到达 ' + Math.max(0, v.soc - t.cost) + '% SOC');
      return '<button type="button" class="create-vehicle' + (v.id === d.vehicleId ? ' selected' : '') + '" data-action="create-vehicle" data-id="' + F.h(v.id) + '"' + (!ok ? ' disabled' : '') + ' aria-pressed="' + (v.id === d.vehicleId) + '"><span class="create-radio">' + (v.id === d.vehicleId ? '●' : '○') + '</span><span class="create-vehicle-title"><strong>' + F.h(v.id) + '</strong><small>' + F.h(v.plate) + '</small></span><span class="create-vehicle-soc ' + (v.soc < 40 ? 'amber' : 'green') + '">' + v.soc + '%<i><b style="width:' + v.soc + '%"></b></i></span><span class="create-vehicle-reason">' + reason + '</span><span class="create-choose">' + (!ok ? '不可用' : v.id === d.vehicleId ? '✓ 已选择' : '切换为此车') + '</span></button>';
    }).join('') + '</div></section>';
  }
  function review() {
    const d = draft(), t = task(), v = vehicle();
    return '<section class="panel create-review"><div class="create-section-head"><h2>检查计划信息</h2><span class="badge">准备下发</span></div><dl><div><dt>计划编号</dt><dd>' + planId() + '</dd></div><div><dt>任务类型</dt><dd>' + F.h(d.type) + '</dd></div><div><dt>执行车辆</dt><dd>' + F.h(v ? v.id + ' · ' + v.plate : '尚未选择') + '</dd></div><div><dt>出发时间</dt><dd>' + F.h(d.date + ' ' + d.start) + '</dd></div><div><dt>预计到达</dt><dd>' + addMinutes(d.start, t.minutes) + ' · ' + t.minutes + ' 分钟</dd></div><div><dt>起点 → 目的地</dt><dd>' + F.h(d.origin + ' → ' + d.destination) + '</dd></div>' + (d.note ? '<div><dt>调度备注</dt><dd>' + F.h(d.note) + '</dd></div>' : '') + '</dl><div class="create-checklist"><p><span>✓</span> 已选择可分配车辆</p><p><span>✓</span> 预计到达电量保留安全余量</p><p><span>✓</span> 下发后可在任务与调度中继续管理</p></div><div class="create-inline-note">本次操作仅创建本地演示计划，不会向真实车辆发送指令。</div></section>';
  }
  function preview() {
    const d = draft(), t = task(), v = vehicle();
    const soc = v ? v.soc : 0;
    return '<aside class="panel create-preview"><div class="create-preview-top"><div><strong>' + F.h(v ? v.id : '待分配车辆') + '</strong><span>计划编号</span><b>' + planId() + '</b></div><img src="assets/car.png" alt="运营车辆"></div><div class="create-map"><img src="assets/plan-map.png" alt="计划路线示意图"><div><span>' + F.h(d.origin) + '</span><b>→</b><span>' + F.h(d.destination) + '</span></div><small>路线示意 · ' + F.h(d.start) + '—' + addMinutes(d.start, t.minutes) + '</small></div><ol class="create-subtasks"><li><i>1</i><span>从' + F.h(d.origin) + '出发</span></li><li><i>2</i><span>前往' + F.h(d.destination) + '</span></li></ol><div class="create-battery"><div><small>当前电量</small><strong class="amber">' + soc + '%</strong></div><span>····················· →</span><div><small>到达预计</small><strong>' + Math.max(0, soc - t.cost) + '%</strong></div></div><div class="create-soc-track"><i style="width:' + soc + '%"></i></div><div class="create-preview-actions"><button class="btn primary" data-action="create-next">' + (d.step === 4 ? '▷ 下发至调度时间表' : '继续 · ' + steps[d.step]) + '</button><button class="btn subtle" data-action="create-save">▱ 保存草稿</button></div>' + (d.savedAt ? '<p class="create-saved">草稿已保存 · ' + F.h(d.savedAt) + '</p>' : '') + '</aside>';
  }
  function capture() {
    const form = document.getElementById('create-plan-form');
    if (!form) return;
    const data = new FormData(form), d = draft();
    for (const key of ['origin', 'destination', 'date', 'start', 'note']) if (data.has(key)) d[key] = String(data.get(key)).trim();
  }
  function validate(step) {
    const d = draft();
    if (step >= 2) {
      if (!d.origin || !d.destination || !d.date || !d.start) return '请补全起点、目的地和出发时间。';
      if (d.origin === d.destination) return '起点与目的地不能相同。';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.start)) return '请填写有效的日期与时间。';
      const [hour, minute] = d.start.split(':').map(Number);
      if (hour * 60 + minute + task().minutes >= 24 * 60) return '请安排在当天可完成的时间段内。';
    }
    if (step >= 3) {
      const v = vehicle();
      if (!v || !eligible(v)) return '请选择一台就绪待命或等待发车的车辆。';
      if (v.soc <= task().cost + 8) return '所选车辆到达后电量不足，请更换车辆。';
      const startMinutes = Number(d.start.slice(0, 2)) * 60 + Number(d.start.slice(3));
      const endMinutes = startMinutes + task().minutes;
      const overlapping = F.state.plans.find(p => {
        if (p.vehicleId !== v.id || ['cancelled', 'completed'].includes(p.status) || (p.date || '2026-10-23') !== d.date) return false;
        const existingStart = Number(p.start.slice(0, 2)) * 60 + Number(p.start.slice(3));
        const existingEnd = Number(p.end.slice(0, 2)) * 60 + Number(p.end.slice(3));
        return startMinutes < existingEnd && endMinutes > existingStart;
      });
      if (overlapping) return v.id + ' 在 ' + overlapping.start + '–' + overlapping.end + ' 已有计划 ' + overlapping.id + '，请返回上一步调整时间或更换车辆。';
    }
    return '';
  }
  function showError(message) {
    const el = document.getElementById('create-errors');
    if (el) { el.textContent = message; el.hidden = false; el.focus(); }
    F.toast(message, 'error');
  }
  function publish() {
    const d = draft(), t = task(), v = vehicle();
    const id = planId();
    F.state.plans.unshift({ id, vehicleId: v.id, type: d.type, origin: d.origin, destination: d.destination, start: d.start, end: addMinutes(d.start, t.minutes), date: d.date, status: 'waiting', distance: t.distance, duration: t.minutes, note: d.note });
    v.status = 'waiting';
    F.state.selectedId = v.id;
    F.state.selectedPlan = id;
    F.state.justCreated = true;
    F.state.draft = null;
    F.log('创建并下发运行计划 ' + id + ' · ' + v.id + ' · ' + d.type + '（模拟）');
    F.save();
    F.toast('运行计划 ' + id + ' 已加入调度时间表');
    F.go('plans');
  }
  F.pages.create = {
    render() {
      const d = draft();
      return '<div class="create-page"><div class="page-head"><div><p class="eyebrow">任务与调度 / 创建运行计划</p><h1>创建运行计划</h1></div><button class="btn subtle" data-action="create-return">← 返回调度视图</button></div><nav class="create-steps" aria-label="创建计划步骤">' + steps.map((s, i) => '<button class="create-step' + (d.step === i + 1 ? ' active' : '') + (d.step > i + 1 ? ' complete' : '') + '" data-action="create-step" data-step="' + (i + 1) + '"' + (i + 1 > d.step ? ' disabled' : '') + ' aria-current="' + (d.step === i + 1 ? 'step' : 'false') + '"><b>' + (d.step > i + 1 ? '✓' : String(i + 1).padStart(2, '0')) + '</b><span>' + s + '</span></button>').join('') + '</nav><div class="create-body"><form id="create-plan-form" class="create-main" novalidate><div id="create-errors" class="create-errors" role="alert" tabindex="-1" hidden></div>' + typeCards() + (d.step >= 2 ? routeSummary() : '') + (d.step === 1 ? '<section class="panel create-intro"><span class="create-intro-icon">◇</span><h2>让每一段行程都有计划</h2><p>选择任务类型后，设置路线、时间并分配车辆。计划下发后将进入调度时间表，等待运营员确认发车。</p><div><span>01 选择任务</span><i>→</i><span>02 规划路线</span><i>→</i><span>03 分配车辆</span></div></section>' : d.step === 2 ? routeForm() : d.step === 3 ? vehicleList() : review()) + '<div class="create-footer"><button type="button" class="btn subtle" data-action="create-prev"' + (d.step === 1 ? ' disabled' : '') + '>← 上一步</button><span class="muted">第 ' + d.step + ' 步，共 4 步</span><button type="button" class="btn primary" data-action="create-next">' + (d.step === 4 ? '确认下发计划' : '下一步 →') + '</button></div></form>' + preview() + '</div></div>';
    },
    mount(container) {
      const form = container.querySelector('#create-plan-form');
      if (form) {
        form.addEventListener('submit', e => e.preventDefault());
        form.addEventListener('input', capture);
        form.addEventListener('change', () => { capture(); const old = container.querySelector('.create-preview'); if (old) old.outerHTML = preview(); });
      }
    },
    action(action, el, event) {
      if (!action.startsWith('create-')) return;
      if (event) event.preventDefault();
      capture();
      const d = draft();
      if (action === 'create-return') return F.go('plans');
      if (action === 'create-type') {
        d.type = el.dataset.type;
        d.destination = ({ '接送任务': points[4], '回场补能': points[1], '车辆调位': points[5], '循环运行': points[5], '停运检修': points[6] })[d.type] || points[1];
        if (d.step > 3) d.step = 3;
        F.render();
      }
      if (action === 'create-vehicle') { d.vehicleId = el.dataset.id; F.render(); }
      if (action === 'create-step') { const step = Number(el.dataset.step); if (step <= d.step) { d.step = step; F.render(); } }
      if (action === 'create-prev') { d.step = Math.max(1, d.step - 1); F.render(); }
      if (action === 'create-save') { d.savedAt = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }); F.save(); F.toast('运行计划草稿已保存，可稍后继续'); F.render(); }
      if (action === 'create-next') {
        const error = validate(d.step);
        if (error) return showError(error);
        if (d.step < 4) { d.step++; F.render(); }
        else publish();
      }
    }
  };
})();
