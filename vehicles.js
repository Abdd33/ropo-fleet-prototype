(() => {
  'use strict';
  const F = window.Fleet;
  const view = { query: '', filter: 'all', mode: 'grid', sort: 'urgency', page: 1, selected: new Set() };
  const PAGE_SIZE = 48;
  const labels = { running: '任务中', standby: '空闲', charging: '超充', maintenance: '维修', offline: '离线', waiting: '待发' };
  const groupLabels = { all: '全部', running: '任务中', standby: '待命', charging: '补能', maintenance: '维护' };
  const priority = { waiting: 0, offline: 1, maintenance: 2, charging: 3, standby: 4, running: 5 };
  let root;
  const h = value => F.h(String(value ?? ''));
  const cars = () => Array.isArray(F.state.vehicles) ? F.state.vehicles : [];
  const matchesGroup = (car, group) => group === 'all' || (group === 'standby' ? ['standby', 'waiting'].includes(car.status) : group === 'maintenance' ? ['maintenance', 'offline'].includes(car.status) : car.status === group);
  const count = group => cars().filter(car => matchesGroup(car, group)).length;
  function filtered() {
    const query = view.query.trim().toLowerCase();
    const list = cars().filter(car => matchesGroup(car, view.filter) && (!query || [car.id, car.plate, car.location, labels[car.status]].some(value => String(value ?? '').toLowerCase().includes(query))));
    return list.sort((a, b) => view.sort === 'soc' ? Number(a.soc) - Number(b.soc) : view.sort === 'id' ? String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true }) : (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true }));
  }
  function pageData() {
    const list = filtered();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.max(1, Math.min(view.page, totalPages));
    return { list, totalPages, pageCars: list.slice((view.page - 1) * PAGE_SIZE, view.page * PAGE_SIZE) };
  }
  function soc(car) { return Math.max(0, Math.min(100, Number(car.soc) || 0)); }
  function description(car) {
    if (car.status === 'offline') return '<span class="vehicle-error">通讯已断开</span>';
    if (car.status === 'maintenance') return h(car.location || '维保厂区');
    if (car.status === 'charging') return '补能中 · 预计 22 min';
    if (car.status === 'waiting') return h(car.range ?? Math.round(soc(car) * 2.7)) + ' km · 等待发车';
    if (car.status === 'standby') return h(car.range ?? Math.round(soc(car) * 2.7)) + ' km 可调';
    return h(car.range ?? Math.round(soc(car) * 2.7)) + ' km · ' + h(car.speed || 0) + ' km/h';
  }
  function statusBadge(car) { return `<span class="vehicle-status status-${h(car.status)}">${h(labels[car.status] || car.status)}</span>`; }
  function vehicleCard(car) {
    return `<article class="vehicle-card status-${h(car.status)} ${view.selected.has(car.id) ? 'is-selected' : ''}">
      <button class="vehicle-card-main" data-action="vehicle-open" data-id="${h(car.id)}" aria-label="查看 ${h(car.id)} 车辆详情">
        <span class="vehicle-card-title"><strong>${h(car.id)}</strong>${statusBadge(car)}</span>
        <span class="vehicle-card-data"><b class="${soc(car) < 40 ? 'low-soc' : ''}">${soc(car)}<small>%</small></b><span>${description(car)}</span></span>
        <span class="vehicle-charge-track"><span style="width:${soc(car)}%"></span></span>
      </button>
      <label class="vehicle-card-check ${view.selected.size ? 'has-selection' : ''}" title="选择 ${h(car.id)}"><input type="checkbox" data-action="vehicle-select" data-id="${h(car.id)}" ${view.selected.has(car.id) ? 'checked' : ''} aria-label="选择 ${h(car.id)}"></label>
    </article>`;
  }
  function renderResults() {
    const { pageCars } = pageData();
    if (!pageCars.length) return `<div class="vehicle-empty"><div class="vehicle-empty-icon">⌕</div><h3>未找到匹配的车辆</h3><p>试试其他车辆编号、车牌或位置，或清除筛选条件。</p><button class="btn primary" data-action="vehicle-clear">清除筛选</button></div>`;
    if (view.mode === 'list') return `<div class="vehicle-table-wrap"><table class="vehicle-table"><thead><tr><th class="vehicle-select-cell"></th><th>车辆编号 / 车牌</th><th>当前状态</th><th>电池电量</th><th>预计续航</th><th>当前位置</th><th>操作</th></tr></thead><tbody>${pageCars.map(car => `<tr class="${view.selected.has(car.id) ? 'is-selected' : ''}"><td><input type="checkbox" data-action="vehicle-select" data-id="${h(car.id)}" ${view.selected.has(car.id) ? 'checked' : ''} aria-label="选择 ${h(car.id)}"></td><td><button class="vehicle-text-button" data-action="vehicle-open" data-id="${h(car.id)}"><strong>${h(car.id)}</strong><small>${h(car.plate)}</small></button></td><td>${statusBadge(car)}</td><td><span class="vehicle-table-soc ${soc(car) < 40 ? 'low-soc' : ''}">${soc(car)}%</span><span class="vehicle-table-bar"><i style="width:${soc(car)}%;background:${soc(car) < 40 ? 'var(--amber)' : 'var(--green)'}"></i></span></td><td>${h(car.range ?? Math.round(soc(car) * 2.7))} km</td><td>${h(car.location || '张江运营区域')}</td><td><button class="vehicle-text-button" data-action="vehicle-open" data-id="${h(car.id)}">查看详情 →</button></td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="vehicle-grid">${pageCars.map(vehicleCard).join('')}</div>`;
  }
  function renderFooter() {
    const { pageCars, list, totalPages } = pageData();
    const allSelected = pageCars.length > 0 && pageCars.every(car => view.selected.has(car.id));
    return `<div class="vehicle-footer-left"><span>当前展示 <strong>${pageCars.length}</strong> / ${list.length} 辆</span><span class="vehicle-footer-separator"></span><label class="vehicle-select-all"><input type="checkbox" data-action="vehicle-select-all" ${allSelected ? 'checked' : ''} ${!pageCars.length ? 'disabled' : ''}>全选本页</label><button class="btn subtle vehicle-bulk" data-action="vehicle-bulk" ${!view.selected.size ? 'disabled' : ''}>批量调度${view.selected.size ? ` (${view.selected.size})` : ''}</button><button class="btn subtle" data-action="vehicle-inspect" ${!view.selected.size ? 'disabled' : ''}>巡检校准</button>${view.selected.size ? '<button class="vehicle-text-button" data-action="vehicle-deselect">取消选择</button>' : ''}</div><div class="vehicle-footer-right"><span class="vehicle-sync"><i></i> 演示数据已同步</span><button class="vehicle-page-button" data-action="vehicle-prev" aria-label="上一页" ${view.page <= 1 ? 'disabled' : ''}>‹</button><span>${view.page} / ${totalPages}</span><button class="vehicle-page-button" data-action="vehicle-next" aria-label="下一页" ${view.page >= totalPages ? 'disabled' : ''}>›</button></div>`;
  }
  function render() {
    if (F.state.vehicleFilter) {
      view.filter = Object.prototype.hasOwnProperty.call(groupLabels, F.state.vehicleFilter) ? F.state.vehicleFilter : 'all';
      view.query = ''; view.page = 1;
      delete F.state.vehicleFilter;
    }
    return `<section class="vehicles-page"><div class="vehicle-heading"><div class="vehicle-heading-title"><h1>车辆管理</h1><div class="vehicle-summary"><span><i></i><b>${cars().length}</b> 全部</span><span class="blue"><i></i><b>${count('running')}</b> 任务中</span><span class="green"><i></i><b>${count('standby')}</b> 待命</span><span class="purple"><i></i><b>${count('charging')}</b> 补能</span><span class="red"><i></i><b>${count('maintenance')}</b> 维护</span></div></div><button class="btn primary" data-action="vehicle-create">＋ 创建计划</button></div>
      <div class="vehicle-toolbar"><div class="vehicle-filters" role="group" aria-label="车辆状态筛选">${Object.entries(groupLabels).map(([key, label]) => `<button data-action="vehicle-filter" data-filter="${key}" class="${view.filter === key ? 'active' : ''}" aria-pressed="${view.filter === key}">${label} <span>(${count(key)})</span></button>`).join('')}</div><div class="vehicle-tools"><label class="vehicle-search"><span aria-hidden="true">⌕</span><input id="vehicle-search" type="search" placeholder="搜索车辆、车牌或位置" value="${h(view.query)}" aria-label="搜索车辆、车牌或位置" autocomplete="off"></label><div class="vehicle-view-switch" role="group" aria-label="车辆展示方式"><button data-action="vehicle-view" data-mode="grid" class="${view.mode === 'grid' ? 'active' : ''}" aria-pressed="${view.mode === 'grid'}" aria-label="网格视图" title="网格视图">▦</button><button data-action="vehicle-view" data-mode="list" class="${view.mode === 'list' ? 'active' : ''}" aria-pressed="${view.mode === 'list'}" aria-label="列表视图" title="列表视图">☷</button></div><label class="vehicle-sort">排序：<select id="vehicle-sort" aria-label="车辆排序"><option value="urgency" ${view.sort === 'urgency' ? 'selected' : ''}>响应紧急度</option><option value="soc" ${view.sort === 'soc' ? 'selected' : ''}>电量从低到高</option><option value="id" ${view.sort === 'id' ? 'selected' : ''}>车辆编号</option></select></label></div></div>
      <div class="vehicle-results" id="vehicle-results" aria-live="polite">${renderResults()}</div><footer class="vehicle-footer" id="vehicle-footer">${renderFooter()}</footer></section>`;
  }
  function updateContent() {
    if (!root) return;
    root.querySelector('#vehicle-results').innerHTML = renderResults();
    root.querySelector('#vehicle-footer').innerHTML = renderFooter();
  }
  function repaint() { if (root) { root.innerHTML = render(); mount(root); } }
  function mount(container) {
    root = container;
    const search = root.querySelector('#vehicle-search');
    if (search) search.oninput = event => { view.query = event.target.value; view.page = 1; updateContent(); };
    const sort = root.querySelector('#vehicle-sort');
    if (sort) sort.onchange = event => { view.sort = event.target.value; view.page = 1; updateContent(); };
  }
  function action(name, element, event) {
    if (!name.startsWith('vehicle-')) return;
    switch (name) {
      case 'vehicle-open': F.state.selectedId = element.dataset.id; F.save(); F.go('detail'); break;
      case 'vehicle-create': F.go('create'); break;
      case 'vehicle-filter': view.filter = element.dataset.filter; view.page = 1; repaint(); break;
      case 'vehicle-view': view.mode = element.dataset.mode; repaint(); break;
      case 'vehicle-clear': view.query = ''; view.filter = 'all'; view.page = 1; repaint(); root.querySelector('#vehicle-search').focus(); break;
      case 'vehicle-select': if (event) event.stopPropagation(); if (element.checked) view.selected.add(element.dataset.id); else view.selected.delete(element.dataset.id); updateContent(); break;
      case 'vehicle-select-all': pageData().pageCars.forEach(car => element.checked ? view.selected.add(car.id) : view.selected.delete(car.id)); updateContent(); break;
      case 'vehicle-deselect': view.selected.clear(); updateContent(); break;
      case 'vehicle-prev': view.page--; updateContent(); break;
      case 'vehicle-next': view.page++; updateContent(); break;
      case 'vehicle-bulk': bulkDispatch(); break;
      case 'vehicle-inspect': inspect(); break;
    }
  }
  function bulkDispatch() {
    const selected = cars().filter(car => view.selected.has(car.id));
    if (!selected.length) return;
    const eligible = selected.filter(car => ['standby', 'waiting'].includes(car.status));
    const blocked = selected.filter(car => !eligible.includes(car));
    F.modal('批量调度指令', `<div class="vehicle-modal-intro"><p>已选 <b>${selected.length}</b> 辆车辆，其中 <b>${eligible.length}</b> 辆可接收调度。</p><p class="muted">${eligible.length ? eligible.map(car => h(car.id)).join('、') : '当前没有待命或待发车辆。'}</p>${blocked.length ? `<div class="vehicle-modal-note">${blocked.length} 辆车辆正在执行任务、补能、维修或离线，将跳过：${blocked.map(car => h(car.id)).join('、')}。</div>` : ''}</div><label class="field">调度目标<select name="destination" required><option value="张江运营中心">张江运营中心</option><option value="科苑路临停区">科苑路临停区</option><option value="金科路地铁站">金科路地铁站</option></select></label><label class="field">指令备注<input name="note" maxlength="120" placeholder="例如：高峰补位，优先前往候客区"></label><p class="muted">本次操作仅更新原型中的演示状态，不连接车辆。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="submit" class="btn primary"${eligible.length ? '' : ' disabled'}>确认调度</button></div>`, data => {
      if (!eligible.length) { F.toast('没有可调度的车辆，请选择待命或待发车辆', 'warning'); return false; }
      const destination = String(data.get('destination') || '张江运营中心');
      const note = String(data.get('note') || '').trim();
      eligible.forEach(car => { car.status = 'waiting'; car.location = destination; car.speed = 0; });
      F.log(`批量调度 ${eligible.map(car => car.id).join('、')} → ${destination}${note ? ` · ${note}` : ''}（模拟）`);
      F.save(); view.selected.clear(); repaint(); F.toast(`已向 ${eligible.length} 辆车辆下发模拟调度指令`);
    });
  }
  function inspect() {
    const selected = cars().filter(car => view.selected.has(car.id));
    if (!selected.length) return;
    const online = selected.filter(car => car.status !== 'offline');
    F.modal('集中巡检校准', `<p>将对选中的 ${selected.length} 辆车辆进行模拟自检。</p><div class="vehicle-inspection-list">${selected.map(car => `<div><strong>${h(car.id)}</strong><span class="${car.status === 'offline' ? 'vehicle-error' : 'vehicle-pass'}">${car.status === 'offline' ? '离线 · 无法执行' : '传感器 / 通讯 / 制动系统 · 可检查'}</span></div>`).join('')}</div><p class="muted">检查结果为原型演示数据。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="submit" class="btn primary"${online.length ? '' : ' disabled'}>开始模拟巡检</button></div>`, () => { F.log(`集中巡检完成：${online.length} 辆通过，${selected.length - online.length} 辆离线跳过（模拟）`); F.save(); F.toast(`${online.length} 辆车辆模拟巡检通过${selected.length > online.length ? `，${selected.length - online.length} 辆离线跳过` : ''}`); });
  }
  F.pages.vehicles = { render, mount, action };
})();
