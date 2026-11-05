/* Local hierarchical workflow editor. Simulation never dispatches real tasks. */
(() => {
  "use strict";
  const F = window.Fleet, M = window.FleetAutomationModel, h = F.h;
  const MAIN = ["prepare", "operate", "charge", "close"];
  let root, canvas, stage, observer, controller, scope = "root", selectedId = null;
  let view = { x: 30, y: 65, scale: 0.8 }, views = {}, drag = null, pending = null, selectedEdge = null, undo = null;
  let showExceptions = false;
  let dirty = false, results = [], resultIndex = 0, simulationScenario = "current", playback = 0, timer = null;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const now = () => (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
  function model() {
    if (!F.state.flowV2 || F.state.flowV2.schemaVersion !== 2) F.state.flowV2 = M.create(F.state.vehicles, F.state.flow);
    return F.state.flowV2;
  }
  const graph = () => scope === "root" ? model().graph : model().graph.nodes.find((n) => n.id === scope)?.children;
  const selected = () => graph()?.nodes.find((n) => n.id === selectedId);
  const spec = (n) => M.catalog[n.kind];
  const title = (n) => n.title || spec(n)?.title || n.kind;
  const outputs = (n) => spec(n)?.outputs || [];
  const quickField = (n) => (spec(n)?.fields || []).find((f) => ["threshold", "targetSoc", "minutes", "waitMinutes"].includes(f.key));
  const nodeHeight = (n) => 53 + 44 + (quickField(n) ? 52 : 0) + (n.children ? 32 : 0) + outputs(n).length * 27 + 12;
  const outputY = (n, key) => 53 + 44 + (quickField(n) ? 52 : 0) + (n.children ? 32 : 0) + Math.max(0, outputs(n).findIndex((o) => o.key === key)) * 27 + 13.5;
  const point = (n, port, key) => ({ x: n.x + (port === "output" ? 248 : 0), y: n.y + (port === "output" ? outputY(n, key) : 32) });
  const path = (a, b) => {
    const bend = Math.max(60, Math.abs(b.x - a.x) * 0.45);
    return `M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`;
  };
  function edgePath(edge, a, b) {
    const p = point(a, "output", edge.outcome), q = point(b, "input");
    if (q.x > p.x) return path(p, q);
    const lane = Math.max(a.y + nodeHeight(a), b.y + nodeHeight(b)) + 24 + outputs(a).findIndex((o) => o.key === edge.outcome) * 12;
    return `M${p.x},${p.y} H${p.x + 20} Q${p.x + 30},${p.y} ${p.x + 30},${p.y + 10} V${lane - 10} Q${p.x + 30},${lane} ${p.x + 20},${lane} H${q.x - 32} Q${q.x - 42},${lane} ${q.x - 42},${lane - 10} V${q.y + 10} Q${q.x - 42},${q.y} ${q.x - 32},${q.y} H${q.x}`;
  }
  const issues = () => M.validate(model(), F.state.vehicles);
  function status(text) {
    const el = root?.querySelector(".flow-save-status");
    if (el) el.textContent = text;
  }
  function changed() {
    stopPlayback();
    dirty = true;
    model().draft = true;
    results = [];
    status("有未保存的更改");
    const badge = root?.querySelector(".flow-version");
    if (badge) badge.textContent = "草稿 v2." + model().version;
    renderSimulation();
    updateValidation();
  }
  function save() {
    if (!flushInspector()) return;
    model().savedAt = now();
    F.save();
    dirty = false;
    status("已保存于 " + model().savedAt);
    const count = issues().length;
    F.toast(count ? `草稿已保存，${count} 项配置待修复` : "流程与车组配置已保存", count ? "warning" : "success");
  }
  function summary(n) {
    if (n.kind === "trigger") return `${model().group.shiftStart} 启动 · 每辆车独立执行`;
    if (n.kind === "decide") return "按班次与电量，选择唯一去向";
    if (n.kind === "manual") return `承接 ${model().graph.edges.filter((e) => e.to === n.id && e.outcome === "error").length} 个异常出口 · 处理后复检或终止`;
    return spec(n)?.description || "";
  }
  function nodeHTML(n, ghost = false) {
    const k = spec(n), q = quickField(n);
    return `<div class="flow-node ${selectedId === n.id ? "is-selected" : ""}" role="group" tabindex="${ghost ? -1 : 0}" data-node="${h(n.id)}" aria-label="${h(title(n))}，可拖动" style="left:${n.x}px;top:${n.y}px;height:${nodeHeight(n)}px;--node-color:${k.color}">
      ${n.kind !== "trigger" && n.kind !== "stepStart" ? `<button type="button" class="flow-node-port input" data-port="input" style="top:19px" aria-label="${h(title(n))} 输入端口"></button>` : ""}
      <div class="flow-node-header"><i>${k.icon || "◇"}</i><span><small>${h(k.subtitle || "流程步骤")}</small><b>${h(title(n))}</b></span></div>
      <div class="flow-node-summary">${h(summary(n))}</div>
      ${q ? `<label class="flow-node-quick"><span>${h(q.label)} <output>${h(n.config[q.key])}${["threshold", "targetSoc"].includes(q.key) ? "%" : " min"}</output></span><input type="range" data-quick="${h(q.key)}" min="${q.min ?? 1}" max="${q.max ?? 100}" step="${q.step ?? 1}" value="${h(n.config[q.key])}" aria-label="${h(title(n) + " " + q.label)}"></label>` : ""}
      ${n.children ? `<button type="button" class="flow-node-open" data-action="flow-open" data-id="${h(n.id)}">查看 ${n.children.nodes.filter((x) => !["stepStart", "stepEnd"].includes(x.kind)).length} 个子步骤 <span>↗</span></button>` : ""}
      <div class="flow-node-results">${outputs(n).map((o) => `<div class="flow-node-result" style="--result-color:${o.color || k.color}"><span>${h(o.label)}</span><button type="button" class="flow-node-port output" data-port="output" data-outcome="${h(o.key)}" style="top:${outputY(n, o.key) - 13}px" aria-label="${h(title(n) + " " + o.label + " 输出端口")}"></button></div>`).join("")}</div></div>`;
  }
  function wires() {
    const g = graph();
    return `<svg class="flow-wires" width="2400" height="1800" viewBox="0 0 2400 1800"><defs><marker id="flow-arrow-v2" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>${g.edges.map((e) => {
      const a = g.nodes.find((n) => n.id === e.from), b = g.nodes.find((n) => n.id === e.to);
      if (!a || !b) return "";
      if (scope === "root" && !showExceptions && (e.outcome === "error" || a.kind === "manual") && a.id !== selectedId && b.id !== selectedId) return "";
      const o = outputs(a).find((o2) => o2.key === e.outcome), d = edgePath(e, a, b);
      return `<g class="flow-edge ${selectedEdge === e.id ? "is-selected" : ""}"><path class="flow-wire" d="${d}" stroke="${o?.color || spec(a).color}" marker-end="url(#flow-arrow-v2)"/><path class="flow-wire-hit" data-edge="${h(e.id)}" d="${d}" role="button" tabindex="0" aria-label="选择连线 ${h(title(a) + " " + (o?.label || "") + " 到 " + title(b))}"/></g>`;
    }).join("")}<path class="flow-wire-preview" style="display:none"/></svg>`;
  }
  function draw() {
    if (!stage || !graph()) return;
    stage.innerHTML = wires() + graph().nodes.map((n) => nodeHTML(n)).join("");
    applyView();
    updateValidation();
    const toolbar = root.querySelector(".flow-link-toolbar"), edge = graph().edges.find((e) => e.id === selectedEdge);
    toolbar.hidden = !edge;
    if (edge) {
      const a = graph().nodes.find((n) => n.id === edge.from), b = graph().nodes.find((n) => n.id === edge.to);
      toolbar.querySelector("span").textContent = `${title(a)} → ${title(b)}`;
    }
    root.querySelector(".flow-undo-delete").hidden = !undo || undo.scope !== scope;
    previewLink();
  }
  function applyView() {
    if (stage) stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    const el = root?.querySelector(".flow-zoom-value");
    if (el) el.textContent = Math.round(view.scale * 100) + "%";
  }
  function fit() {
    const ns = graph()?.nodes;
    if (!ns?.length) return;
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y)), w = Math.max(...ns.map((n) => n.x + 248)) - minX, z = Math.max(...ns.map((n) => n.y + nodeHeight(n))) - minY;
    view.scale = Math.min(1, Math.max(0.3, Math.min((canvas.clientWidth - 100) / w, (canvas.clientHeight - 150) / z)));
    view.x = (canvas.clientWidth - w * view.scale) / 2 - minX * view.scale;
    view.y = 60 + (canvas.clientHeight - 150 - z * view.scale) / 2 - minY * view.scale;
    applyView();
  }
  function zoom(factor) {
    const old = view.scale, next = Math.max(0.3, Math.min(1.5, old * factor)), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
    view.x = x - (x - view.x) * next / old;
    view.y = y - (y - view.y) * next / old;
    view.scale = next;
    applyView();
  }
  function graphPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.scale, y: (e.clientY - r.top - view.y) / view.scale };
  }
  function updateValidation() {
    if (!root) return;
    const list = issues(), el = root.querySelector(".flow-validation");
    el.classList.toggle("has-error", !!list.length);
    el.textContent = list.length ? `⚠ ${list.length} 项待修复 · ${list[0].message}` : "✓ 流程连接与车组配置完整";
  }
  function choose(id) {
    if (id !== selectedId && !flushInspector()) return;
    selectedId = id;
    selectedEdge = null;
    root.querySelector(".flow-workspace").classList.toggle("is-inspecting", !!id);
    draw();
    refreshInspector();
    canvas?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const n = selected();
      if (!canvas || !n) return;
      const x = n.x * view.scale + view.x, y = n.y * view.scale + view.y;
      if (x < 16 || x + 248 * view.scale > canvas.clientWidth - 16) view.x = canvas.clientWidth / 2 - (n.x + 124) * view.scale;
      if (y < 50 || y + nodeHeight(n) * view.scale > canvas.clientHeight - 90) view.y = canvas.clientHeight / 2 - (n.y + nodeHeight(n) / 2) * view.scale;
      applyView();
    });
  }
  function fieldHTML(n, f) {
    const v = n.config?.[f.key] ?? "";
    return `<label class="flow-form-label">${h(f.label)}${f.type === "select" ? `<select data-field="${h(f.key)}" aria-label="${h(f.label)}">${f.options.map((o) => `<option value="${h(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${h(o.label)}</option>`).join("")}</select>` : `<input type="${f.type || "number"}" data-field="${h(f.key)}" min="${f.min ?? ""}" max="${f.max ?? ""}" step="${f.step ?? 1}" value="${h(v)}" aria-label="${h(f.label)}">`}</label>`;
  }
  function inspector() {
    const n = selected();
    if (!n) return `<div class="flow-empty-selection">选择一张卡片，查看步骤和结果出口。</div>`;
    const g = graph();
    return `<header class="flow-inspector-head"><button class="flow-inspector-close" data-action="flow-deselect" aria-label="收起配置栏">×</button><span class="eyebrow">${scope === "root" ? "主流程配置" : "子步骤配置"}</span><h3>${h(title(n))}</h3><p>${h(spec(n).subtitle || "流程步骤")}</p></header><div class="flow-inspector-body">
    <label class="flow-form-label">卡片名称<input value="${h(title(n))}" maxlength="32" data-field="title" aria-label="卡片名称"></label>
    <p class="flow-field-help">${h(summary(n))}</p>${(spec(n).fields || []).map((f) => fieldHTML(n, f)).join("")}
    ${n.kind === "trigger" ? `<div class="flow-rule-box">${h(model().group.name)} · ${model().group.vehicleIds.length} 辆<br>${h(model().group.shiftStart)}–${h(model().group.shiftEnd)}<button class="btn subtle" data-action="flow-group">设置车组与班次</button></div>` : ""}
    ${n.children ? `<div class="flow-section-label">包含的子步骤<button class="btn subtle" data-action="flow-open" data-id="${h(n.id)}">进入编辑 ↗</button></div><ul class="flow-child-list">${n.children.nodes.filter((x) => !["stepStart", "stepEnd"].includes(x.kind)).map((x) => `<li>${h(title(x))}</li>`).join("")}</ul><p class="flow-field-help">具体执行顺序以阶段内连线为准。</p>` : ""}
    ${outputs(n).length ? `<div class="flow-section-label">结果与下一步</div>${outputs(n).map((o) => {
      const edge = g.edges.find((e) => e.from === n.id && e.outcome === o.key);
      return `<label class="flow-output-item"><span><i style="background:${o.color || spec(n).color}"></i>${h(o.label)}</span><select data-output="${h(o.key)}" aria-label="${h(o.label + " 下一步")}"><option value="">未连接</option>${g.nodes.filter((x) => x.id !== n.id && !["trigger", "stepStart"].includes(x.kind)).map((x) => `<option value="${h(x.id)}" ${edge?.to === x.id ? "selected" : ""}>${h(title(x))}</option>`).join("")}</select></label>`;
    }).join("")}` : ""}
    <p class="flow-field-help">从命名出口拖出连线，或在上方选择下一步。${scope !== "root" ? "步骤失败时，沿所属主卡片的异常出口处理。" : ""}</p></div><footer class="flow-inspector-footer"><button class="btn primary" data-action="flow-save">保存草稿</button><button class="btn subtle" data-action="flow-remove">删除卡片</button></footer>`;
  }
  function refreshInspector() {
    const el = root?.querySelector(".flow-inspector");
    if (el) el.innerHTML = inspector();
  }
  function flushInspector() {
    const n = selected();
    if (!n) return true;
    let modified = false;
    for (const input of root.querySelectorAll(".flow-inspector [data-field]")) {
      const key = input.dataset.field;
      let value = input.value;
      if (key === "title") {
        value = value.trim() || spec(n).title;
        if (title(n) !== value) {
          n.title = value;
          modified = true;
        }
      } else {
        const f = spec(n).fields.find((f2) => f2.key === key);
        if (f.type === "number") {
          value = Number(input.value);
          if (!input.value.trim() || !Number.isInteger(value) || value < f.min || value > f.max) {
            F.toast(`请填写 ${f.min}–${f.max} 范围内的${f.label}`, "warning");
            input.focus();
            return false;
          }
        }
        if (n.config[key] !== value) {
          n.config[key] = value;
          modified = true;
        }
      }
    }
    if (modified) {
      changed();
      draw();
    }
    return true;
  }
  function paletteHTML() {
    const list = M.palette[scope === "root" ? "root" : model().graph.nodes.find((n) => n.id === scope)?.kind] || [];
    const groups = scope === "root" ? [["业务阶段", list.filter((k) => MAIN.includes(k))], ["触发与控制", list.filter((k) => !MAIN.includes(k))]] : [["可用子步骤", list.filter((k) => !["stepStart", "stepEnd"].includes(k))], ["阶段边界", list.filter((k) => ["stepStart", "stepEnd"].includes(k))]];
    return `<h3>${scope === "root" ? "流程组件" : "阶段子步骤"}</h3><p>拖拽至画布，或点击添加</p><input class="flow-palette-search" aria-label="搜索流程组件" placeholder="搜索组件…">${groups.filter((x) => x[1].length).map(([name, ks]) => `<div class="flow-palette-group"><h4>${name}</h4><div>${ks.map((kind) => {
      const s = M.catalog[kind];
      return `<button type="button" class="flow-palette-item" data-action="flow-add" data-kind="${kind}" aria-label="添加${h(s.title)}"><i style="color:${s.color};background:${s.color}18">${s.icon || "◇"}</i><span>${h(s.title)}<small>${h(s.subtitle || "执行步骤")}</small></span><b>+</b></button>`;
    }).join("")}</div></div>`).join("")}<div class="flow-palette-tip">${scope === "root" ? "主卡片组织业务阶段。进入卡片，可编辑内部步骤。" : "子步骤只在当前阶段生效。失败结果交给主流程统一处理。"}<br>放置卡片后，请连接明确的结果出口。</div>`;
  }
  function assignmentHTML() {
    const g = model().group;
    const members = g.vehicleIds.map((id) => F.state.vehicles.find((v) => v.id === id)).filter(Boolean), ready = members.filter((v) => !["offline", "maintenance"].includes(v.status)).length;
    return `<div class="flow-group-icon">${F.icon("vehicles", 24)}</div><div class="flow-assignment-copy"><span class="eyebrow">当前分配车组</span><h2>${h(g.name)} <span>${members.length} 辆</span></h2><p>共用一套流程 · 每辆车按自己的状态独立执行</p></div><div class="flow-group-members">${members.slice(0, 4).map((v) => `<span title="${h(v.id)}">${h(v.id)}</span>`).join("")}${members.length > 4 ? `<span>+${members.length - 4}</span>` : ""}</div><div class="flow-assignment-meta"><strong>${h(g.shiftStart)}–${h(g.shiftEnd)}</strong><span>${ready} 辆可参与 · ${members.length - ready} 辆需检查</span></div><button class="btn" data-action="flow-group">车组设置 ${F.icon("settings", 14)}</button>`;
  }
  function render() {
    const m = model();
    return `<section class="automation-page"><header class="flow-page-head"><div><h1>自动化流程 <span class="flow-version">${m.publishedAt && !m.draft ? "已发布" : "草稿"} v2.${m.version}</span></h1><p class="flow-subtitle">${h(m.name || "日常运营与补能循环")} <span class="flow-save-status">${dirty ? "有未保存的更改" : m.savedAt ? "已保存于 " + h(m.savedAt) : "未保存的演示草稿"}</span></p></div><div class="flow-head-actions"><button class="btn" data-action="flow-check">检查流程</button><button class="btn" data-action="flow-save">保存草稿</button><button class="btn primary" data-action="flow-publish">发布演示版本</button></div></header>
    <section class="flow-assignment">${assignmentHTML()}</section><div class="flow-toolbar"><div class="flow-breadcrumb"><strong>主流程</strong><span>4 个业务阶段 · 按车辆独立运行</span></div><div class="flow-toolbar-actions"><button class="btn subtle flow-exception-toggle" data-action="flow-exceptions" aria-pressed="false">显示异常连线</button><select class="flow-scenario" aria-label="模拟场景"><option value="current">按车辆当前状态</option><option value="low">低电量回场</option><option value="closing">到达收班时间</option><option value="resource">补能资源不足</option><option value="missing">车辆数据缺失</option></select><button class="btn primary" data-action="flow-simulate">▷ 车组模拟</button></div></div>
    <div class="flow-workspace"><aside class="flow-palette"></aside><div class="flow-canvas" tabindex="0" aria-label="自动化流程画布"><div class="flow-canvas-caption">主流程<span>拖动卡片调整位置 · 从结果出口连接下一步</span></div><div class="flow-stage"></div><div class="flow-link-toolbar" hidden><span></span><button data-action="flow-disconnect">断开连线</button><button data-action="flow-clear-edge" aria-label="取消选中连线">×</button></div><div class="flow-canvas-bottom"><button class="flow-validation" data-action="flow-check"></button><div class="flow-controls"><button data-action="flow-zoom-out" aria-label="缩小">−</button><span class="flow-zoom-value">100%</span><button data-action="flow-zoom-in" aria-label="放大">+</button><button data-action="flow-fit" aria-label="适应画布">⛶</button></div></div><div class="flow-trash"><div class="flow-trash-zone" role="region" aria-label="节点垃圾桶">${F.icon("close", 18)}<span>拖入此处删除</span></div><button class="flow-undo-delete" data-action="flow-undo" hidden>↶ 撤销删除</button></div></div><aside class="flow-inspector"></aside></div><section class="flow-simulation" hidden></section><div class="flow-local-note">演示环境 · 车组、流程与模拟结果仅保存在当前浏览器，不向车辆发送指令。${F.state.flow ? "旧版流程草稿已保留。" : ""}</div></section>`;
  }
  function enter(next) {
    if (!root) return;
    stopPlayback();
    views[scope] = { ...view };
    scope = next;
    selectedId = null;
    selectedEdge = null;
    pending = null;
    root.querySelector(".flow-workspace").classList.remove("is-inspecting");
    const parent = model().graph.nodes.find((n) => n.id === scope);
    root.querySelector(".flow-breadcrumb").innerHTML = scope === "root" ? "<strong>主流程</strong><span>业务阶段与结果分支</span>" : `<button class="btn subtle" data-action="flow-root">← 返回主流程</button><strong>${h(title(parent))}</strong><span>阶段子步骤</span>`;
    root.querySelector(".flow-canvas-caption").innerHTML = `${scope === "root" ? "主流程" : h(title(parent))}<span>${scope === "root" ? "拖动卡片调整位置 · 从结果出口连接下一步" : "按连线执行步骤 · 失败交给主卡片的异常出口"}</span>`;
    root.querySelector(".flow-palette").innerHTML = paletteHTML();
    view = views[scope] || { x: 30, y: 50, scale: 0.8 };
    draw();
    refreshInspector();
    if (!views[scope]) requestAnimationFrame(fit);
  }
  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function addNode(kind, pos) {
    if (!(M.palette[scope === "root" ? "root" : model().graph.nodes.find((n2) => n2.id === scope)?.kind] || []).includes(kind)) return;
    const g = graph();
    if (["trigger", "stepStart", "stepEnd", "end"].includes(kind) && g.nodes.some((n2) => n2.kind === kind)) {
      F.toast("当前流程已有该边界节点", "warning");
      return;
    }
    const p = pos || { x: (canvas.clientWidth / 2 - view.x) / view.scale - 124, y: (canvas.clientHeight / 2 - view.y) / view.scale - 80 };
    const n = M.createNode(kind, newId(kind), Math.max(0, p.x), Math.max(0, p.y));
    g.nodes.push(n);
    changed();
    choose(n.id);
    F.toast("已添加卡片，请连接结果出口");
  }
  function connect(from, outcome, to) {
    const g = graph(), a = g.nodes.find((n) => n.id === from), b = g.nodes.find((n) => n.id === to);
    if (!a || !b || a === b || !outputs(a).some((o) => o.key === outcome) || ["trigger", "stepStart"].includes(b.kind)) {
      F.toast("这两个端口不能连接", "warning");
      return;
    }
    const existing = g.edges.find((e) => e.from === from && e.outcome === outcome);
    if (existing?.to === to) {
      pending = null;
      return;
    }
    g.edges = g.edges.filter((e) => !(e.from === from && e.outcome === outcome));
    const edge = { id: newId("edge"), from, to, outcome };
    g.edges.push(edge);
    pending = null;
    selectedEdge = edge.id;
    changed();
    draw();
    refreshInspector();
    F.toast(existing ? "已替换该结果的下一步" : "已建立连接");
  }
  function disconnect(id) {
    const g = graph();
    g.edges = g.edges.filter((e) => e.id !== id);
    selectedEdge = null;
    changed();
    draw();
    refreshInspector();
  }
  function remove(id, original) {
    const g = graph(), n = g.nodes.find((n2) => n2.id === id);
    if (!n) return;
    undo = { scope, index: g.nodes.indexOf(n), node: clone({ ...n, ...original }), edges: clone(g.edges.filter((e) => e.from === id || e.to === id)) };
    g.nodes = g.nodes.filter((x) => x.id !== id);
    g.edges = g.edges.filter((e) => e.from !== id && e.to !== id);
    pending = null;
    changed();
    choose(null);
    F.toast("已删除卡片及关联连线，可撤销");
  }
  function restore() {
    if (!undo || undo.scope !== scope) return;
    const g = graph(), u = undo;
    undo = null;
    g.nodes.splice(u.index, 0, u.node);
    u.edges.forEach((e) => {
      if (g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to) && !g.edges.some((x) => x.from === e.from && x.outcome === e.outcome)) g.edges.push(e);
    });
    changed();
    choose(u.node.id);
  }
  function previewLink(cursor) {
    const p = stage?.querySelector(".flow-wire-preview");
    if (!p) return;
    p.style.display = pending ? "" : "none";
    stage.querySelectorAll(".flow-node-port").forEach((el) => el.classList.toggle("is-link-eligible", !!pending && el.dataset.port === "input" && el.closest("[data-node]").dataset.node !== pending.from));
    if (!pending) return;
    const a = graph().nodes.find((n) => n.id === pending.from);
    if (!a) return;
    const start = point(a, "output", pending.outcome);
    p.setAttribute("d", path(start, cursor || { x: start.x + 80, y: start.y }));
  }
  function validationDialog() {
    const list = issues();
    F.modal(list.length ? "流程检查 · 待修复" : "流程检查通过", list.length ? `<p class="muted">修复后即可模拟或发布；当前草稿仍可保存。</p><div class="flow-check-list">${list.map((item, i) => `<button type="button" class="btn" data-action="flow-focus-issue" data-index="${i}">${i + 1}. ${h(item.message)}</button>`).join("")}</div>` : '<p>车组成员、班次、节点参数和各级连线检查通过。</p><p class="muted">可以选择不同场景，模拟每辆车的执行路径。</p><div class="dialog-actions"><button class="btn primary" type="submit">完成</button></div>');
  }
  function knownGroups() {
    if (!F.state.automationGroups) F.state.automationGroups = [clone(model().group), { id: "support", name: "张江补能保障组", vehicleIds: ["RT-012", "RT-021", "RT-034", "RT-041"].filter((id) => F.state.vehicles.some((v) => v.id === id)), shiftStart: "09:00", shiftEnd: "17:00" }];
    return F.state.automationGroups;
  }
  function groupDialog() {
    let draft = clone(model().group);
    const groups = knownGroups();
    let members = new Set(draft.vehicleIds);
    const body = () => `<div class="flow-group-form"><p class="muted">绑定一个车组，每辆成员车分别执行当前流程。修改只影响演示配置。</p><label class="flow-form-label">选择车组<select name="groupId" aria-label="选择车组">${groups.map((g) => `<option value="${h(g.id)}" ${g.id === draft.id ? "selected" : ""}>${h(g.name)}</option>`).join("")}<option value="new">＋ 新建车组</option></select></label><div class="flow-form-grid"><label class="flow-form-label">车组名称<input name="groupName" value="${h(draft.name)}" required maxlength="30" aria-label="车组名称"></label><div></div><label class="flow-form-label">班次开始<input type="time" name="shiftStart" value="${h(draft.shiftStart)}" required aria-label="班次开始"></label><label class="flow-form-label">班次结束<input type="time" name="shiftEnd" value="${h(draft.shiftEnd)}" required aria-label="班次结束"></label></div><div class="flow-members-toolbar"><input class="flow-member-search" placeholder="搜索车辆编号或车牌" aria-label="搜索车组成员"><span class="flow-member-count">已选 ${members.size} 辆</span><button class="btn subtle" type="button" data-member-clear>清空</button></div><div class="flow-member-list">${F.state.vehicles.map((v) => `<label data-member-row="${h(v.id + " " + v.plate)}"><input type="checkbox" name="members" value="${h(v.id)}" ${members.has(v.id) ? "checked" : ""}><span><strong>${h(v.id)}</strong><small>${h(F.status[v.status]?.[0] || v.status)} · SOC ${v.soc}%</small></span></label>`).join("")}</div><p class="flow-field-help">离线或维修车辆可保留在车组，模拟时进入条件检查与人工处置。班次暂支持当日时段。</p><div class="dialog-actions"><button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">保存并绑定车组</button></div></div>`;
    const bind = () => {
      const form = document.querySelector(".flow-group-form");
      form.querySelector("[name=groupId]").onchange = (e) => {
        draft = e.target.value === "new" ? { id: newId("group"), name: "新车组", vehicleIds: [], shiftStart: "08:00", shiftEnd: "18:00" } : clone(groups.find((g) => g.id === e.target.value));
        members = new Set(draft.vehicleIds);
        document.querySelector("#modal-body").innerHTML = body();
        if (!groups.some((g) => g.id === draft.id)) document.querySelector("[name=groupId]").value = "new";
        bind();
      };
      form.querySelector(".flow-member-search").oninput = (e) => {
        const q = e.target.value.trim().toUpperCase();
        form.querySelectorAll("[data-member-row]").forEach((el) => el.hidden = !el.dataset.memberRow.toUpperCase().includes(q));
      };
      form.querySelectorAll("[name=members]").forEach((el) => el.onchange = () => {
        el.checked ? members.add(el.value) : members.delete(el.value);
        form.querySelector(".flow-member-count").textContent = `已选 ${members.size} 辆`;
      });
      form.querySelector("[data-member-clear]").onclick = () => {
        members.clear();
        form.querySelectorAll("[name=members]").forEach((el) => el.checked = false);
        form.querySelector(".flow-member-count").textContent = "已选 0 辆";
      };
    };
    F.modal("车组设置", body(), (data) => {
      const name = String(data.get("groupName") || "").trim(), start = String(data.get("shiftStart")), end = String(data.get("shiftEnd"));
      if (!name || !members.size) {
        F.toast(!name ? "请填写车组名称" : "请至少选择一辆车", "warning");
        return false;
      }
      if (start >= end) {
        F.toast("班次结束时间必须晚于开始时间", "warning");
        return false;
      }
      const next = { id: draft.id, name, vehicleIds: [...members], shiftStart: start, shiftEnd: end };
      const i = groups.findIndex((g) => g.id === next.id);
      if (i < 0) groups.push(clone(next));
      else groups[i] = clone(next);
      model().group = next;
      changed();
      root.querySelector(".flow-assignment").innerHTML = assignmentHTML();
      draw();
      refreshInspector();
      save();
    });
    bind();
  }
  function stopPlayback() {
    clearTimeout(timer);
    timer = null;
    playback++;
    stage?.querySelectorAll(".is-running,.is-complete").forEach((el) => el.classList.remove("is-running", "is-complete"));
  }
  function playTrace() {
    stopPlayback();
    const result = results[resultIndex];
    if (!result) return;
    const trace = result.trace.filter((t) => t.graphId === scope), token = playback;
    let i = 0;
    const step = () => {
      if (token !== playback || !root?.isConnected) return;
      stage.querySelectorAll(".is-running").forEach((el) => {
        el.classList.remove("is-running");
        el.classList.add("is-complete");
      });
      if (i >= trace.length) return;
      const t = trace[i++];
      const node = [...stage.querySelectorAll("[data-node]")].find((el) => el.dataset.node === t.nodeId);
      node?.classList.add("is-running");
      timer = setTimeout(step, 450);
    };
    step();
  }
  function renderSimulation() {
    const panel = root?.querySelector(".flow-simulation");
    if (!panel) return;
    panel.hidden = !results.length;
    if (!results.length) return;
    const r = results[resultIndex], labels = { waiting: "等待下一事件", completed: "已结束", manual: "等待人工", blocked: "流程阻塞" };
    panel.innerHTML = `<header><div><h3>车组模拟结果 <span>${results.length} 辆</span></h3><p>沿当前连线逐车演算 · 一次运营观察窗口 · 不改变车辆与计划数据</p></div><button class="btn" data-action="flow-play">回放当前画布</button><button class="btn subtle" data-action="flow-hide-results" aria-label="关闭模拟结果">×</button></header><div class="flow-simulation-grid"><div class="flow-vehicle-results">${results.map((x, i) => `<button class="flow-vehicle-result ${i === resultIndex ? "is-selected" : ""}" data-action="flow-result" data-index="${i}"><strong>${h(x.vehicleId)}</strong><span class="flow-status-badge ${h(x.status)}">${h(labels[x.status] || x.status)}</span></button>`).join("")}</div><div class="flow-trace"><div class="flow-trace-heading"><strong>${h(r.vehicleId)} · ${h(r.summary)}</strong>${r.status === "manual" ? `<div><button class="btn" data-action="flow-recover">模拟处理后复检</button><button class="btn subtle" data-action="flow-terminate">终止本车模拟</button></div>` : ""}</div><ol>${r.trace.map((t, i) => `<li><span class="flow-trace-index">${i + 1}</span><div class="flow-trace-content"><strong>${h(t.title || t.nodeId)}${t.graphId !== "root" ? "<small>阶段内步骤</small>" : ""}</strong><p>${h(t.message || t.outcome || "进入节点")}</p></div><button class="btn subtle" data-action="flow-trace-focus" data-scope="${h(t.graphId)}" data-id="${h(t.nodeId)}" aria-label="定位${h(t.title || t.nodeId)}">↗</button></li>`).join("")}</ol></div></div>`;
  }
  function simulate() {
    if (issues().length) {
      validationDialog();
      return;
    }
    simulationScenario = root.querySelector(".flow-scenario").value;
    results = model().group.vehicleIds.map((id) => M.simulate(model(), F.state.vehicles.find((v) => v.id === id), simulationScenario));
    resultIndex = 0;
    renderSimulation();
    playTrace();
    root.querySelector(".flow-simulation").scrollIntoView({ behavior: "smooth", block: "nearest" });
    F.toast(`已完成 ${results.length} 辆车的路径演算`);
  }
  function bindCanvas(signal) {
    let suppressed = null;
    const inCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const inTrash = (e) => {
      const r = root.querySelector(".flow-trash-zone").getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const targetAt = (e) => {
      const node = document.elementFromPoint(e.clientX, e.clientY)?.closest(".flow-node-port.input");
      return node?.closest("[data-node]")?.dataset.node;
    };
    root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const item = e.target.closest(".flow-palette-item"), node = e.target.closest("[data-node]"), port = e.target.closest("[data-port]");
      if (item) {
        drag = { type: "add", kind: item.dataset.kind, px: e.clientX, py: e.clientY, pointerId: e.pointerId, target: item };
        item.setPointerCapture(e.pointerId);
        return;
      }
      if (port && port.dataset.port === "output") {
        pending = { from: node.dataset.node, outcome: port.dataset.outcome };
        drag = { type: "link", px: e.clientX, py: e.clientY, pointerId: e.pointerId, target: port };
        port.setPointerCapture(e.pointerId);
        previewLink();
        return;
      }
      if (e.target.closest("button,input,select,[data-edge]")) return;
      if (node) {
        const n = graph().nodes.find((n2) => n2.id === node.dataset.node);
        drag = { type: "node", id: n.id, x: n.x, y: n.y, px: e.clientX, py: e.clientY, pointerId: e.pointerId, target: canvas };
        canvas.setPointerCapture(e.pointerId);
      } else if (e.target.closest(".flow-canvas")) {
        drag = { type: "pan", x: view.x, y: view.y, px: e.clientX, py: e.clientY, pointerId: e.pointerId, target: canvas };
        canvas.setPointerCapture(e.pointerId);
      }
    }, { signal });
    window.addEventListener("pointermove", (e) => {
      if (pending && !drag) previewLink(graphPoint(e));
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag, dx = e.clientX - d.px, dy = e.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      e.preventDefault();
      if (d.type === "node") {
        const n = graph().nodes.find((n2) => n2.id === d.id);
        n.x = Math.max(0, d.x + dx / view.scale);
        n.y = Math.max(0, d.y + dy / view.scale);
        draw();
        root.querySelector(".flow-trash-zone").classList.add("is-active");
        root.querySelector(".flow-trash-zone").classList.toggle("is-over", inTrash(e));
      }
      if (d.type === "pan") {
        view.x = d.x + dx;
        view.y = d.y + dy;
        applyView();
      }
      if (d.type === "link") previewLink(graphPoint(e));
      if (d.type === "add") {
        if (!d.ghost) {
          d.ghost = document.createElement("div");
          d.ghost.className = "flow-drag-preview";
          d.ghost.innerHTML = `<strong>${h(M.catalog[d.kind].title)}</strong><span>松开放置 · Esc 取消</span>`;
          document.body.append(d.ghost);
        }
        d.ghost.style.left = e.clientX + 14 + "px";
        d.ghost.style.top = e.clientY + 12 + "px";
        canvas.classList.toggle("is-drop-target", inCanvas(e));
      }
    }, { signal, passive: false });
    function finish(e, commit) {
      const d = drag;
      if (!d) return;
      drag = null;
      d.ghost?.remove();
      canvas.classList.remove("is-drop-target");
      root.querySelector(".flow-trash-zone").classList.remove("is-over", "is-active");
      if (d.target.hasPointerCapture(d.pointerId)) d.target.releasePointerCapture(d.pointerId);
      if (d.moved) {
        suppressed = d.type === "add" ? "palette" : d.type;
        setTimeout(() => suppressed = null, 0);
      }
      if (d.type === "node") {
        const n = graph().nodes.find((n2) => n2.id === d.id);
        if (!commit) {
          n.x = d.x;
          n.y = d.y;
          draw();
        } else if (d.moved && inTrash(e)) remove(d.id, { x: d.x, y: d.y });
        else {
          if (d.moved) changed();
          choose(d.id);
        }
      }
      if (d.type === "add" && d.moved && commit && inCanvas(e) && !inTrash(e)) {
        const p = graphPoint(e);
        addNode(d.kind, { x: p.x - 124, y: p.y - 32 });
      }
      if (d.type === "link" && d.moved) {
        const target = commit ? targetAt(e) : null;
        if (target && pending) connect(pending.from, pending.outcome, target);
        else {
          pending = null;
          previewLink();
        }
      }
    }
    window.addEventListener("pointerup", (e) => finish(e, true), { signal });
    window.addEventListener("pointercancel", (e) => finish(e, false), { signal });
    window.addEventListener("blur", (e) => {
      finish(e, false);
      pending = null;
      previewLink();
    }, { signal });
    root.addEventListener("click", (e) => {
      if (suppressed) {
        const type = suppressed;
        suppressed = null;
        if (type === "palette" && e.target.closest(".flow-palette-item") || e.target.closest(".flow-canvas")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      const port = e.target.closest("[data-port]"), node = e.target.closest("[data-node]"), edge = e.target.closest("[data-edge]");
      if (port) {
        e.preventDefault();
        e.stopPropagation();
        if (port.dataset.port === "input" && pending) connect(pending.from, pending.outcome, node.dataset.node);
        else if (port.dataset.port === "output") {
          pending = { from: node.dataset.node, outcome: port.dataset.outcome };
          previewLink();
        }
        return;
      }
      if (edge) {
        selectedEdge = edge.dataset.edge;
        draw();
        canvas.focus({ preventScroll: true });
        return;
      }
      if (node && !e.target.closest("button,input,select")) choose(node.dataset.node);
    }, { signal, capture: true });
    canvas.addEventListener("wheel", (e) => {
      if (e.target.closest("input,select")) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, old = view.scale, next = Math.max(0.3, Math.min(1.5, old * Math.exp(-e.deltaY * 1e-3)));
      view.x = x - (x - view.x) * next / old;
      view.y = y - (y - view.y) * next / old;
      view.scale = next;
      applyView();
    }, { signal, passive: false });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        finish(e, false);
        pending = null;
        selectedEdge = null;
        draw();
      }
      if (e.target.matches("input,select,textarea")) return;
      if (["Delete", "Backspace"].includes(e.key) && e.target.closest(".flow-canvas")) {
        e.preventDefault();
        if (selectedEdge) disconnect(selectedEdge);
        else if (selectedId) remove(selectedId);
      }
      if (e.key === "Enter" && e.target.matches("[data-node]")) choose(e.target.dataset.node);
    }, { signal });
  }
  function mount(container) {
    root = container;
    canvas = root.querySelector(".flow-canvas");
    stage = root.querySelector(".flow-stage");
    scope = "root";
    showExceptions = false;
    selectedId = null;
    selectedEdge = null;
    pending = null;
    views = {};
    undo = null;
    results = [];
    controller = new AbortController();
    const signal = controller.signal;
    root.querySelector(".flow-palette").innerHTML = paletteHTML();
    draw();
    refreshInspector();
    requestAnimationFrame(fit);
    bindCanvas(signal);
    root.addEventListener("input", (e) => {
      if (e.target.matches(".flow-palette-search")) {
        const q = e.target.value.trim();
        root.querySelectorAll(".flow-palette-item").forEach((el) => el.hidden = !el.textContent.includes(q));
        return;
      }
      const fieldKey = e.target.dataset.field, editing = selected();
      if (fieldKey && editing) {
        const field = spec(editing).fields.find((f) => f.key === fieldKey);
        if (fieldKey === "title" && e.target.value.trim()) editing.title = e.target.value.trim();
        else if (field?.type === "number" && e.target.value.trim() && e.target.checkValidity()) editing.config[fieldKey] = Number(e.target.value);
        else return;
        changed();
        draw();
        const heading = root.querySelector(".flow-inspector-head h3");
        if (heading) heading.textContent = title(editing);
        return;
      }
      const key = e.target.dataset.quick;
      if (key) {
        const n = graph().nodes.find((n2) => n2.id === e.target.closest("[data-node]").dataset.node);
        n.config[key] = Number(e.target.value);
        e.target.previousElementSibling.querySelector("output").textContent = e.target.value + (["threshold", "targetSoc"].includes(key) ? "%" : " min");
        changed();
        if (selectedId === n.id) refreshInspector();
      }
    }, { signal });
    root.addEventListener("change", (e) => {
      const key = e.target.dataset.field, n = selected();
      if (key && n) {
        if (key === "title") {
          n.title = e.target.value.trim() || spec(n).title;
        } else {
          const field = spec(n).fields.find((f) => f.key === key);
          if (field.type === "number" && (!e.target.value.trim() || !e.target.checkValidity())) {
            F.toast("请填写有效的" + field.label, "warning");
            e.target.value = n.config[key];
            return;
          }
          n.config[key] = field.type === "number" ? Number(e.target.value) : e.target.value;
        }
        changed();
        draw();
        const heading = root.querySelector(".flow-inspector-head h3");
        if (heading) heading.textContent = title(n);
      }
      const outcome = e.target.dataset.output;
      if (outcome && n) {
        const edge = graph().edges.find((x) => x.from === n.id && x.outcome === outcome);
        if (e.target.value) connect(n.id, outcome, e.target.value);
        else if (edge) disconnect(edge.id);
      }
    }, { signal });
    observer = new ResizeObserver(() => applyView());
    observer.observe(canvas);
    F.cleanup = () => {
      stopPlayback();
      controller.abort();
      observer.disconnect();
      drag?.ghost?.remove();
      drag = null;
      pending = null;
      root = null;
      canvas = null;
      stage = null;
    };
  }
  function action(a, el) {
    if (!a?.startsWith("flow-")) return false;
    if (["flow-check", "flow-simulate", "flow-publish", "flow-open", "flow-root", "flow-deselect", "flow-group"].includes(a) && !flushInspector()) return true;
    if (a === "flow-group") groupDialog();
    else if (a === "flow-save") save();
    else if (a === "flow-check") validationDialog();
    else if (a === "flow-add") addNode(el.dataset.kind);
    else if (a === "flow-open") enter(el.dataset.id);
    else if (a === "flow-root") enter("root");
    else if (a === "flow-deselect") choose(null);
    else if (a === "flow-fit") fit();
    else if (a === "flow-zoom-in") zoom(1.2);
    else if (a === "flow-zoom-out") zoom(1 / 1.2);
    else if (a === "flow-remove") remove(selectedId);
    else if (a === "flow-undo") restore();
    else if (a === "flow-disconnect") disconnect(selectedEdge);
    else if (a === "flow-clear-edge") {
      selectedEdge = null;
      draw();
    } else if (a === "flow-focus-issue") {
      const issue = issues()[Number(el.dataset.index)];
      document.querySelector("#modal").close();
      if (issue) {
        enter(issue.graphId || "root");
        if (issue.nodeId) choose(issue.nodeId);
        fit();
      }
    } else if (a === "flow-exceptions") {
      showExceptions = !showExceptions;
      el.textContent = showExceptions ? "收起异常连线" : "显示异常连线";
      el.setAttribute("aria-pressed", String(showExceptions));
      draw();
    } else if (a === "flow-simulate") simulate();
    else if (a === "flow-result") {
      resultIndex = Number(el.dataset.index);
      renderSimulation();
      playTrace();
    } else if (a === "flow-play") playTrace();
    else if (a === "flow-hide-results") {
      stopPlayback();
      results = [];
      renderSimulation();
    } else if (a === "flow-trace-focus") {
      enter(el.dataset.scope);
      choose(el.dataset.id);
      const n = selected();
      if (n) {
        view.scale = 0.9;
        view.x = canvas.clientWidth / 2 - (n.x + 124) * view.scale;
        view.y = canvas.clientHeight / 2 - (n.y + nodeHeight(n) / 2) * view.scale;
        applyView();
      }
      canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (a === "flow-recover" || a === "flow-terminate") {
      const previous = results[resultIndex], vehicle = F.state.vehicles.find((v) => v.id === previous.vehicleId);
      results[resultIndex] = M.simulate(model(), vehicle, simulationScenario, { manualAction: a === "flow-recover" ? "resume" : "end", resumeState: previous.resumeState });
      renderSimulation();
      playTrace();
    } else if (a === "flow-publish") {
      if (issues().length) {
        validationDialog();
        return true;
      }
      F.modal("发布演示版本", `<p>将此流程绑定到 <strong>${h(model().group.name)}</strong> 的 ${model().group.vehicleIds.length} 辆车，班次 ${h(model().group.shiftStart)}–${h(model().group.shiftEnd)}。</p><p class="muted">仅保存当前浏览器的演示版本，不向车辆发送指令。</p><div class="dialog-actions"><button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">确认发布演示版本</button></div>`, () => {
        model().version++;
        model().publishedAt = now();
        model().draft = false;
        model().savedAt = now();
        model().publishedSnapshot = clone({ group: model().group, graph: model().graph });
        F.save();
        dirty = false;
        status("已发布于 " + model().publishedAt);
        root.querySelector(".flow-version").textContent = "已发布 v2." + model().version;
        F.toast("演示版本已保存");
      });
    }
    return true;
  }
  F.pages.automation = { render, mount, action };
})();
