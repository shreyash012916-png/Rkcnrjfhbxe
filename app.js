const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = {
  agricultureUrl: localStorage.getItem('orbita_ag') || '',
  industryUrl: localStorage.getItem('orbita_ind') || '',
  simulate: localStorage.getItem('orbita_sim') === '1',
  speak: localStorage.getItem('orbita_speak') !== '0',
  history: [],
  briefText: '',
  briefName: '',
  lastPlan: null,
  status: { agriculture: {}, industry: {} },
  speaking: false,
  listening: false,
};
let pdfjsLib = null;

window.addEventListener('error', (e) => { log(`UI error: ${e.message}`, 'error'); });
window.addEventListener('unhandledrejection', (e) => { log(`Promise error: ${e.reason?.message || e.reason}`, 'error'); });

function log(message, type='info') {
  const wrap = $('#log');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `log-row ${type}`;
  el.innerHTML = `<time>${new Date().toLocaleTimeString([], {hour12:false})}</time><span>${escapeHtml(message)}</span>`;
  wrap.prepend(el);
  while (wrap.children.length > 80) wrap.lastElementChild.remove();
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toast(message, type='info') { const t=$('#toast'); t.textContent=message; t.className=`toast show ${type}`; clearTimeout(t._timer); t._timer=setTimeout(()=>t.className='toast', 3200); }
function addBubble(kind, text, extras='') { const wrap=$('#chat'); const el=document.createElement('div'); el.className=`bubble ${kind}`; el.innerHTML=`<small>${kind==='bot'?'ORBITA':'YOU'}</small><p>${escapeHtml(text).replace(/\n/g,'<br>')}</p>${extras}`; wrap.appendChild(el); wrap.scrollTop=wrap.scrollHeight; }
function setCommandState(label, busy=false){ $('#commandState').textContent=label; $('#sendBtn').disabled=busy; $('#sendBtn').textContent=busy?'WORKING…':'SEND ↗'; }
function updateClock(){ $('#clock').textContent=new Date().toLocaleTimeString([], {hour12:false}); }
function cleanBaseUrl(v){ return String(v||'').trim().replace(/\/+$/,''); }
function speak(text){
  if (!state.speak || !('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.rate=.98; u.pitch=.92; u.volume=1;
  u.onstart=()=>{ state.speaking=true; $('#voiceStatus').textContent='ORBITA SPEAKING'; };
  u.onend=()=>{ state.speaking=false; $('#voiceStatus').textContent=state.listening?'LISTENING':'VOICE READY'; };
  u.onerror=()=>{ state.speaking=false; $('#voiceStatus').textContent='VOICE READY'; log('Speech output could not play in this browser.', 'error'); };
  window.speechSynthesis.speak(u);
}
function startListening(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input is unavailable here. Use the command box.', 'error'); return; }
  if (state.listening) return;
  const rec=new SR(); rec.lang='en-IN'; rec.interimResults=true; rec.continuous=false; state.listening=true;
  $('#voiceLabel').textContent='LISTENING…'; $('#voiceStatus').textContent='LISTENING'; $('#voiceBtn').classList.add('active');
  rec.onresult=(e)=>{ let final=''; for (let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal) final+=e.results[i][0].transcript; } if(final){ $('#commandInput').value=final.trim(); sendCommand(); } };
  rec.onerror=(e)=>{ log(`Voice input: ${e.error}`, 'error'); toast(`Voice input: ${e.error}`, 'error'); };
  rec.onend=()=>{ state.listening=false; $('#voiceLabel').textContent='TALK TO ORBITA'; $('#voiceStatus').textContent=state.speaking?'ORBITA SPEAKING':'VOICE READY'; $('#voiceBtn').classList.remove('active'); };
  rec.start();
}
async function fetchJson(url, options={}, timeoutMs=5000){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const headers={...(options.headers||{})};
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
    const res=await fetch(url,{...options,signal:controller.signal,headers});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

function defaultSimulated(){ return {
  agriculture:{online:true,soil:31,waterTank:84,temperature:28.7,humidity:62,pump:false,auto:false,available:['ESP32','soil moisture sensor','water pump','temperature/humidity','automatic irrigation']},
  industry:{online:true,machine:false,load:42,vibration:.08,temperature:30.8,camera:true,available:['ESP32','ESP32-CAM','machine relay','camera feed','load telemetry']}
}; }

async function pollZone(url, zone){
  if(!url) return {online:false, configured:false};
  const data=await fetchJson(`${url}/api/status`,{method:'GET',headers:{}},3500);
  const source=data.data||data;
  return {online:true,configured:true,...source};
}

async function refreshStatus(){
  $('#coreState').textContent='SCANNING SYSTEMS';
  if(state.simulate){ state.status=defaultSimulated(); applyStatus(); $('#coreState').textContent='SIMULATION CORE'; return; }
  const [a,i]=await Promise.allSettled([pollZone(state.agricultureUrl,'agriculture'),pollZone(state.industryUrl,'industry')]);
  state.status={agriculture:a.status==='fulfilled'?a.value:{online:false,error:a.reason?.message},industry:i.status==='fulfilled'?i.value:{online:false,error:i.reason?.message}};
  applyStatus();
  const onlineCount=[state.status.agriculture,state.status.industry].filter(x=>x.online).length;
  $('#coreState').textContent=onlineCount===2?'LOCAL CORE ONLINE':onlineCount===1?'PARTIAL LINK':'LOCAL CORE / WAITING FOR ESP';
}
function setPill(id, online){ $(id).innerHTML=`<i></i>${online?'ONLINE':'OFFLINE'}`; $(id).classList.toggle('online',online); }
function value(id,v,suffix=''){ $(id).textContent=(v===null||v===undefined||v==='')?'—':`${v}${suffix}`; }
function applyStatus(){
  const a=state.status.agriculture||{}, i=state.status.industry||{};
  setPill('#agStatus',!!a.online); setPill('#inStatus',!!i.online);
  value('#soil',a.soil); value('#tank',a.waterTank); value('#air',a.temperature); $('#pumpState').textContent=a.online?(a.pump?'ON':'OFF'):'—'; $('#autoState').textContent=a.online?(a.auto?'ON':'OFF'):'—';
  value('#load',i.load); value('#vibration',i.vibration); value('#indAir',i.temperature); $('#machineState').textContent=i.online?(i.machine?'ON':'OFF'):'—'; $('#cameraState').textContent=i.online?(i.camera?'ONLINE':'NO SIGNAL'):'—'; $('#camState').textContent=i.online?(i.camera?'LIVE LINK':'NO SIGNAL'):'NO SIGNAL';
  $('#docState').textContent=state.briefText?'LOADED':'NONE';
}

async function runHardware(zone, cmd){
  if(state.simulate){ applySimAction(zone,cmd); log(`SIM ${zone} → ${cmd}`,'ok'); return {ok:true,simulated:true}; }
  const base=zone==='agriculture'?state.agricultureUrl:state.industryUrl;
  if(!base) throw new Error(`${zone.toUpperCase()} ESP32 IP is not configured.`);
  let endpoint, body;
  if(cmd==='pump_on'||cmd==='pump_off'){ endpoint='/api/pump'; body={on:cmd==='pump_on'}; }
  else if(cmd==='auto_on'||cmd==='auto_off'){ endpoint='/api/auto'; body={enabled:cmd==='auto_on'}; }
  else if(cmd==='machine_on'||cmd==='machine_off'){ endpoint='/api/machine'; body={on:cmd==='machine_on'}; }
  else if(cmd==='emergency_stop'){ endpoint='/api/stop'; body={}; }
  else throw new Error('Unsupported hardware action.');
  const result=await fetchJson(base+endpoint,{method:'POST',body:JSON.stringify(body)},4500); log(`${zone.toUpperCase()} → ${cmd}`,'ok'); return result;
}
function applySimAction(zone,cmd){ const s=state.status[zone]; if(zone==='agriculture'){ if(cmd==='pump_on')s.pump=true; if(cmd==='pump_off')s.pump=false; if(cmd==='auto_on')s.auto=true; if(cmd==='auto_off')s.auto=false; if(s.auto&&s.soil<35)s.pump=true; } if(zone==='industry'){ if(cmd==='machine_on')s.machine=true; if(cmd==='machine_off'||cmd==='emergency_stop')s.machine=false; } applyStatus(); }

async function sendCommand(){
  const input=$('#commandInput'); const message=input.value.trim(); if(!message || $('#sendBtn').disabled) return;
  input.value=''; addBubble('user',message); setCommandState('THINKING',true); const started=performance.now();
  try{
    await refreshStatus();
    const data=await fetchJson('/api/agent',{method:'POST',body:JSON.stringify({message,status:state.status,brief:state.briefText,history:state.history.slice(-10),lastPlan:state.lastPlan})},6500);
    state.history.push({role:'user',text:message},{role:'assistant',text:data.reply}); state.history=state.history.slice(-14);
    $('#latency').textContent=`${Math.round(performance.now()-started)} ms`; $('#commandState').textContent=data.state||'READY'; addBubble('bot',data.reply);
    if(data.plan){ state.lastPlan=data.plan; renderPlan(data.plan); }
    if(!data.plan && Array.isArray(data.actions) && data.actions.length) state.lastPlan=null;
    if(Array.isArray(data.actions)&&data.actions.length){ setCommandState('EXECUTING',true); for(const a of data.actions) await runHardware(a.zone,a.action); await refreshStatus(); }
    speak(data.reply); log(`ORBITA: ${data.reply}`,'ok'); setCommandState('READY',false);
  }catch(err){ addBubble('bot',`I couldn’t complete that because ${err.message}`); log(`Agent error: ${err.message}`,'error'); toast(err.message,'error'); setCommandState('READY',false); }
}
function renderPlan(plan){
  const html=`<div class="plan"><strong>${escapeHtml(plan.title)}</strong>${plan.lines.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}${plan.actions?.length?`<em>LIVE ACTIONS READY: ${plan.actions.map(x=>escapeHtml(x.action.replaceAll('_',' '))).join(' · ')}</em>`:`<em>NO HARDWARE CHANGE REQUIRED</em>`}</div>`;
  $('#chat').insertAdjacentHTML('beforeend',html); $('#chat').scrollTop=$('#chat').scrollHeight;
}

async function initPdfModule(){
  try{ pdfjsLib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs'); $('#briefState').textContent='PDF READY'; log('PDF reader ready.','ok'); }
  catch(err){ log(`PDF reader unavailable: ${err.message}`,'error'); $('#briefState').textContent='PDF LIMITED'; }
}
async function extractPdf(file){
  if(file.size>8*1024*1024) throw new Error('Keep the PDF under 8 MB.');
  if(!pdfjsLib) await initPdfModule();
  if(!pdfjsLib) throw new Error('The browser could not load the PDF reader.');
  const data=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data}).promise; let text='';
  for(let p=1;p<=Math.min(pdf.numPages,30);p++){ const page=await pdf.getPage(p); const content=await page.getTextContent(); text+=content.items.map(item=>item.str||'').join(' ')+'\n'; }
  text=text.replace(/\s+/g,' ').trim(); if(!text) throw new Error('This PDF does not contain readable text.');
  return {text,name:file.name,pages:pdf.numPages};
}
async function loadPdf(file){
  try{
    $('#briefState').textContent='READING PDF…'; const result=await extractPdf(file); state.briefText=result.text.slice(0,12000); state.briefName=result.name; $('#briefName').textContent=result.name; $('#briefSummary').textContent=`${result.pages} page(s) · ${state.briefText.length.toLocaleString()} readable characters`; $('#briefFile').hidden=false; $('#dropZone').hidden=true; $('#briefState').textContent='LOADED'; $('#docState').textContent='LOADED'; log(`Mission brief loaded: ${result.name}`,'ok'); addBubble('bot',`I’ve loaded “${result.name}”. I can use its extracted instructions when you ask me to plan or explain the exhibition.`); speak(`Mission brief loaded. I can use it during the demonstration.`);
  }catch(err){ $('#briefState').textContent='NO FILE'; toast(err.message,'error'); log(`PDF error: ${err.message}`,'error'); }
}

function openSettings(){ $('#settingsModal').classList.add('open'); $('#settingsModal').setAttribute('aria-hidden','false'); $('#agUrl').value=state.agricultureUrl; $('#indUrl').value=state.industryUrl; $('#simulate').checked=state.simulate; $('#speakReplies').checked=state.speak; }
function closeSettings(){ $('#settingsModal').classList.remove('open'); $('#settingsModal').setAttribute('aria-hidden','true'); }
function saveSettings(){ state.agricultureUrl=cleanBaseUrl($('#agUrl').value); state.industryUrl=cleanBaseUrl($('#indUrl').value); state.simulate=$('#simulate').checked; state.speak=$('#speakReplies').checked; localStorage.setItem('orbita_ag',state.agricultureUrl); localStorage.setItem('orbita_ind',state.industryUrl); localStorage.setItem('orbita_sim',state.simulate?'1':'0'); localStorage.setItem('orbita_speak',state.speak?'1':'0'); closeSettings(); refreshStatus(); toast('Configuration saved.'); log('Configuration updated.','ok'); }
async function testLinks(){ const out=$('#testResult'); out.textContent='Testing…'; try{ const a=state.simulate?{online:true}:{...(await pollZone(state.agricultureUrl,'agriculture'))}; const i=state.simulate?{online:true}:{...(await pollZone(state.industryUrl,'industry'))}; out.textContent=`Agriculture: ${a.online?'ONLINE':'OFFLINE'} · Industry: ${i.online?'ONLINE':'OFFLINE'}`; } catch(e){ out.textContent=`Link test: ${e.message}`; } }

$$('[data-prompt]').forEach(btn=>btn.addEventListener('click',()=>{ $('#commandInput').value=btn.dataset.prompt; sendCommand(); }));
$$('[data-action]').forEach(btn=>btn.addEventListener('click',async()=>{ try{ setCommandState('EXECUTING',true); await runHardware(btn.dataset.zone,btn.dataset.action); await refreshStatus(); setCommandState('READY',false); toast(`${btn.dataset.action.replaceAll('_',' ')} completed.`,'ok'); }catch(e){ setCommandState('READY',false); toast(e.message,'error'); log(e.message,'error'); } }));
$('#sendBtn').addEventListener('click',sendCommand); $('#commandInput').addEventListener('keydown',e=>{ if(e.key==='Enter') sendCommand(); }); $('#voiceBtn').addEventListener('click',startListening); $('#settingsBtn').addEventListener('click',openSettings); $('#closeSettings').addEventListener('click',closeSettings); $('#saveSettings').addEventListener('click',saveSettings); $('#testConnections').addEventListener('click',testLinks); $('#testVoice').addEventListener('click',()=>speak('Hello. I am ORBITA. Voice output is working.'));
$('#demoBtn').addEventListener('click',()=>{ state.simulate=!state.simulate; $('#demoBtn').textContent=`SIMULATION: ${state.simulate?'ON':'OFF'}`; localStorage.setItem('orbita_sim',state.simulate?'1':'0'); refreshStatus(); log(`Simulation ${state.simulate?'enabled':'disabled'}.`,'ok'); });
$('#clearChat').addEventListener('click',()=>{ state.history=[]; $('#chat').innerHTML='<div class="bubble bot"><small>ORBITA</small><p>Conversation cleared. Mission control is ready.</p></div>'; }); $('#clearLog').addEventListener('click',()=>$('#log').innerHTML=''); $('#clearBrief').addEventListener('click',()=>{state.briefText='';state.briefName='';$('#briefFile').hidden=true;$('#dropZone').hidden=false;$('#briefState').textContent='NO FILE';$('#docState').textContent='NONE';log('Mission brief removed.');});
$('#pdfInput').addEventListener('change',e=>{const file=e.target.files?.[0]; if(file) loadPdf(file);});
$('#dropZone').addEventListener('dragover',e=>{e.preventDefault();$('#dropZone').classList.add('drag');}); $('#dropZone').addEventListener('dragleave',()=>$('#dropZone').classList.remove('drag')); $('#dropZone').addEventListener('drop',e=>{e.preventDefault();$('#dropZone').classList.remove('drag');const file=e.dataTransfer.files?.[0]; if(file) loadPdf(file);});
window.addEventListener('keydown',e=>{ if(e.code==='Space' && document.activeElement?.tagName!=='INPUT'){e.preventDefault();startListening();} if(e.key==='Escape')closeSettings(); });
setInterval(updateClock,1000); updateClock(); $('#simulate').checked=state.simulate; $('#speakReplies').checked=state.speak; $('#demoBtn').textContent=`SIMULATION: ${state.simulate?'ON':'OFF'}`; $('#voiceTech').textContent='BROWSER TTS';
log('ORBITA local core booted.','ok'); refreshStatus(); initPdfModule();
