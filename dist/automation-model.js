/* Pure workflow model and deterministic, local-only simulation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FleetAutomationModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const C = {blue:'#5796ff',cyan:'#3cc4d8',green:'#27c69a',purple:'#a17bff',amber:'#efb94d',red:'#ee7885',gray:'#94a3ba'};
  const out = (key,label,color=C.blue) => ({key,label,color});
  const number = (key,label,min,max,value) => ({key,label,type:'number',min,max,step:1,default:value});
  const mode = {key:'mode',label:'执行方式',type:'select',default:'auto',options:[{value:'auto',label:'自动执行'},{value:'manual',label:'人工确认后执行'}]};
  const definition = (title,subtitle,color,icon,description,outputs,fields=[]) => ({title,subtitle,color,icon,description,outputs,fields});
  const step = (title,description,color=C.cyan,fields=[]) => definition(title,'阶段内步骤',color,'·',description+'；失败由所属阶段的异常出口处理。',[out('next','完成',color)],fields);
  const catalog = {
    trigger:definition('班次启动','触发',C.blue,'◷','到达车组设定的班次时间后，为成员车辆分别启动流程。',[out('next','已触发')]),
    prepare:definition('运营准备','业务阶段',C.cyan,'✓','读取车辆状态，校验运营条件和已有任务。',[out('ready','准备完成',C.cyan),out('error','检查异常',C.red)]),
    decide:definition('下一步判定','条件分支',C.amber,'⑂','先检查收班条件，再比较当前车辆电量，选择一条业务路径。',[out('operate','继续运营',C.green),out('charge','需要补能',C.purple),out('close','进入收班',C.gray),out('error','无法判定',C.red)],[number('threshold','补能触发 SOC（%）',10,50,30)]),
    operate:definition('接单运营','业务阶段',C.green,'◎','完成一单后重新判断；没有新订单时等待，不重复生成任务。',[out('done','任务完成',C.green),out('timeout','等待到期',C.amber),out('error','运营异常',C.red)],[mode]),
    charge:definition('回场补能','业务阶段',C.purple,'ϟ','停止新增派单，处理当前任务，预约资源并回场补能。',[out('done','补能完成',C.purple),out('error','补能异常',C.red)],[number('targetSoc','充电目标 SOC（%）',50,100,80),mode]),
    close:definition('收班归巢','业务阶段',C.gray,'⌂','停止新增派单，处理当前任务，回场停放并确认收班。',[out('done','收班完成',C.gray),out('error','收班异常',C.red)]),
    manual:definition('异常处置','人工处理',C.red,'!','暂停本车自动推进。人工处理后重新校验，或终止本车流程。',[out('resume','处理后复检',C.cyan),out('end','终止本车',C.gray)]),
    end:definition('流程结束','结束',C.gray,'■','记录本车的收班或终止结果。',[]),
    stepStart:definition('进入阶段','阶段入口',C.blue,'▷','开始执行该阶段内的步骤。',[out('next','开始')]),
    stepEnd:definition('阶段完成','阶段出口',C.green,'✓','所有必要步骤完成，返回主流程的成功出口。',[]),
    read_state:step('读取车辆状态','获取本车电量、连接状态和任务状态'),
    check_ready:step('检查运营条件','检查车辆在线、设备状态以及数据有效性'),
    check_occupancy:step('检查任务占用','已有补能任务时等待其结束；已有订单交由后续阶段处理'),
    allow_dispatch:step('开放接单','允许本车接收新的运营任务',C.green),
    wait_order:step('等待订单','收到订单后继续；到期返回主流程重新判断',C.amber,[number('minutes','最长等待（分钟）',1,60,15)]),
    service_task:step('执行接送任务','按接驾、上下客确认、送达的顺序完成一次示例服务',C.green),
    confirm_task:step('确认任务结束','确认任务结果，刷新电量并释放订单占用',C.green),
    stop_dispatch:step('停止新派单','停止接收新增订单，保留已有任务的处理记录',C.gray),
    settle_task:step('处理当前任务','确认当前任务完成或已交接，再继续后续步骤',C.amber),
    reserve_station:step('预约补能资源','无可用资源时有限等待，超过重试上限转阶段异常',C.purple,[number('waitMinutes','每次等待（分钟）',1,30,5),number('retries','最多重试次数',0,3,2)]),
    return_station:step('返回运营场站','确认当前任务已处理后，按示例路线回场',C.blue),
    charge_battery:step('执行充电','到达场站且已取得资源后，充至主卡片设定的目标',C.purple),
    release_station:step('释放补能资源','确认退出充电位，释放预约与占用',C.purple),
    close_shift:step('停放与收班确认','确认本车任务已结束、回场停放并完成交班',C.gray)
  };
  const phaseSteps = {
    prepare:['read_state','check_ready','check_occupancy'],
    operate:['allow_dispatch','wait_order','service_task','confirm_task'],
    charge:['stop_dispatch','settle_task','reserve_station','return_station','charge_battery','release_station'],
    close:['stop_dispatch','settle_task','return_station','close_shift']
  };
  const palette = {root:['trigger','prepare','decide','operate','charge','close','manual','end'],manual:[]};
  Object.entries(phaseSteps).forEach(([kind,steps])=>palette[kind]=['stepStart',...steps,'stepEnd']);
  const title = node => node.title || catalog[node.kind]?.title || node.kind;
  const minutes = value => /^\d{2}:\d{2}$/.test(String(value)) && +value.slice(0,2)<24 && +value.slice(3)<60 ? +value.slice(0,2)*60 + +value.slice(3) : NaN;
  const timeString = value => `${String(Math.floor(value/60)%24).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
  function createNode(kind,id,x=40,y=40) {
    if (!catalog[kind]) throw new Error('Unknown node kind: '+kind);
    const node={id,kind,x,y,config:{}};
    catalog[kind].fields.forEach(field=>node.config[field.key]=field.default);
    if(phaseSteps[kind]) {
      const kinds=['stepStart',...phaseSteps[kind],'stepEnd'];
      node.children={nodes:kinds.map((k,index)=>createNode(k,id+'-'+String(index+1).padStart(2,'0'),70+(index%3)*320,60+Math.floor(index/3)*260)),edges:[]};
      node.children.nodes.forEach((child,index,list)=>{if(index<list.length-1)node.children.edges.push({id:id+'-e'+index,from:child.id,to:list[index+1].id,outcome:'next'});});
    }
    return node;
  }
  function create(vehicles=[],legacy) {
    const preferred=['RT-021','RT-008','RT-034','RT-041','RT-046','RT-012','RT-001','RT-002','RT-003','RT-004','RT-005','RT-006'];
    const ids=[...preferred.filter(id=>vehicles.some(v=>v.id===id)),...vehicles.map(v=>v.id)].filter((id,i,a)=>a.indexOf(id)===i).slice(0,12);
    const placements=[['trigger','start',20,40],['prepare','prepare',330,40],['decide','decide',640,40],['operate','operate',950,40],['charge','charge',950,380],['close','close',330,380],['manual','manual',20,380],['end','end',640,380]];
    const graph={nodes:placements.map(([kind,id,x,y])=>createNode(kind,id,x,y)),edges:[]};
    const add=(from,outcome,to)=>graph.edges.push({id:'edge-'+graph.edges.length,from,to,outcome});
    add('start','next','prepare');add('prepare','ready','decide');add('prepare','error','manual');
    add('decide','operate','operate');add('decide','charge','charge');add('decide','close','close');add('decide','error','manual');
    add('operate','done','decide');add('operate','timeout','decide');add('operate','error','manual');
    add('charge','done','prepare');add('charge','error','manual');add('close','done','end');add('close','error','manual');
    add('manual','resume','prepare');add('manual','end','end');
    if(Number.isInteger(legacy?.threshold)&&legacy.threshold>=10&&legacy.threshold<=50)graph.nodes.find(n=>n.kind==='decide').config.threshold=legacy.threshold;
    return {schemaVersion:2,name:'日班运营与补能循环',group:{id:'zhangjiang-day',name:'张江日班车组',vehicleIds:ids,shiftStart:'08:00',shiftEnd:'18:00'},graph,version:1,savedAt:null,publishedAt:null};
  }
  function validate(model,vehicles) {
    const issues=[],issue=(graphId,nodeId,message)=>issues.push({graphId,nodeId,message});
    if(!model || model.schemaVersion!==2 || !model.graph){issue('root',null,'流程数据不可用，请重新创建流程。');return issues;}
    const group=model.group||{},members=Array.isArray(group.vehicleIds)?group.vehicleIds:[];
    if(!String(group.name||'').trim())issue('root',null,'请填写车组名称。');
    if(!members.length)issue('root',null,'请至少选择一辆车加入车组。');
    if(new Set(members).size!==members.length)issue('root',null,'车组中存在重复车辆。');
    if(Array.isArray(vehicles))members.forEach(id=>{if(!vehicles.some(v=>v.id===id))issue('root',null,`车组成员 ${id} 不在车辆列表中。`);});
    if(!Number.isFinite(minutes(group.shiftStart))||!Number.isFinite(minutes(group.shiftEnd))||minutes(group.shiftStart)>=minutes(group.shiftEnd))issue('root',null,'请设置有效的当日班次，结束时间须晚于开始时间。');
    const rootNodes=Array.isArray(model.graph.nodes)?model.graph.nodes:[];
    const thresholds=rootNodes.filter(n=>n.kind==='decide').map(n=>n.config?.threshold).filter(Number.isFinite);
    rootNodes.filter(n=>n.kind==='charge').forEach(n=>{if(thresholds.some(t=>Number.isFinite(n.config?.targetSoc)&&n.config.targetSoc<=t))issue('root',n.id,'充电目标必须高于补能触发阈值，避免反复补能。');});
    function inspect(graph,graphId,parentKind) {
      if(!graph || !Array.isArray(graph.nodes)||!Array.isArray(graph.edges)){issue(graphId,null,'缺少阶段步骤或连线。');return;}
      const nodes=graph.nodes,edges=graph.edges,allowed=palette[parentKind||'root'],entryKind=graphId==='root'?'trigger':'stepStart',endKind=graphId==='root'?'end':'stepEnd';
      const entries=nodes.filter(n=>n.kind===entryKind),ends=nodes.filter(n=>n.kind===endKind),map=new Map();
      if(entries.length!==1)issue(graphId,null,graphId==='root'?'主流程须有且仅有一个班次触发入口。':'阶段须有且仅有一个进入节点。');
      if(ends.length!==1)issue(graphId,null,graphId==='root'?'主流程须有且仅有一个结束节点。':'阶段须有且仅有一个完成节点。');
      nodes.forEach(n=>{
        if(map.has(n.id))issue(graphId,n.id,'节点编号重复。');map.set(n.id,n);
        const def=catalog[n.kind];
        if(!def || !allowed?.includes(n.kind)){issue(graphId,n.id,'该节点不适用于当前流程层级。');return;}
        if(graphId!=='root'&&n.children)issue(graphId,n.id,'子步骤不能再嵌套一层流程。');
        def.fields.forEach(field=>{const value=n.config?.[field.key];if(field.type==='number'&&(!Number.isInteger(value)||value<field.min||value>field.max))issue(graphId,n.id,`${title(n)}：${field.label}须为 ${field.min}–${field.max} 的整数。`);if(field.type==='select'&&!field.options.some(o=>o.value===value))issue(graphId,n.id,`${title(n)}：请选择有效的${field.label}。`);});
        def.outputs.forEach(output=>{const outgoing=edges.filter(e=>e.from===n.id&&e.outcome===output.key);if(outgoing.length!==1)issue(graphId,n.id,`${title(n)}的「${output.label}」出口须连接一个后续节点。`);});
        if(n.kind===entryKind&&edges.some(e=>e.to===n.id))issue(graphId,n.id,'入口节点不能接收上游连线。');
        if(phaseSteps[n.kind])inspect(n.children,n.id,n.kind);
      });
      const edgeIds=new Set();
      edges.forEach(e=>{
        if(edgeIds.has(e.id))issue(graphId,e.from,'连线编号重复。');edgeIds.add(e.id);
        const from=map.get(e.from),to=map.get(e.to);
        if(!from||!to)issue(graphId,e.from,'连线引用了已不存在的节点。');
        else if(!catalog[from.kind]?.outputs.some(o=>o.key===e.outcome))issue(graphId,from.id,`${title(from)}的连线结果无效。`);
        if(e.from===e.to)issue(graphId,e.from,'节点不能直接连接自己。');
      });
      if(entries.length===1){const seen=new Set(),visit=id=>{if(seen.has(id))return;seen.add(id);edges.filter(e=>e.from===id&&map.has(e.to)).forEach(e=>visit(e.to));};visit(entries[0].id);nodes.forEach(n=>{if(!seen.has(n.id))issue(graphId,n.id,`${title(n)}无法从入口到达。`);});}
      if(ends.length===1){const canEnd=new Set(),visit=id=>{if(canEnd.has(id))return;canEnd.add(id);edges.filter(e=>e.to===id&&map.has(e.from)).forEach(e=>visit(e.from));};visit(ends[0].id);nodes.forEach(n=>{if(!canEnd.has(n.id))issue(graphId,n.id,`${title(n)}没有通往结束的路径。`);});}
      if(parentKind&&phaseSteps[parentKind])phaseSteps[parentKind].forEach(kind=>{if(!nodes.some(n=>n.kind===kind))issue(graphId,null,`${catalog[parentKind].title}缺少必要步骤「${catalog[kind].title}」。`);});
      // Reject loops made only of instantaneous control operations; normal service loops remain valid.
      const progressing=new Set(['operate','charge','close','manual','wait_order','service_task','settle_task','reserve_station','return_station','charge_battery','close_shift']);
      const visited=new Set(),active=new Set();let cycle=false;
      const visit=id=>{if(active.has(id)){cycle=true;return;}if(visited.has(id)||progressing.has(map.get(id)?.kind))return;visited.add(id);active.add(id);edges.filter(e=>e.from===id&&map.has(e.to)).forEach(e=>visit(e.to));active.delete(id);};
      nodes.forEach(n=>visit(n.id));if(cycle)issue(graphId,null,'存在没有等待、执行或人工出口的即时循环。');
    }
    inspect(model.graph,'root');
    return issues;
  }
  function simulate(model,vehicle,scenario='current',options={}) {
    const trace=[],vehicleId=vehicle?.id||'未选择车辆';
    let summary='',lastFault='',manualRecovered=false,terminated=false,approvalUsed=false;
    const approvedStages=new Set(Array.isArray(options.resumeState?.approvedStages)?options.resumeState.approvedStages:[]);
    const priorRecovery=options.resumeState?.recovered===true;
    const finish=(status,message,ctx)=>({vehicleId,status,summary:message,trace,soc:ctx?.soc??vehicle?.soc,time:ctx?timeString(ctx.time):undefined,resumeState:{approvedStages:[...approvedStages],recovered:manualRecovered}});
    const problems=validate(model);
    if(problems.length)return finish('blocked','流程尚有待修复项：'+problems[0].message);
    if(!vehicle || !model.group.vehicleIds.includes(vehicle.id))return finish('blocked','请选择当前车组中的车辆。');
    const shiftStart=minutes(model.group.shiftStart),shiftEnd=minutes(model.group.shiftEnd);
    const ctx={soc:vehicle.soc,status:vehicle.status,time:Math.min(shiftStart+120,shiftEnd-1),activeTask:vehicle.status==='running',charging:vehicle.status==='charging',orders:0,idleChecks:0,dispatch:false,reserved:false,atStation:false,charged:false,taskServed:false,taskConfirmed:false,closed:false,ready:false,missing:false,noResource:false,settled:false,stepCount:0};
    if(scenario==='low'||scenario==='resource'){ctx.soc=24;ctx.status='standby';ctx.activeTask=false;ctx.charging=false;}
    if(scenario==='resource')ctx.noResource=true;
    if(scenario==='missing')ctx.missing=true;
    if(scenario==='closing'){ctx.time=shiftEnd;ctx.status='standby';ctx.charging=false;}
    function record(graphId,node,outcome,message){trace.push({graphId,nodeId:node.id,title:title(node),outcome,message});ctx.stepCount++;}
    const fail=message=>{lastFault=message;return {outcome:'error',message};};
    function follow(graph,node,outcome,graphId){const links=graph.edges.filter(e=>e.from===node.id&&e.outcome===outcome);if(links.length!==1){summary=`${title(node)}的「${outcome}」出口未连接唯一后续节点。`;return null;}const target=graph.nodes.find(n=>n.id===links[0].to);if(!target)summary='下一节点不存在。';return target;}
    function recover() {
      manualRecovered=true;ctx.missing=false;ctx.noResource=false;
      if(['offline','maintenance'].includes(ctx.status))ctx.status='standby';
      if(!Number.isFinite(ctx.soc))ctx.soc=60;
      ctx.ready=false;ctx.reserved=false;ctx.charged=false;ctx.atStation=false;ctx.settled=false;
    }
    function executeStep(node,parent) {
      const success=message=>({outcome:'next',message});
      switch(node.kind) {
        case 'stepStart':return success('进入'+title(parent)+'。');
        case 'stepEnd':return {outcome:'complete',message:'阶段步骤已完成。'};
        case 'read_state':return ctx.missing||!Number.isFinite(ctx.soc)?fail('车辆状态缺失，无法读取有效 SOC。'):success(`读取 ${vehicleId}：SOC ${ctx.soc}%。`);
        case 'check_ready':
          if(ctx.missing||!Number.isFinite(ctx.soc))return fail('状态数据无效，等待人工核实。');
          if(['offline','maintenance'].includes(ctx.status))return fail(ctx.status==='offline'?'车辆离线，不能自动启动运营。':'车辆处于维修状态，不能自动启动运营。');
          ctx.ready=true;return success('连接与运营条件检查通过。');
        case 'check_occupancy':
          if(ctx.charging)return {stop:'waiting',outcome:'waiting',message:'已有补能任务，等待当前任务结束后再进入流程，避免重复安排。'};
          return success(ctx.activeTask?'已有订单，后续阶段将先处理当前任务。':'未发现冲突的任务占用。');
        case 'allow_dispatch':
          if(!ctx.ready)return fail('尚未通过运营准备检查。');
          if(ctx.closed)return fail('车辆已完成收班，不能在同一流程中再次开放接单。');
          if(ctx.reserved||ctx.charging)return fail('车辆仍占用补能资源，不能同时开放接单。');
          if(ctx.time>=shiftEnd)return {outcome:'timeout',bubble:true,message:'已到收班时间，返回主流程判断。'};
          ctx.dispatch=true;return success('允许接收订单。');
        case 'wait_order':
          if(!ctx.dispatch)return fail('尚未开放接单，不能等待新订单。');
          if(ctx.time>=shiftEnd)return {outcome:'timeout',bubble:true,message:'等待期间到达收班时间。'};
          if(ctx.orders===0){const existing=ctx.activeTask;ctx.activeTask=true;return success(existing?'继续执行当前已有订单。':'收到一笔示例订单，继续执行。');}
          if(ctx.idleChecks===0){ctx.time+=node.config.minutes;ctx.idleChecks++;return {outcome:'timeout',bubble:true,message:`等待 ${node.config.minutes} 分钟未收到新订单，重新判断。`};}
          return {stop:'waiting',outcome:'waiting',message:'已验证一单及等待到期后的循环，当前继续等待新订单。'};
        case 'service_task':
          if(!ctx.activeTask||!ctx.dispatch)return fail('没有可执行的订单，不能直接进入接送。');
          if(ctx.soc<12)return fail('示例电量不足以继续当前任务，需要人工处置。');
          ctx.time+=20;ctx.soc=Math.max(0,ctx.soc-6);ctx.taskServed=true;return success('完成示例接驾、上下客确认与送达，耗时 20 分钟。');
        case 'confirm_task':
          if(!ctx.taskServed)return fail('接送任务尚未完成，不能确认结束。');
          ctx.activeTask=false;ctx.taskServed=false;ctx.taskConfirmed=true;ctx.orders++;return success(`任务已确认结束，当前 SOC ${ctx.soc}%。`);
        case 'stop_dispatch':ctx.dispatch=false;return success('已停止新增派单。');
        case 'settle_task':
          if(ctx.dispatch)return fail('尚未停止新增派单，不能进入任务交接。');
          if(ctx.activeTask){if(ctx.soc<12)return fail('当前任务不能按示例条件继续，需要人工安排。');ctx.time+=15;ctx.soc=Math.max(0,ctx.soc-4);ctx.activeTask=false;ctx.orders++;}
          ctx.settled=true;return success('当前任务已处理，允许回场。');
        case 'reserve_station':
          if(!ctx.settled||ctx.activeTask)return fail('请先处理当前任务，再预约补能资源。');
          if(ctx.noResource){for(let attempt=0;attempt<node.config.retries;attempt++){ctx.time+=node.config.waitMinutes;record(parent.id,node,'retry',`无可用桩位，等待 ${node.config.waitMinutes} 分钟后重试 ${attempt+1}/${node.config.retries}。`);}return fail(`补能资源仍不可用，已达 ${node.config.retries} 次重试上限。`);}
          ctx.reserved=true;return success('已取得一处示例补能资源。');
        case 'return_station':
          if(!ctx.settled||ctx.activeTask||ctx.dispatch)return fail('车辆仍有未处理任务或仍允许派单，不能回场。');
          if(parent.kind==='charge'&&!ctx.reserved)return fail('尚未预约补能资源，不能执行补能回场。');
          if(ctx.soc<8)return fail('示例电量不足以完成回场，需要人工处置。');
          ctx.time+=10;ctx.soc=Math.max(0,ctx.soc-3);ctx.atStation=true;return success('已按示例路线返回场站。');
        case 'charge_battery':
          if(!ctx.reserved||!ctx.atStation)return fail('尚未取得资源或到达场站，不能开始充电。');
          ctx.charging=true;ctx.time+=35;ctx.soc=Math.max(ctx.soc,parent.config.targetSoc);ctx.charged=true;return success(`示例充电完成，SOC 达到 ${ctx.soc}%。`);
        case 'release_station':
          if(!ctx.reserved||!ctx.charged)return fail('补能尚未完成，不能直接释放资源并报告完成。');
          ctx.reserved=false;ctx.charging=false;return success('已退出充电位并释放预约资源。');
        case 'close_shift':
          if(!ctx.atStation||ctx.activeTask||ctx.dispatch)return fail('尚未满足停放、任务结束或停止派单条件。');
          ctx.reserved=false;ctx.charging=false;ctx.closed=true;return success('车辆已停放，完成本班次交接。');
        default:return fail('该步骤尚无模拟执行规则。');
      }
    }
    function executeChildren(parent) {
      const graph=parent.children;let node=graph.nodes.find(n=>n.kind==='stepStart');
      if(parent.kind==='operate'){ctx.taskConfirmed=false;ctx.taskServed=false;}
      if(parent.kind==='charge'||parent.kind==='close'){ctx.settled=false;ctx.atStation=false;ctx.charged=false;}
      while(node&&ctx.stepCount<160) {
        const result=executeStep(node,parent);record(parent.id,node,result.outcome,result.message);
        if(result.stop||result.bubble||result.outcome==='error')return result;
        if(result.outcome==='complete'){
          if(parent.kind==='prepare'&&!ctx.ready)return fail('运营准备步骤未完成有效校验。');
          if(parent.kind==='operate'&&!ctx.taskConfirmed)return fail('没有已确认完成的订单，不能报告运营任务完成。');
          if(parent.kind==='charge'&&(!ctx.charged||ctx.reserved||ctx.charging))return fail('尚未完成充电或释放资源。');
          if(parent.kind==='close'&&!ctx.closed)return fail('尚未完成停放与收班确认。');
          return {outcome:parent.kind==='prepare'?'ready':'done',message:title(parent)+'完成。'};
        }
        node=follow(graph,node,result.outcome,parent.id);
        if(!node)return {stop:'blocked',outcome:'blocked',message:summary};
      }
      return {stop:'blocked',outcome:'blocked',message:'已达到模拟步数上限，请检查阶段是否存在无法退出的循环。'};
    }
    let node=model.graph.nodes.find(n=>n.kind==='trigger');
    while(node&&ctx.stepCount<160) {
      let result;
      if(phaseSteps[node.kind]){
        if(node.config.mode==='manual'&&!approvedStages.has(node.id)){
          if(options.manualAction==='resume'&&!approvalUsed){approvedStages.add(node.id);approvalUsed=true;record('root',node,'confirmed','已模拟人工确认本阶段执行。');}
          else if(options.manualAction==='end'){result=fail('操作员选择终止当前模拟，转异常处置记录结果。');}
          else {record('root',node,'manual','本阶段要求人工确认，已暂停自动推进。');return finish('manual','等待人工确认「'+title(node)+'」。',ctx);}
        }
        if(!result){record('root',node,'enter','开始执行阶段内部步骤。');result=executeChildren(node);}
      } else if(node.kind==='trigger')result={outcome:'next',message:`车组「${model.group.name}」为 ${vehicleId} 启动独立模拟。`};
      else if(node.kind==='decide'){
        if(ctx.missing||!Number.isFinite(ctx.soc))result=fail('电量数据不可用，无法判定下一步。');
        else if(ctx.time>=shiftEnd)result={outcome:'close',message:`当前 ${timeString(ctx.time)} 已到收班时间，进入收班。`};
        else if(ctx.soc<=node.config.threshold)result={outcome:'charge',message:`SOC ${ctx.soc}% ≤ ${node.config.threshold}%，进入补能。`};
        else result={outcome:'operate',message:`SOC ${ctx.soc}% > ${node.config.threshold}%，班次有效，继续运营。`};
      } else if(node.kind==='manual'){
        if(options.manualAction==='end'){terminated=true;result={outcome:'end',message:'操作员选择终止本车模拟，不再继续派生任务。'};}
        else if(!manualRecovered&&(priorRecovery||(options.manualAction==='resume'&&!approvalUsed))){record('root',node,'manual',lastFault||'等待人工核实。');recover();if(!priorRecovery)approvalUsed=true;result={outcome:'resume',message:'已模拟人工处理并确认状态恢复，沿复检连线重新检查。'};}
        else {record('root',node,'manual',lastFault||'等待操作员处理。');return finish('manual',lastFault||'本车流程已暂停，等待人工处理。',ctx);}
      } else if(node.kind==='end'){
        if(!ctx.closed&&!terminated){record('root',node,'blocked','未完成收班且没有人工终止记录。');return finish('blocked','流程提前结束：尚未完成收班或人工终止。',ctx);}
        record('root',node,'completed',terminated?'已终止本车模拟。':'本车已完成收班。');return finish('completed',terminated?'已按人工选择终止本车模拟。':'已完成收班归巢，本车流程结束。',ctx);
      } else result={stop:'blocked',outcome:'blocked',message:'主流程节点类型无效。'};
      record('root',node,result.outcome,result.message);
      if(result.stop)return finish(result.stop,result.message,ctx);
      node=follow(model.graph,node,result.outcome,'root');
      if(!node)return finish('blocked',summary,ctx);
    }
    return finish('blocked','已达到模拟步数上限，请检查流程是否存在无法退出的循环。',ctx);
  }
  return {catalog,palette,create,createNode,validate,simulate};
});
