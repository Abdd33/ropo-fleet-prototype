const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../dist/automation-model.js');
const vehicles = [
  {id:'RT-021',soc:68,status:'standby'},
  {id:'RT-041',soc:27,status:'charging'},
  {id:'RT-046',soc:74,status:'offline'},
  {id:'RT-008',soc:68,status:'running'}
];
const make = () => M.create(vehicles);
const node = (m,kind) => m.graph.nodes.find(n=>n.kind===kind);
test('default hierarchy is valid and old values are copied, not aliased',()=>{
  const legacy={threshold:34,nodes:[{id:'old'}]};const m=M.create(vehicles,legacy);
  assert.deepEqual(M.validate(m,vehicles),[]);assert.equal(node(m,'decide').config.threshold,34);
  node(m,'decide').config.threshold=20;assert.equal(legacy.threshold,34);
  const a=M.createNode('charge','a'),b=M.createNode('charge','b');a.config.targetSoc=90;
  assert.equal(b.config.targetSoc,80);a.children.nodes[0].x=900;assert.notEqual(b.children.nodes[0].x,900);
});
test('normal execution follows child steps, completes a task and waits after reevaluation',()=>{
  const m=make(),r=M.simulate(m,vehicles[0]);assert.equal(r.status,'waiting');
  assert.ok(r.trace.some(t=>t.graphId==='operate'&&t.title==='执行接送任务'));
  assert.ok(r.trace.some(t=>t.graphId==='root'&&t.nodeId==='operate'&&t.outcome==='timeout'));
  assert.ok(r.trace.filter(t=>t.nodeId==='decide').length>=3);
  assert.equal(r.soc,62);
});
test('low SOC follows charge subgraph, frees resource and then resumes operation',()=>{
  const r=M.simulate(make(),vehicles[0],'low');assert.equal(r.status,'waiting');
  const reserve=r.trace.findIndex(t=>t.title==='预约补能资源'),release=r.trace.findIndex(t=>t.title==='释放补能资源');
  assert.ok(reserve>=0&&release>reserve);assert.equal(r.soc,74);
  assert.ok(r.trace.filter(t=>t.nodeId==='prepare'&&t.outcome==='enter').length>=2);
});
test('closing scenario returns to station and actually reaches end',()=>{
  const r=M.simulate(make(),vehicles[0],'closing');assert.equal(r.status,'completed');
  assert.equal(r.trace.at(-1).nodeId,'end');assert.ok(r.trace.some(t=>t.title==='停放与收班确认'));
  assert.ok(!r.trace.some(t=>t.title==='开放接单'));
});
test('unavailable resources stop after configured retries and can recover through manual edge',()=>{
  const m=make(),r=M.simulate(m,vehicles[0],'resource');assert.equal(r.status,'manual');
  assert.equal(r.trace.filter(t=>t.outcome==='retry').length,2);
  const resumed=M.simulate(m,vehicles[0],'resource',{manualAction:'resume'});
  assert.equal(resumed.status,'waiting');assert.ok(resumed.trace.some(t=>t.nodeId==='manual'&&t.outcome==='resume'));
  assert.ok(resumed.trace.some(t=>t.message.includes('仍不可用')));
  const ended=M.simulate(m,vehicles[0],'resource',{manualAction:'end'});
  assert.equal(ended.status,'completed');assert.ok(ended.summary.includes('终止'));
});
test('current vehicle state is respected and simulation does not mutate inputs',()=>{
  const m=make(),original=JSON.stringify(m),input=JSON.stringify(vehicles);
  assert.equal(M.simulate(m,vehicles[1]).status,'waiting');
  assert.equal(M.simulate(m,vehicles[2]).status,'manual');
  assert.equal(M.simulate(m,vehicles[2],'current',{manualAction:'resume'}).status,'waiting');
  assert.equal(M.simulate(m,vehicles[0],'missing').status,'manual');
  assert.equal(M.simulate(m,vehicles[0],'missing',{manualAction:'resume'}).status,'waiting');
  assert.equal(JSON.stringify(m),original);assert.equal(JSON.stringify(vehicles),input);
});
test('changing a real root edge changes path; it is not node-array animation',()=>{
  const m=make();m.graph.edges.find(e=>e.from==='prepare'&&e.outcome==='ready').to='close';
  assert.equal(M.validate(m,vehicles).filter(i=>i.message.includes('无法从入口')).length>0,true);
  m.graph.edges.find(e=>e.from==='close'&&e.outcome==='error').to='decide';
  assert.deepEqual(M.validate(m,vehicles),[]);
  const r=M.simulate(m,vehicles[0]);assert.equal(r.status,'completed');
  assert.ok(!r.trace.some(t=>t.title==='开放接单'));
});
test('child edge reordering changes execution and catches an invalid operational sequence',()=>{
  const m=make(),g=node(m,'charge').children;
  const stop=g.nodes.find(n=>n.kind==='stop_dispatch'),settle=g.nodes.find(n=>n.kind==='settle_task'),reserve=g.nodes.find(n=>n.kind==='reserve_station'),back=g.nodes.find(n=>n.kind==='return_station');
  g.edges.find(e=>e.from===stop.id).to=reserve.id;
  g.edges.find(e=>e.from===reserve.id).to=settle.id;
  g.edges.find(e=>e.from===settle.id).to=back.id;
  assert.deepEqual(M.validate(m,vehicles),[]);
  const r=M.simulate(m,vehicles[0],'low');assert.equal(r.status,'manual');assert.ok(r.summary.includes('先处理当前任务'));
});
test('broken edges, unknown members and incompatible thresholds are blocked',()=>{
  const m=make();m.graph.edges=m.graph.edges.filter(e=>!(e.from==='decide'&&e.outcome==='charge'));
  assert.ok(M.validate(m,vehicles).some(i=>i.nodeId==='decide'&&i.message.includes('需要补能')));
  assert.equal(M.simulate(m,vehicles[0]).status,'blocked');
  const n=make();n.group.vehicleIds.push('RT-NO');assert.ok(M.validate(n,vehicles).some(i=>i.message.includes('RT-NO')));
  const p=make();node(p,'decide').config.threshold=50;node(p,'charge').config.targetSoc=50;
  assert.ok(M.validate(p,vehicles).some(i=>i.message.includes('目标必须高于')));
});
test('manual execution mode pauses before actions and requires an explicit simulation confirmation',()=>{
  const m=make();node(m,'operate').config.mode='manual';
  const waiting=M.simulate(m,vehicles[0]);assert.equal(waiting.status,'manual');
  assert.ok(!waiting.trace.some(t=>t.title==='执行接送任务'));
  assert.equal(M.simulate(m,vehicles[0],'current',{manualAction:'resume'}).status,'waiting');
});
test('instant control loops, duplicate results and missing necessary child steps are rejected',()=>{
  const m=make();m.graph.edges.find(e=>e.from==='prepare'&&e.outcome==='ready').to='decide';
  m.graph.edges.find(e=>e.from==='decide'&&e.outcome==='operate').to='prepare';
  assert.ok(M.validate(m,vehicles).some(i=>i.message.includes('即时循环')));
  const n=make();n.graph.edges.push({...n.graph.edges[0],id:'extra'});
  assert.ok(M.validate(n,vehicles).some(i=>i.message.includes('出口须连接一个')));
  const p=make();node(p,'operate').children.nodes=node(p,'operate').children.nodes.filter(n=>n.kind!=='service_task');
  assert.ok(M.validate(p,vehicles).some(i=>i.message.includes('缺少必要步骤')));
});
test('each manual phase needs its own confirmation and prior recovery is replayed explicitly',()=>{
  const m=make();node(m,'charge').config.mode='manual';node(m,'operate').config.mode='manual';
  const first=M.simulate(m,vehicles[0],'low');assert.equal(first.status,'manual');
  const second=M.simulate(m,vehicles[0],'low',{manualAction:'resume',resumeState:first.resumeState});
  assert.equal(second.status,'manual');assert.ok(second.summary.includes('接单运营'));
  const third=M.simulate(m,vehicles[0],'low',{manualAction:'resume',resumeState:second.resumeState});
  assert.equal(third.status,'waiting');assert.deepEqual(third.resumeState.approvedStages,['charge','operate']);
  const broken=make();node(broken,'operate').config.mode='manual';
  const fault=M.simulate(broken,vehicles[0],'missing',{manualAction:'resume'});
  assert.equal(fault.status,'manual');assert.equal(fault.resumeState.recovered,true);
  const after=M.simulate(broken,vehicles[0],'missing',{manualAction:'resume',resumeState:fault.resumeState});
  assert.equal(after.status,'waiting');
});
test('charge that finishes after shift does not reopen dispatch',()=>{
  const m=make();m.group.shiftEnd='10:20';
  const r=M.simulate(m,vehicles[0],'low');
  assert.equal(r.status,'completed');assert.ok(r.trace.some(t=>t.nodeId==='decide'&&t.outcome==='close'));
  assert.ok(!r.trace.some(t=>t.title==='开放接单'));
});
