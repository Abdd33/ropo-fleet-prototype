(() => {
  'use strict';
  const F = typeof Fleet !== 'undefined' ? Fleet : window.Fleet;
  const esc = value => F.h(String(value ?? ''));
  const kinds = {
    start: {title:'班次启动', sub:'触发节点', icon:'⚑', color:'#4389ff', detail:'定时 08:00 · 12 辆车唤醒'},
    event: {title:'事件触发', sub:'触发节点', icon:'ϟ', color:'#34b8d5', detail:'接收车辆状态事件'},
    check: {title:'运营条件校验', sub:'自检', icon:'✓', color:'#34b8d5', detail:'时段 / 硬件 / 状态'},
    condition: {title:'是否需要补能？', sub:'条件判断', icon:'⑂', color:'#ffb300', detail:'判断当前车辆电量'},
    parallel: {title:'并行网关', sub:'逻辑控制', icon:'⑃', color:'#7d9de5', detail:'同时执行下游分支'},
    dispatch: {title:'开放接单', sub:'运营动作', icon:'⊙', color:'#10bd8e', detail:'进入运营 · 允许派单'},
    pause: {title:'暂停派单', sub:'运营动作', icon:'Ⅱ', color:'#96a0b4', detail:'暂停接收新的运营任务'},
    waiting: {title:'等待派单', sub:'监听', icon:'◷', color:'#ffb300', detail:'轮询监听 · 超时 15m'},
    passenger: {title:'接送乘客流程', sub:'业务流程', icon:'▣', color:'#7d9de5', detail:'接驾 → 上车 → 送达'},
    charge: {title:'回场充电子流程', sub:'补能执行', icon:'ϟ', color:'#9568ff', detail:'暂停派单 → 锁定桩位 → 补能'},
    finish: {title:'收班归巢', sub:'业务流程', icon:'▤', color:'#96a0b4', detail:'完成任务后返回运营场站'},
    manual: {title:'转人工接管', sub:'异常处理', icon:'⌁', color:'#ef5e69', detail:'通知运营员 · 等待处理'}
  };
  const defaultNodes = () => [
    {id:'N01',kind:'start',x:38,y:80}, {id:'N02',kind:'check',x:278,y:80},
    {id:'N03',kind:'condition',x:518,y:80}, {id:'N04',kind:'dispatch',x:758,y:80},
    {id:'N05',kind:'waiting',x:998,y:80}, {id:'N07',kind:'charge',x:518,y:330},
    {id:'N09',kind:'manual',x:758,y:330}
  ];
  const defaultEdges = () => [
    {from:'N01',to:'N02'}, {from:'N02',to:'N03'},
    {from:'N03',to:'N04',label:'False · 电量充裕',color:'#10bd8e'},
    {from:'N04',to:'N05'}, {from:'N03',to:'N07',label:'True · 需要补能',color:'#9568ff'},
    {from:'N03',to:'N09',label:'异常 · 数据缺失',color:'#ef5e69'},
    {from:'N07',to:'N02',label:'补能完成 · 重新校验',color:'#9568ff'}
  ];
  function state() {
    if (!F.state.flow || !Array.isArray(F.state.flow.nodes)) F.state.flow = {nodes:defaultNodes(),edges:defaultEdges(),threshold:30,reserve:8,maxSoc:35,version:3,selected:'N03',savedAt:null,publishedAt:null};
    const s=F.state.flow;
    if (!Array.isArray(s.edges)) s.edges=defaultEdges();
    if (s.threshold == null) s.threshold=30;
    if (s.reserve == null) s.reserve=8;
    if (s.maxSoc == null) s.maxSoc=35;
    s.nodeSequence=Math.max(s.nodeSequence||0,...s.nodes.map(n=>Number(n.id.slice(1))||0));
    return s;
  }
  let root, surface, stage, current={scale:1,x:0,y:0}, drag=null, dirty=false, running=false, runId=0, observer;
  let selectedEdge=null,pendingLink=null,lastDeleted=null;
  const now = () => new Date().toLocaleTimeString('zh-CN',{hour12:false});
  function selected() {const s=state();return s.nodes.find(n=>n.id===s.selected)||s.nodes[0];}
  function status(text) {if(root?.isConnected){const el=root.querySelector('.flow-save-status');if(el)el.textContent=text;}}
  function changed() {dirty=true;state().draft=true;status('有未保存的更改');const badge=root?.querySelector('.flow-version');if(badge)badge.textContent='草稿 v1.'+(state().version||3);}
  function persist(message='流程配置已保存') {state().savedAt=now();F.save();dirty=false;status(`已保存于 ${state().savedAt}`);if(message)F.toast(message);}
  function label(node) {return node.title || kinds[node.kind]?.title || '流程节点';}
  function connectionMarkup(node) {
    const links=state().edges.map((edge,index)=>({edge,index})).filter(({edge})=>edge.from===node.id||edge.to===node.id);
    const targets=state().nodes.filter(n=>n.id!==node.id&&!state().edges.some(e=>e.from===node.id&&e.to===n.id));
    return `<div class="flow-section-label">节点连接 <small>${links.length} 条</small></div><div class="flow-connections">${links.map(({edge,index})=>`<div class="flow-connection-row"><button class="flow-connection-select" data-action="flow-edge-select" data-edge="${index}">${esc(edge.from)} → ${esc(edge.to)}<small>${esc(edge.label||'普通连接')}</small></button><button class="flow-disconnect" data-action="flow-disconnect" data-edge="${index}" aria-label="断开 ${esc(edge.from)} 到 ${esc(edge.to)}">断开</button></div>`).join('')||'<p class="flow-inspector-tip">暂无连接，可拖动端口连接其他节点。</p>'}</div><label class="flow-form-label flow-connect-label">连接到<select class="flow-connect-target" aria-label="连接到节点" ${targets.length?'':'disabled'}><option value="">选择下游节点</option>${targets.map(n=>`<option value="${esc(n.id)}">${esc(n.id+' '+label(n))}</option>`).join('')}</select></label><button class="btn flow-connect-button" data-action="flow-connect-add" ${targets.length?'':'disabled'}>建立连接</button>`;
  }
  function graphPoint(event) {
    const rect=surface.getBoundingClientRect();
    return {x:(event.clientX-rect.left-surface.clientLeft+surface.scrollLeft-current.x)/current.scale,y:(event.clientY-rect.top-surface.clientTop+surface.scrollTop-current.y)/current.scale};
  }
  function portPoint(node,port) {return {x:node.x+(port==='output'?184:0),y:node.y+51};}
  function curve(from,to) {
    const bend=Math.max(55,Math.abs(to.x-from.x)*.5);
    return `M${from.x},${from.y} C${from.x+bend},${from.y} ${to.x-bend},${to.y} ${to.x},${to.y}`;
  }
  function connectNodes(from,to) {
    const s=state();if(!s.nodes.some(n=>n.id===from)||!s.nodes.some(n=>n.id===to))return;
    if(from===to){F.toast('请选择另一个节点','error');return;}
    if(s.edges.some(e=>e.from===from&&e.to===to)){F.toast('这两个节点已连接','error');return;}
    const edge={...(defaultEdges().find(e=>e.from===from&&e.to===to)||{color:'#4389ff'}),from,to};
    s.edges.push(edge);selectedEdge=edge;pendingLink=null;changed();draw();refreshInspector();F.toast(`已连接 ${from} → ${to}`);
  }
  function disconnectEdge(edge) {
    if(!edge)return;const s=state();s.edges=s.edges.filter(e=>e!==edge);selectedEdge=null;
    changed();draw();refreshInspector();F.toast(`已断开 ${edge.from} → ${edge.to}`);
  }
  function removeNode(id,originalPosition) {
    const s=state(),node=s.nodes.find(n=>n.id===id);if(!node)return;
    lastDeleted={node:{...node,...originalPosition},index:s.nodes.indexOf(node),edges:s.edges.filter(e=>e.from===id||e.to===id).map(e=>({...e}))};
    s.nodes=s.nodes.filter(n=>n.id!==id);s.edges=s.edges.filter(e=>e.from!==id&&e.to!==id);s.selected=s.nodes[0]?.id||null;
    selectedEdge=null;pendingLink=null;changed();draw();refreshInspector();F.toast(`已删除 ${id} 及关联连线，可撤销删除`);
  }
  function undoDelete() {
    if(!lastDeleted)return;const s=state(),deleted=lastDeleted;lastDeleted=null;
    s.nodes.splice(deleted.index,0,deleted.node);
    deleted.edges.forEach(e=>{if(s.nodes.some(n=>n.id===e.from)&&s.nodes.some(n=>n.id===e.to)&&!s.edges.some(x=>x.from===e.from&&x.to===e.to))s.edges.push(e);});
    s.selected=deleted.node.id;selectedEdge=null;changed();draw();refreshInspector();F.toast(`已恢复 ${deleted.node.id} 及关联连线`);
  }
  function updateCanvasTools() {
    if(!root)return;
    if(selectedEdge&&!state().edges.includes(selectedEdge))selectedEdge=null;
    const toolbar=root.querySelector('.flow-link-toolbar');
    if(toolbar){toolbar.hidden=!selectedEdge;toolbar.querySelector('span').textContent=selectedEdge?`${selectedEdge.from} → ${selectedEdge.to}`:'';}
    const undo=root.querySelector('[data-action="flow-undo-delete"]');if(undo)undo.hidden=!lastDeleted;
    const issues=validate(),validation=root.querySelector('.flow-validation');
    if(validation){validation.classList.toggle('has-error',!!issues.length);validation.textContent=issues.length?`⚠ ${issues.length} 项待修复 · ${issues[0]}`:'✓ 0 语法错误 · 流程连接正常';}
  }
  function nodeMarkup(node) {
    const k=kinds[node.kind]||kinds.event, s=state();
    return `<div role="group" tabindex="0" class="flow-node ${s.selected===node.id?'is-selected':''}" data-node="${esc(node.id)}" aria-label="${esc(node.id+' '+label(node))}，拖动可调整位置" style="left:${node.x}px;top:${node.y}px;--node-color:${k.color}"><button type="button" class="flow-node-port input" data-port="input" aria-label="${esc(node.id)} 输入端口" title="输入端口：拖动或点击连接"></button><span class="flow-node-overline"><b>${esc(node.id)} · ${esc(k.sub)}</b><i></i></span><strong>${esc(label(node))}</strong><span class="flow-node-detail">${node.kind==='condition'?`SOC ≤ <b>${s.threshold}%</b> → 回场补能`:esc(k.detail)}</span><button type="button" class="flow-node-port output" data-port="output" aria-label="${esc(node.id)} 输出端口" title="输出端口：拖至另一个节点的输入端口"></button></div>`;
  }
  function wires() {
    const s=state();
    return `<svg class="flow-wires" viewBox="0 0 2000 1100"><defs><marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8Z" fill="context-stroke"/></marker></defs>${s.edges.map((e,index)=>{
      const a=s.nodes.find(n=>n.id===e.from),b=s.nodes.find(n=>n.id===e.to);if(!a||!b)return '';
      const d=curve(portPoint(a,'output'),portPoint(b,'input')),tx=(a.x+184+b.x)/2,ty=(a.y+b.y)/2+39;
      return `<g class="flow-edge ${selectedEdge===e?'is-selected':''}"><path class="flow-wire" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${d}" stroke="${e.color||'#4389ff'}" marker-end="url(#flow-arrow)"/><path class="flow-wire-hit" d="${d}" data-edge="${index}" role="button" tabindex="0" aria-label="选择连线 ${esc(e.from)} 到 ${esc(e.to)}"/>${e.label?`<text x="${tx}" y="${ty}" text-anchor="middle" fill="${e.color||'#8494ad'}">${esc(e.label)}</text>`:''}</g>`;
    }).join('')}<path class="flow-wire-preview" hidden/></svg>`;
  }
  function draw() {
    if(!stage)return;stage.innerHTML=wires()+state().nodes.map(nodeMarkup).join('');
    const mini=root.querySelector('.flow-mini-map'),nodes=state().nodes;
    if(mini){const minX=Math.min(0,...nodes.map(n=>n.x)),minY=Math.min(0,...nodes.map(n=>n.y));const scale=Math.min(96/(Math.max(1200,...nodes.map(n=>n.x+184))-minX),47/(Math.max(500,...nodes.map(n=>n.y+102))-minY));mini.innerHTML=nodes.map(n=>`<i style="left:${6+(n.x-minX)*scale}px;top:${6+(n.y-minY)*scale}px;width:${Math.max(4,184*scale)}px;height:${Math.max(3,102*scale)}px;background:${(kinds[n.kind]||kinds.event).color}"></i>`).join('');}
    applyView();updateCanvasTools();updateLinkPreview();
  }
  function applyView() {
    if(stage)stage.style.transform=`translate(${current.x}px,${current.y}px) scale(${current.scale})`;
    const out=root?.querySelector('.flow-zoom-value');if(out)out.textContent=Math.round(current.scale*100)+'%';
  }
  function fit() {
    if(!surface)return;const nodes=state().nodes;if(!nodes.length)return;
    const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
    const maxX=Math.max(...nodes.map(n=>n.x+184)),maxY=Math.max(...nodes.map(n=>n.y+102));
    current.scale=Math.min(1,Math.max(.25,Math.min((surface.clientWidth-72)/(maxX-minX),(surface.clientHeight-150)/(maxY-minY))));
    current.x=(surface.clientWidth-(maxX-minX)*current.scale)/2-minX*current.scale;
    current.y=Math.max(40,(surface.clientHeight-(maxY-minY)*current.scale)/2-35)-minY*current.scale;applyView();
  }
  function focusSelected(scale=.8) {
    if(!surface)return;const node=selected();if(!node)return;
    current.scale=scale;current.x=surface.clientWidth/2-(node.x+92)*scale;
    current.y=surface.clientHeight*.34-(node.y+51)*scale;applyView();
  }
  function zoom(factor) {const before=current.scale,next=Math.max(.25,Math.min(1.8,before*factor));const cx=surface.clientWidth/2,cy=surface.clientHeight/2;current.x=cx-(cx-current.x)*next/before;current.y=cy-(cy-current.y)*next/before;current.scale=next;applyView();}
  function impactMarkup() {const charge=state().threshold>=32;return `<strong>虚拟样本判定 <em>${charge?'需补能':'继续运营'}</em></strong><p><b>示例车 DEMO-012</b> 预设 SOC <b>32%</b>，${charge?'达到补能阈值，完成当前任务后回场。':'电量高于阈值，继续执行运营任务。'}</p>`;}
  function inspector() {
    const n=selected(),s=state(),k=n&&(kinds[n.kind]||kinds.event);if(!n)return '<div class="flow-inspector-body"><h3>画布暂无节点</h3><p class="flow-inspector-tip">从左侧拖入组件开始编辑，也可撤销刚才的删除。</p></div><footer class="flow-inspector-footer"><button class="btn primary" data-action="flow-save">▣ 保存配置</button></footer>';
    const condition=n.kind==='condition';
    return `<header class="flow-inspector-head"><span class="eyebrow">节点配置</span><h3>${esc(n.id)} ${esc(label(n))}</h3><p>${esc(k.sub)} · ${esc(n.id==='N03'?'NODE-TSK-2026-N03':'NODE-TSK-2026-'+n.id)}</p></header>
      <div class="flow-inspector-body"><label class="flow-form-label">节点名称<input class="flow-name-input" maxlength="32" value="${esc(label(n))}" aria-label="节点名称"></label>
      ${condition?`<div class="flow-section-label"><span>☷ 规则判定参数</span><small>3 项规则</small></div>
      <div class="flow-rule-box"><div><label for="flow-threshold">电量阈值（SOC）</label><b class="flow-threshold-value">≤ ${s.threshold}%</b></div><div class="flow-range-label"><span>10%</span><span>50%</span></div><input id="flow-threshold" type="range" min="10" max="50" step="1" value="${s.threshold}" aria-label="补能电量阈值"><div class="flow-number-row"><span>阈值</span><input class="flow-threshold-number" type="number" min="10" max="50" value="${s.threshold}" aria-label="电量阈值数值"><span>%</span></div></div>
      <label class="flow-number-row">返场能耗预留<input class="flow-reserve" type="number" min="0" max="30" value="${s.reserve}" aria-label="返场能耗预留"><span>%</span></label>
      <label class="flow-number-row">场站排队动态上调<input class="flow-maxsoc" type="number" min="10" max="60" value="${s.maxSoc}" aria-label="场站排队动态上调"><span>%</span></label>
      <div class="flow-impact">${impactMarkup()}</div>`:
      `<div class="flow-section-label">节点运行方式</div><div class="flow-rule-box"><p>${esc(k.detail)}</p><p class="muted">满足上游条件后自动执行，运行结果传递到后续节点。</p></div><label class="flow-form-label">执行模式<select class="flow-mode" aria-label="执行模式"><option value="auto" ${n.mode!=='manual'?'selected':''}>自动执行</option><option value="manual" ${n.mode==='manual'?'selected':''}>人工确认后执行</option></select></label><div class="flow-impact"><strong>节点连接</strong><p>${s.edges.filter(e=>e.to===n.id).length} 个上游连接 · ${s.edges.filter(e=>e.from===n.id).length} 个下游连接</p></div>`}
      ${connectionMarkup(n)}<p class="flow-inspector-tip">拖动右侧输出端口至另一节点的输入端口建立连接。点击连线可断开；拖入垃圾桶可删除节点。</p></div>
      <footer class="flow-inspector-footer"><button class="btn primary" data-action="flow-save">▣ 保存配置</button><button class="btn subtle" data-action="flow-remove">删除节点</button></footer>`;
  }
  function refreshInspector() {const panel=root?.querySelector('.flow-inspector');if(panel){panel.innerHTML=inspector();bindInspector();}}
  const numberFields=[['.flow-threshold-number','threshold',10,50,'电量阈值'],['.flow-reserve','reserve',0,30,'返场能耗预留'],['.flow-maxsoc','maxSoc',10,60,'场站排队动态上调']];
  function validNumber(raw,min,max) {if(String(raw).trim()==='')return null;const value=Number(raw);return Number.isInteger(value)&&value>=min&&value<=max?value:null;}
  function syncThreshold(source) {
    const panel=root?.querySelector('.flow-inspector');if(!panel)return;
    const range=panel.querySelector('#flow-threshold'),num=panel.querySelector('.flow-threshold-number');
    if(range&&range!==source)range.value=state().threshold;if(num&&num!==source)num.value=state().threshold;
    const value=panel.querySelector('.flow-threshold-value');if(value)value.textContent='≤ '+state().threshold+'%';
    const impact=panel.querySelector('.flow-impact');if(impact)impact.innerHTML=impactMarkup();draw();
  }
  function flushInspector() {
    const panel=root?.querySelector('.flow-inspector');if(!panel)return true;
    const updates=[];
    for(const [selector,key,min,max,labelText] of numberFields){const input=panel.querySelector(selector);if(!input)continue;const value=validNumber(input.value,min,max);if(value===null){F.toast(`${labelText}请输入 ${min}–${max} 的整数`,'error');input.focus();return false;}updates.push([key,value]);}
    let modified=false;for(const [key,value] of updates){if(state()[key]!==value){state()[key]=value;modified=true;}}
    const n=selected(),name=panel.querySelector('.flow-name-input'),mode=panel.querySelector('.flow-mode');
    if(n&&name){const title=name.value.trim()||kinds[n.kind].title;if(label(n)!==title){n.title=title;modified=true;}}
    if(n&&mode&&n.mode!==mode.value){n.mode=mode.value;modified=true;}
    if(modified)changed();draw();refreshInspector();return true;
  }
  function bindInspector() {
    const panel=root.querySelector('.flow-inspector');
    const name=panel.querySelector('.flow-name-input');name?.addEventListener('input',()=>{const n=selected();const value=name.value.trim();if(!value)return;n.title=value;changed();draw();const heading=panel.querySelector('.flow-inspector-head h3');if(heading)heading.textContent=n.id+' '+value;});
    const mode=panel.querySelector('.flow-mode');mode?.addEventListener('change',()=>{selected().mode=mode.value;changed();});
    panel.querySelector('#flow-threshold')?.addEventListener('input',e=>{const value=validNumber(e.target.value,10,50);if(value===null)return;if(state().threshold!==value){state().threshold=value;changed();}syncThreshold(e.target);});
    numberFields.forEach(([selector,key,min,max])=>panel.querySelector(selector)?.addEventListener('input',e=>{const value=validNumber(e.target.value,min,max);if(value===null)return;if(state()[key]!==value){state()[key]=value;changed();}if(key==='threshold')syncThreshold(e.target);}));
  }
  function validate() {
    const s=state(),issues=[];
    if(!s.nodes.some(n=>n.kind==='start'||n.kind==='event'))issues.push('请添加一个触发节点。');
    if(s.nodes.length<2)issues.push('至少需要一个触发节点和一个执行节点。');
    s.nodes.forEach(n=>{if(!s.edges.some(e=>e.from===n.id||e.to===n.id))issues.push(`${n.id} ${label(n)} 尚未连接。`);});
    s.nodes.filter(n=>n.kind==='condition').forEach(n=>{if(s.edges.filter(e=>e.from===n.id).length<2)issues.push(`${n.id} 条件节点至少需要两个下游分支。`);});
    if(s.threshold<s.reserve)issues.push('电量阈值不能小于返场能耗预留。');
    if(s.maxSoc<s.threshold)issues.push('动态上调值不能低于电量阈值。');
    return issues;
  }
  function showValidation() {
    const issues=validate(),el=root?.querySelector('.flow-validation');
    if(el){el.classList.toggle('has-error',issues.length>0);el.textContent=issues.length?`⚠ ${issues.length} 项待修复 · ${issues[0]}`:'✓ 0 语法错误　·　流程连接正常';}
    F.toast(issues.length?issues[0]:'检查通过：节点连接与补能规则有效',issues.length?'error':'success');return issues.length===0;
  }
  function addNode(kind,position) {
    if(!kinds[kind])return;const s=state(),from=selected(),number=Math.max(s.nodeSequence||0,...s.nodes.map(n=>Number(n.id.slice(1))))+1;s.nodeSequence=number;selectedEdge=null;pendingLink=null;
    const node={id:'N'+String(number).padStart(2,'0'),kind,x:position?.x??(from?from.x+230:30),y:position?.y??(from?from.y+160:60)};
    s.nodes.push(node);if(from)s.edges.push({from:from.id,to:node.id,color:kinds[kind].color});s.selected=node.id;changed();draw();refreshInspector();if(!position)focusSelected(current.scale);F.toast(`已添加「${kinds[kind].title}」${from?'并连接到 '+from.id:''}`);
  }
  function activeLink() {return drag?.type==='link'?drag:pendingLink;}
  function linkTarget(event,link) {
    const rect=surface.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return null;
    const hit=document.elementFromPoint(event.clientX,event.clientY);if(hit?.closest('.flow-trash,.flow-controls,.flow-mini-map,.flow-link-toolbar'))return null;
    const point=graphPoint(event),opposite=link.port==='output'?'input':'output';let nearest=null,distance=22;
    state().nodes.forEach(node=>{if(node.id===link.id)return;const p=portPoint(node,opposite),d=Math.hypot(p.x-point.x,p.y-point.y)*current.scale;if(d<distance){distance=d;nearest=node.id;}});
    return nearest;
  }
  function updateLinkPreview() {
    if(!stage)return;const link=activeLink(),preview=stage.querySelector('.flow-wire-preview');
    stage.querySelectorAll('.flow-node-port').forEach(el=>el.classList.remove('is-link-origin','is-link-target','is-link-eligible'));
    surface.classList.toggle('is-linking',!!link);if(!preview)return;preview.style.display=link?'':'none';if(!link)return;
    const node=state().nodes.find(n=>n.id===link.id);if(!node)return;
    const start=portPoint(node,link.port),target=state().nodes.find(n=>n.id===link.target),opposite=link.port==='output'?'input':'output';
    const end=target?portPoint(target,opposite):link.point||{x:start.x+(link.port==='output'?90:-90),y:start.y};
    preview.setAttribute('d',link.port==='output'?curve(start,end):curve(end,start));preview.classList.toggle('is-valid',!!target);
    stage.querySelectorAll('.flow-node-port').forEach(el=>{const id=el.closest('[data-node]')?.dataset.node;el.classList.toggle('is-link-origin',id===link.id&&el.dataset.port===link.port);el.classList.toggle('is-link-eligible',id!==link.id&&el.dataset.port===opposite);el.classList.toggle('is-link-target',id===link.target&&el.dataset.port===opposite);});
  }
  function completeLink(link,target) {if(link.port==='output')connectNodes(link.id,target);else connectNodes(target,link.id);}
  function activatePort(id,port) {
    const prior=pendingLink;selectedEdge=null;
    if(prior&&prior.id!==id&&prior.port!==port){pendingLink=null;completeLink(prior,id);updateLinkPreview();}
    else{pendingLink={id,port};state().selected=id;draw();refreshInspector();F.toast('选择另一节点的'+(port==='output'?'输入':'输出')+'端口，Esc 取消');}
  }
  function bindCanvasInteractions() {
    const canvas=surface,controller=new AbortController(),signal=controller.signal;
    const trash=canvas.querySelector('.flow-trash-zone');
    const overTrash=event=>{const r=trash.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;};
    function trashFeedback(over=false,active=false) {trash.classList.toggle('is-over',over);trash.classList.toggle('is-active',active);trash.querySelector('span').textContent=over?'松手删除节点':'拖入此处删除';}
    function finish(event,commit=false) {
      const d=drag;if(!d||event?.pointerId!=null&&event.pointerId!==d.pointerId)return;
      const target=d.type==='link'&&commit&&d.moved?linkTarget(event,d):null;
      const deleted=d.type==='node'&&d.moved&&commit&&overTrash(event);
      drag=null;canvas.classList.remove('is-dragging');trashFeedback();
      if(canvas.hasPointerCapture(d.pointerId))canvas.releasePointerCapture(d.pointerId);
      if(d.type==='link'){
        pendingLink=commit&&!d.moved?{id:d.id,port:d.port}:null;
        if(target)completeLink(d,target);updateLinkPreview();
      }else if(d.type==='node'){
        if(deleted)removeNode(d.node.id,{x:d.x,y:d.y});
        else{if(!commit){d.node.x=d.x;d.node.y=d.y;}else if(d.moved)changed();draw();}
      }else if(!commit){current.x=d.x;current.y=d.y;applyView();}
    }
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.isPrimary||drag||event.target.closest('.flow-controls,.flow-mini-map,.flow-run-report,.flow-trash,.flow-link-toolbar'))return;
      const el=event.target.closest('[data-node]'),node=el&&state().nodes.find(n=>n.id===el.dataset.node),port=event.target.closest('[data-port]');
      const edge=event.target.closest('[data-edge]');
      if(port&&node){
        if(pendingLink&&pendingLink.id!==node.id&&pendingLink.port!==port.dataset.port){event.preventDefault();activatePort(node.id,port.dataset.port);return;}
        pendingLink=null;selectedEdge=null;state().selected=node.id;
        drag={type:'link',id:node.id,port:port.dataset.port,point:graphPoint(event),px:event.clientX,py:event.clientY,pointerId:event.pointerId,moved:false};draw();refreshInspector();
      }else if(edge){pendingLink=null;selectedEdge=state().edges[Number(edge.dataset.edge)];draw();canvas.focus({preventScroll:true});event.preventDefault();return;}
      else{
        pendingLink=null;selectedEdge=null;
        if(node){state().selected=node.id;drag={type:'node',node,px:event.clientX,py:event.clientY,x:node.x,y:node.y,pointerId:event.pointerId,moved:false};draw();refreshInspector();}
        else{drag={type:'pan',px:event.clientX,py:event.clientY,x:current.x,y:current.y,pointerId:event.pointerId,moved:false};draw();}
      }
      canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});event.preventDefault();
    },{signal});
    canvas.addEventListener('pointermove',event=>{
      if(!drag){if(pendingLink){pendingLink.point=graphPoint(event);pendingLink.target=linkTarget(event,pendingLink);updateLinkPreview();}return;}
      const d=drag;if(event.pointerId!==d.pointerId)return;const dx=event.clientX-d.px,dy=event.clientY-d.py;
      d.moved=d.moved||Math.hypot(dx,dy)>5;if(!d.moved)return;
      if(d.type==='link'){d.point=graphPoint(event);d.target=linkTarget(event,d);updateLinkPreview();}
      else if(d.type==='node'){d.node.x=Math.round(d.x+dx/current.scale);d.node.y=Math.round(d.y+dy/current.scale);draw();trashFeedback(overTrash(event),true);canvas.classList.add('is-dragging');}
      else{current.x=d.x+dx;current.y=d.y+dy;applyView();canvas.classList.add('is-dragging');}
      event.preventDefault();
    },{signal});
    canvas.addEventListener('pointerup',event=>finish(event,true),{signal});
    canvas.addEventListener('pointercancel',event=>finish(event),{signal});
    canvas.addEventListener('lostpointercapture',event=>finish(event),{signal});
    canvas.addEventListener('keydown',event=>{
      if(event.target.closest('input,select,textarea'))return;
      const port=event.target.closest('[data-port]'),node=event.target.closest('[data-node]'),edge=event.target.closest('[data-edge]');
      if(event.key==='Enter'||event.key===' '){
        if(port){event.preventDefault();activatePort(node.dataset.node,port.dataset.port);canvas.focus({preventScroll:true});}
        else if(edge){event.preventDefault();selectedEdge=state().edges[Number(edge.dataset.edge)];draw();canvas.focus({preventScroll:true});}
        else if(node){event.preventDefault();state().selected=node.dataset.node;selectedEdge=null;draw();refreshInspector();canvas.focus({preventScroll:true});}
      }else if((event.key==='Delete'||event.key==='Backspace')&&!event.target.closest('button')){
        event.preventDefault();if(selectedEdge)disconnectEdge(selectedEdge);else removeNode(state().selected);
      }
    },{signal});
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&(drag||pendingLink||selectedEdge)){event.preventDefault();finish();pendingLink=null;selectedEdge=null;draw();}},{signal});
    window.addEventListener('blur',()=>{finish();pendingLink=null;updateLinkPreview();},{signal});
    canvas.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();if(!drag){pendingLink=null;zoom(event.deltaY>0?.9:1.1);updateLinkPreview();}}},{passive:false,signal});
    return ()=>{finish();pendingLink=null;selectedEdge=null;controller.abort();};
  }
  function bindPaletteDrag() {
    const palette=root.querySelector('.flow-palette'),canvas=surface,controller=new AbortController(),signal=controller.signal;
    let gesture=null,suppressed=null;
    function destination(event) {
      const rect=canvas.getBoundingClientRect(),target=document.elementFromPoint(event.clientX,event.clientY);
      if(event.clientX<rect.left||event.clientX>=rect.right||event.clientY<rect.top||event.clientY>=rect.bottom||!target||!canvas.contains(target)||target.closest('.flow-controls,.flow-mini-map,.flow-run-report,.flow-trash,.flow-link-toolbar'))return null;
      // Convert the pointer from viewport pixels to graph coordinates, including the node's centre.
      return {x:Math.round((event.clientX-rect.left-canvas.clientLeft+canvas.scrollLeft-current.x)/current.scale-92),y:Math.round((event.clientY-rect.top-canvas.clientTop+canvas.scrollTop-current.y)/current.scale-51)};
    }
    function preview(event) {
      const g=gesture,point=destination(event),rect=canvas.getBoundingClientRect(),scale=point?current.scale:.8;
      g.position=point;
      g.ghost.style.left=(point?rect.left+canvas.clientLeft-canvas.scrollLeft+current.x+point.x*scale:event.clientX-92*scale)+'px';
      g.ghost.style.top=(point?rect.top+canvas.clientTop-canvas.scrollTop+current.y+point.y*scale:event.clientY-51*scale)+'px';
      g.ghost.style.transform=`scale(${scale})`;
      g.ghost.classList.toggle('is-valid',!!point);
      g.ghost.querySelector('.flow-drag-hint').textContent=point?'松开添加 · Esc 取消':'拖入画布添加 · Esc 取消';
      canvas.classList.toggle('is-drop-target',!!point);
    }
    function finish(event,commit=false) {
      const g=gesture;if(!g||event?.pointerId!=null&&event.pointerId!==g.pointerId)return;
      const point=g.active&&commit?destination(event):null;
      gesture=null;
      if(g.active||!commit)suppressed=g.item;
      g.ghost?.remove();g.item.classList.remove('is-drag-source');canvas.classList.remove('is-drop-target');document.body.classList.remove('flow-is-adding');
      if(g.item.hasPointerCapture(g.pointerId))g.item.releasePointerCapture(g.pointerId);
      if(point)addNode(g.kind,point);
    }
    palette.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.isPrimary||gesture||drag)return;
      const item=event.target.closest('.flow-palette-item');if(!item)return;
      suppressed=null;gesture={item,kind:item.dataset.kind,pointerId:event.pointerId,px:event.clientX,py:event.clientY,active:false};
      item.setPointerCapture(event.pointerId);
    },{signal});
    palette.addEventListener('pointermove',event=>{
      const g=gesture;if(!g||event.pointerId!==g.pointerId)return;
      if(!g.active){
        if(Math.hypot(event.clientX-g.px,event.clientY-g.py)<6)return;
        g.active=true;g.ghost=document.createElement('div');g.ghost.className='flow-drag-preview';g.ghost.setAttribute('aria-hidden','true');
        g.ghost.innerHTML=nodeMarkup({id:'新节点',kind:g.kind,x:0,y:0})+'<span class="flow-drag-hint"></span>';
        const node=g.ghost.querySelector('.flow-node');node.removeAttribute('data-node');node.tabIndex=-1;g.ghost.querySelectorAll('button').forEach(button=>button.tabIndex=-1);
        document.body.append(g.ghost);g.item.classList.add('is-drag-source');document.body.classList.add('flow-is-adding');
      }
      event.preventDefault();preview(event);
    },{signal});
    palette.addEventListener('pointerup',event=>finish(event,true),{signal});
    palette.addEventListener('pointercancel',event=>finish(event),{signal});
    palette.addEventListener('lostpointercapture',event=>finish(event),{signal});
    palette.addEventListener('dragstart',event=>event.preventDefault(),{signal});
    palette.addEventListener('click',event=>{
      if(suppressed&&event.detail!==0&&event.target.closest('.flow-palette-item')===suppressed){event.preventDefault();event.stopPropagation();suppressed=null;}
    },{capture:true,signal});
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){event.preventDefault();finish();}},{signal});
    window.addEventListener('blur',()=>finish(),{signal});
    return ()=>{finish();controller.abort();};
  }
  function simulate() {
    if(running){running=false;runId++;stage.querySelectorAll('.is-running,.is-complete').forEach(el=>el.classList.remove('is-running','is-complete'));const b=root.querySelector('[data-action="flow-simulate"]');if(b)b.textContent='▷ 模拟测试';F.toast('模拟测试已停止');return;}
    if(!showValidation())return;running=true;const token=++runId;const s=state();
    const primary=s.nodes.filter(n=>['start','event','check','condition'].includes(n.kind));const tail=s.nodes.find(n=>n.kind===(s.threshold>=32?'charge':'dispatch'));const nodes=[...primary,...(tail?[tail]:[])];
    root.querySelector('[data-action="flow-simulate"]').textContent='□ 停止模拟';
    const report=root.querySelector('.flow-run-report');report.hidden=false;report.innerHTML='<b>模拟运行 · 示例车 DEMO-012</b><span>预设 SOC 32% · 正在检查流程…</span>';
    let index=0;const step=()=>{if(token!==runId||!root?.isConnected){running=false;return;}stage.querySelectorAll('.is-running').forEach(el=>{el.classList.remove('is-running');el.classList.add('is-complete');});if(index>=nodes.length){running=false;root.querySelector('[data-action="flow-simulate"]').textContent='▷ 模拟测试';const result=s.threshold>=32?'触发回场补能，已模拟锁定充电桩。':'电量充裕，已模拟开放接单。';report.innerHTML=`<b>✓ 模拟完成 · 示例车 DEMO-012</b><span>${result}</span>`;F.log?.('示例车 DEMO-012 自动化流程模拟完成：'+result);F.toast('模拟测试完成，未向真实车辆发送指令');return;}const node=nodes[index++];stage.querySelector(`[data-node="${node.id}"]`)?.classList.add('is-running');report.innerHTML=`<b>模拟运行 · 示例车 DEMO-012</b><span>${esc(node.id+' '+label(node))} · ${index}/${nodes.length}</span>`;setTimeout(step,700);};step();
  }
  function mount(container) {
    if(observer)observer.disconnect();runId++;running=false;root=container;surface=root.querySelector('.flow-canvas');stage=root.querySelector('.flow-stage');if(!surface)return;
    draw();refreshInspector();requestAnimationFrame(()=>focusSelected(.8));const unbindPaletteDrag=bindPaletteDrag();
    const unbindCanvas=bindCanvasInteractions();
    if(typeof ResizeObserver!=='undefined'){let width=surface.clientWidth,height=surface.clientHeight;observer=new ResizeObserver(()=>{if(!root?.isConnected){observer?.disconnect();return;}const nextWidth=surface.clientWidth,nextHeight=surface.clientHeight;if(!drag){current.x+=(nextWidth-width)/2;current.y+=(nextHeight-height)/2;applyView();}width=nextWidth;height=nextHeight;});observer.observe(surface);}
    F.cleanup=()=>{unbindPaletteDrag();unbindCanvas();runId++;running=false;drag=null;observer?.disconnect();observer=null;root=null;surface=null;stage=null;};
  }
  function render() {
    const s=state();const groups=[['触发节点',['start','event']],['逻辑控制',['condition','parallel']],['运营动作',['dispatch','pause']],['业务流程',['passenger','charge','finish']],['异常处理',['manual']]];
    return `<section class="automation-page"><header class="flow-page-head"><div><div class="eyebrow">任务与调度 / 自动化流程</div><h1>日常运营与补能循环 <span class="flow-version">${s.publishedAt&&!s.draft?'已发布':'草稿'} v1.${s.version||3}</span></h1><span class="flow-save-status">${s.savedAt?'已保存于 '+esc(s.savedAt):'未保存的演示草稿'}</span></div><div class="flow-head-actions"><button class="btn" data-action="flow-check">☷ 检查流程</button><button class="btn primary" data-action="flow-publish">⇧ 发布演示版本</button></div></header>
      <div class="flow-context"><span>♧ 张江日班车组 · 12辆</span><span>◷ 08:00–18:00</span><span>❄ 张江边缘调度集群</span><span class="flow-online">12 在线 <i>8 接单</i><em>3 补能</em><b>1 待命</b></span><button class="btn subtle" data-action="flow-simulate">▷ 模拟测试</button></div>
      <div class="flow-workspace"><aside class="flow-palette"><h3>♧ 步骤组件库</h3><p>拖拽至画布，或点击添加</p><input class="flow-palette-search" aria-label="搜索步骤组件" placeholder="⌕ 搜索步骤组件…">${groups.map(([title,list])=>`<div class="flow-palette-group"><h4>${title}</h4><div>${list.map(kind=>`<button type="button" class="flow-palette-item" title="拖拽至画布，或点击添加" data-action="flow-add" data-kind="${kind}"><i style="color:${kinds[kind].color};background:${kinds[kind].color}1a">${kinds[kind].icon}</i><span>${kinds[kind].title}</span><b>+</b></button>`).join('')}</div></div>`).join('')}<div class="flow-fleet"><span>◉ 日班车组运行分布 <b>12辆</b></span><div>${Array.from({length:12},(_,i)=>`<i class="${i>7?'charging':''}">${String(i+1).padStart(3,'0')}${i>7&&i<11?'ϟ':''}</i>`).join('')}</div></div></aside>
      <div class="flow-canvas" tabindex="0" aria-label="自动化流程画布"><div class="flow-canvas-caption">流程编辑 <span>拖动端口连线 · 点击连线断开 · 拖入垃圾桶删除</span></div><div class="flow-stage"></div><div class="flow-link-toolbar" hidden><span></span><button data-action="flow-disconnect-selected">断开连线</button><button data-action="flow-clear-edge" aria-label="取消选择连线">×</button></div><div class="flow-trash"><div class="flow-trash-zone" role="region" aria-label="节点垃圾桶"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg><span>拖入此处删除</span></div><button class="flow-undo-delete" data-action="flow-undo-delete" hidden>↶ 撤销删除</button></div><div class="flow-run-report" hidden></div><button class="flow-mini-map" data-action="flow-fit" aria-label="适应画布"></button><div class="flow-canvas-bottom"><div class="flow-validation">✓ 0 语法错误　·　条件规则可编辑</div><div class="flow-controls"><button data-action="flow-zoom-out" aria-label="缩小">−</button><span class="flow-zoom-value">100%</span><button data-action="flow-zoom-in" aria-label="放大">+</button><span></span><button data-action="flow-fit" aria-label="适应画布" title="适应画布">⛶</button><button data-action="flow-grid" aria-label="切换网格" title="切换网格">▦</button></div></div></div><aside class="flow-inspector"></aside></div>
      <div class="flow-local-note">演示环境 · 流程、模拟结果及发布版本仅保存在当前浏览器，不连接真实车辆。</div></section>`;
  }
  function action(action,el) {
    if(!action?.startsWith('flow-'))return false;
    if(['flow-save','flow-check','flow-simulate','flow-publish'].includes(action)&&!flushInspector())return true;
    if(action==='flow-add')addNode(el.dataset.kind);
    else if(action==='flow-save')persist();
    else if(action==='flow-zoom-in')zoom(1.2);
    else if(action==='flow-zoom-out')zoom(1/1.2);
    else if(action==='flow-fit')fit();
    else if(action==='flow-grid')surface.classList.toggle('no-grid');
    else if(action==='flow-check')showValidation();
    else if(action==='flow-simulate')simulate();
    else if(action==='flow-remove')removeNode(state().selected);
    else if(action==='flow-undo-delete')undoDelete();
    else if(action==='flow-edge-select'){selectedEdge=state().edges[Number(el.dataset.edge)];pendingLink=null;draw();}
    else if(action==='flow-disconnect')disconnectEdge(state().edges[Number(el.dataset.edge)]);
    else if(action==='flow-disconnect-selected')disconnectEdge(selectedEdge);
    else if(action==='flow-clear-edge'){selectedEdge=null;draw();}
    else if(action==='flow-connect-add'){const target=root.querySelector('.flow-connect-target')?.value;if(target)connectNodes(state().selected,target);else F.toast('请先选择下游节点','error');}
    else if(action==='flow-publish'){
      if(!showValidation())return true;
      F.modal('发布演示版本',`<p>将当前流程保存为 <strong>v1.${(state().version||3)+1}</strong>。此操作仅更新本浏览器中的演示版本。</p><label class="field" style="margin-top:18px">版本说明<input name="note" maxlength="100" value="优化日常运营与补能规则" required></label><p class="muted">不会向真实车辆或调度系统发送指令。</p><div class="dialog-actions"><button type="button" class="btn subtle" data-action="close-modal">取消</button><button type="submit" class="btn primary">发布演示版本</button></div>`,data=>{const note=typeof data.get==='function'?data.get('note'):data.note;const s=state();s.version=(s.version||3)+1;s.publishedAt=now();s.draft=false;s.releaseNote=String(note||'流程配置更新');persist('演示版本 v1.'+s.version+' 已发布');const badge=root?.querySelector('.flow-version');if(badge)badge.textContent='已发布 v1.'+s.version;F.log?.(`发布自动化演示流程 v1.${s.version}：${s.releaseNote}`);});
    }
    return true;
  }
  F.pages.automation={render,mount(container){mount(container);const search=root.querySelector('.flow-palette-search');search?.addEventListener('input',()=>{const q=search.value.trim();root.querySelectorAll('.flow-palette-item').forEach(btn=>btn.hidden=!btn.textContent.includes(q));root.querySelectorAll('.flow-palette-group').forEach(group=>group.hidden=!group.querySelector('.flow-palette-item:not([hidden])'));});},action};
})();
