/**
 * bookmarklet.js
 *
 * Self-contained bookmarklet — paste the MINIFIED version of this into a
 * browser bookmark URL prefixed with  javascript:
 *
 * Usage:
 *   1. Open the Replicon timesheet page and authenticate.
 *   2. Click the bookmark.
 *   3. The autofill panel appears in the bottom-right corner.
 *
 * This file is the READABLE source. Run `npm run build:bookmarklet` to
 * generate the minified single-line version in /dist/bookmarklet.min.js.
 *
 * All four modules (Detector, PunchFiller, DistributionFiller, RepliconUI)
 * are inlined here so the bookmarklet is truly standalone.
 */

(function () {
  'use strict';

  // ── Guard: only run on Replicon timesheet pages ──────────────────────────
  if (!/replicon\.com.*\/my\/timesheet/.test(location.href)) {
    alert('Replicon Autofill: navigate to a timesheet page first.');
    return;
  }

  // ── If already injected, just show the panel ─────────────────────────────
  const existing = document.getElementById('replicon-autofill-panel');
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }

  // ── Dynamically load each module then boot ───────────────────────────────
  const BASE = chrome?.runtime?.getURL
    ? ''   // running inside extension — not expected here
    : '';

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload  = res;
      s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // For a pure bookmarklet we inline all code. This wrapper builds the
  // modules inline via eval-safe Function constructor so CSP isn't an issue
  // (Replicon's CSP blocks inline scripts but allows same-origin – the
  //  extension approach is preferred for production use).

  // ── Inline Detector ──────────────────────────────────────────────────────
  const Detector = (() => {
    function isTimesheetPage() { return /\/my\/timesheet\//.test(location.pathname); }
    function getPeriodLabel() {
      const el = document.querySelector('.timesheetPeriodSelect');
      return el ? el.textContent.trim() : '';
    }
    function getPunchDays() {
      const punchDays = Array.from(document.querySelectorAll('.day'))
        .filter(d => d.querySelector('a.addPunchLink')).slice(0, 7);
      return punchDays.map((day, index) => {
        const addLink    = day.querySelector('a.addPunchLink');
        const onclick    = (addLink && addLink.getAttribute('onclick')) || '';
        const dm         = onclick.match(/"y":(\d+),"m":(\d+),"d":(\d+)/);
        const y = dm ? +dm[1] : null, m = dm ? +dm[2] : null, d = dm ? +dm[3] : null;
        const isHoliday  = !!day.querySelector('.holidayIndicator,.timeOffType');
        const isDayOff   = day.classList.contains('dayOff');
        const punches    = day.querySelectorAll('.timePunch');
        return { index, y, m, d, isHoliday, isDayOff,
          hasPunches: punches.length > 0, punchCount: punches.length,
          addPunchEl: addLink, shouldFill: !isHoliday && !isDayOff && !punches.length };
      });
    }
    function getDistributionRows() {
      const grid = document.querySelector('.dataGrid.dateGrid');
      if (!grid) return [];
      return Array.from(grid.querySelectorAll('tbody tr'))
        .filter(r => !r.classList.contains('totalRow') && r.querySelectorAll('.day').length > 0)
        .map(row => ({
          rowEl: row,
          projectText: (row.querySelector('.task,.taskFixedWidth') || {}).textContent?.trim() || '',
          dayCells: Array.from(row.querySelectorAll('.day')),
        }));
    }
    function getAddRowButton() {
      return document.querySelector('[onclick*="AddNewTimeLine"],[onclick*="addNewTimeLine"]') ||
        Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Row'));
    }
    return { isTimesheetPage, getPeriodLabel, getPunchDays, getDistributionRows, getAddRowButton };
  })();

  // ── Inline PunchFiller ───────────────────────────────────────────────────
  const PunchFiller = (() => {
    const D = { inTime:'8:00 am', outTime:'4:00 pm', formTimeout:5000, stepDelay:350 };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function waitFor(fn, t=D.formTimeout, lbl='') {
      return new Promise((res,rej) => {
        const s=Date.now(), i=setInterval(()=>{const r=fn(); if(r){clearInterval(i);res(r);}
          else if(Date.now()-s>t){clearInterval(i);rej(new Error('Timeout: '+lbl));}},100);
      });
    }
    const getForm  = () => { const el=document.querySelector('input[class="time"][punchform="1"]'); return (el&&el.offsetParent)?el:null; };
    const waitForm = () => waitFor(getForm, D.formTimeout, 'form open');
    const waitClose= () => waitFor(()=>!getForm(), D.formTimeout, 'form close');
    function setVal(inp, val) {
      inp.focus();
      const ns=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      ns.call(inp,val);
      ['input','change'].forEach(e=>inp.dispatchEvent(new Event(e,{bubbles:true})));
    }
    function selType(lbl) {
      const rs=Array.from(document.querySelectorAll('input[type=radio]')).filter(r=>r.offsetParent);
      for(const r of rs){
        const lEl=document.querySelector(`label[for="${r.id}"]`);
        const t=(lEl?lEl.textContent:r.nextSibling?.textContent||'').trim().toUpperCase();
        if(t===lbl.toUpperCase()||r.value.toUpperCase().includes(lbl.toUpperCase())){if(!r.checked)r.click();return true;}
      }
    }
    function clickSave(){
      const b=document.querySelector('button.save')||Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().toLowerCase()==='save'&&b.offsetParent);
      if(b){b.click();return true;}return false;
    }
    async function addPunch(link,time,type){
      link.click(); const inp=await waitForm(); await sleep(D.stepDelay);
      setVal(inp,time); await sleep(D.stepDelay);
      selType(type); await sleep(D.stepDelay);
      if(!clickSave()) throw new Error('Save not found');
      await waitClose(); await sleep(D.stepDelay);
    }
    async function fillWeek(opts={},onP=()=>{}) {
      const cfg={...D,...opts}; const days=Detector.getPunchDays();
      let filled=0,skipped=0; const errors=[];
      for(const day of days){
        if(!day.shouldFill){onP('⏭ '+day.d+' (skip)');skipped++;continue;}
        try{
          onP('⏳ filling '+day.d);
          let fd=Detector.getPunchDays().find(x=>x.d===day.d&&x.m===day.m);
          if(!fd?.addPunchEl) throw new Error('Link not found');
          await addPunch(fd.addPunchEl,cfg.inTime,'IN'); onP('✔ IN '+cfg.inTime);
          fd=Detector.getPunchDays().find(x=>x.d===day.d&&x.m===day.m);
          if(!fd?.addPunchEl) throw new Error('Link not found for OUT');
          await addPunch(fd.addPunchEl,cfg.outTime,'OUT'); onP('✔ OUT '+cfg.outTime);
          filled++;
        }catch(e){
          const msg='✘ d'+day.d+': '+e.message; onP(msg); errors.push(msg);
          const c=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cancel'&&b.offsetParent);
          if(c)c.click(); await sleep(500);
        }
      }
      return {filled,skipped,errors};
    }
    return {fillWeek};
  })();

  // ── Inline DistributionFiller ────────────────────────────────────────────
  const DistributionFiller = (() => {
    const D={hoursPerDay:'8.00',formTimeout:5000,stepDelay:350};
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    function waitFor(fn,t=D.formTimeout,lbl=''){
      return new Promise((res,rej)=>{
        const s=Date.now(),i=setInterval(()=>{const r=fn();if(r){clearInterval(i);res(r);}
          else if(Date.now()-s>t){clearInterval(i);rej(new Error('Timeout: '+lbl));}},100);
      });
    }
    function setVal(inp,val){
      inp.focus();
      const ns=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      ns.call(inp,val);
      ['input','change'].forEach(e=>inp.dispatchEvent(new Event(e,{bubbles:true})));
    }
    const isCellEmpty=c=>{const t=c.textContent.trim();return t===''||t==='0'||t==='0.00'||t==='-';};
    const isFillable=c=>!['dayOff','holiday','readOnly','timeOff'].some(cl=>c.classList.contains(cl));

    async function fillDayCell(cell,hours){
      cell.click();await sleep(D.stepDelay/2);
      const inp=await waitFor(()=>cell.querySelector('input[type=text],input[type=number]'),D.formTimeout,'cell input');
      setVal(inp,hours);
      inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',keyCode:9,bubbles:true}));
      await sleep(D.stepDelay/2);
    }
    async function fillDistribution(projectCode,opts={},onP=()=>{}){
      const cfg={...D,...opts};let filled=0,skipped=0;const errors=[];
      onP('🔍 project: '+projectCode);
      const rows=Detector.getDistributionRows();
      const rowEntry=rows.find(r=>r.projectText.toLowerCase().includes(projectCode.toLowerCase()));
      if(!rowEntry){onP('⚠ Row not found. Please add the row manually first.');return{filled,skipped,errors};}
      const pdays=Detector.getPunchDays();
      for(let i=0;i<pdays.length&&i<rowEntry.dayCells.length;i++){
        const pd=pdays[i],cell=rowEntry.dayCells[i];
        if(pd.isHoliday||pd.isDayOff){onP('⏭ d'+pd.d+' (non-working)');skipped++;continue;}
        if(!isFillable(cell)){onP('⏭ d'+pd.d+' (not fillable)');skipped++;continue;}
        if(!isCellEmpty(cell)){onP('⏭ d'+pd.d+' (already has: '+cell.textContent.trim()+')');skipped++;continue;}
        try{await fillDayCell(cell,cfg.hoursPerDay);onP('✔ d'+pd.d+' → '+cfg.hoursPerDay);filled++;}
        catch(e){const msg='✘ d'+pd.d+': '+e.message;onP(msg);errors.push(msg);}
      }
      return{filled,skipped,errors};
    }
    return{fillDistribution};
  })();

  // ── Inline UI ────────────────────────────────────────────────────────────
  // (Same as ui.js but self-contained — references the locally-scoped modules)
  const PANEL_ID = 'replicon-autofill-panel';
  const SK = 'replicon_autofill_config';

  const CSS=`
    #${PANEL_ID}{position:fixed;bottom:24px;right:24px;z-index:999999;width:320px;background:#fff;
      border:1.5px solid #3b5bdb;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.18);
      font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#222;overflow:hidden;}
    #${PANEL_ID} .h{background:#3b5bdb;color:#fff;padding:10px 14px;display:flex;
      align-items:center;justify-content:space-between;cursor:move;user-select:none;}
    #${PANEL_ID} .h span{font-weight:700;font-size:14px;}
    #${PANEL_ID} .tb{background:none;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;}
    #${PANEL_ID} .b{padding:12px 14px;}
    #${PANEL_ID} label{display:block;font-weight:700;color:#3b5bdb;margin:8px 0 4px;}
    #${PANEL_ID} .row{display:flex;gap:8px;margin-bottom:6px;align-items:center;}
    #${PANEL_ID} .row input{flex:1;padding:5px 8px;border:1px solid #ced4da;border-radius:5px;font-size:12px;}
    #${PANEL_ID} .btn{padding:6px 14px;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:700;}
    #${PANEL_ID} .p{background:#3b5bdb;color:#fff;width:100%;margin-top:4px;}
    #${PANEL_ID} .a{background:#099268;color:#fff;width:100%;margin-top:4px;}
    #${PANEL_ID} .p:hover{background:#2f4bc7;} #${PANEL_ID} .a:hover{background:#087f5b;}
    #${PANEL_ID} hr{border:none;border-top:1px solid #e9ecef;margin:8px 0;}
    #${PANEL_ID} .log{max-height:130px;overflow-y:auto;background:#f8f9fa;border:1px solid #dee2e6;
      border-radius:5px;padding:6px 8px;font-size:11px;line-height:1.6;font-family:Consolas,monospace;}
    #${PANEL_ID} .log .ok{color:#2f9e44;} #${PANEL_ID} .log .er{color:#e03131;}
    #${PANEL_ID} .log .in{color:#1971c2;}
    #${PANEL_ID} .st{margin-top:4px;font-size:11px;color:#868e96;text-align:right;}`;

  function loadCfg(){try{return JSON.parse(localStorage.getItem(SK)||'{}')}catch{return{}}}
  function saveCfg(){
    const c={inTime:q('rpa-it').value,outTime:q('rpa-ot').value,
      projectCode:q('rpa-pc').value,hoursPerDay:q('rpa-hr').value};
    localStorage.setItem(SK,JSON.stringify(c));return c;
  }
  const q=id=>document.getElementById(id);
  const log=(m,t='in')=>{const el=q('rpa-log');if(!el)return;
    const d=document.createElement('div');d.className=t;d.textContent=m;
    el.appendChild(d);el.scrollTop=el.scrollHeight;};
  const clrLog=()=>{const el=q('rpa-log');if(el)el.innerHTML='';};
  const setSt=m=>{const el=q('rpa-st');if(el)el.textContent=m;};
  const disBtn=dis=>['rpa-fp','rpa-fd','rpa-fa'].forEach(id=>{const b=q(id);if(b)b.disabled=dis;});

  const cfg=loadCfg();
  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  const styleEl=document.createElement('style');
  styleEl.textContent=CSS;
  document.head.appendChild(styleEl);

  panel.innerHTML=`
    <div class="h" id="rpa-dh"><span>⏱ Replicon Autofill</span>
      <button class="tb" id="rpa-cb" title="Collapse">▼</button></div>
    <div class="b" id="rpa-bd">
      <label>🕐 Punch Times</label>
      <div class="row"><input id="rpa-it" type="text" value="${cfg.inTime||'8:00 am'}" placeholder="IN 8:00 am"/>
        <input id="rpa-ot" type="text" value="${cfg.outTime||'4:00 pm'}" placeholder="OUT 4:00 pm"/></div>
      <button class="btn p" id="rpa-fp">Fill Punches</button>
      <hr/>
      <label>📋 Distribution</label>
      <div class="row"><input id="rpa-pc" type="text" value="${cfg.projectCode||''}" placeholder="Project / task name…"/>
        <input id="rpa-hr" type="text" value="${cfg.hoursPerDay||'8.00'}" placeholder="hrs" style="width:52px;flex:none"/></div>
      <button class="btn p" id="rpa-fd">Fill Distribution</button>
      <hr/>
      <button class="btn a" id="rpa-fa">🚀 Fill All</button>
      <div id="rpa-log" class="log" style="margin-top:8px"></div>
      <div id="rpa-st" class="st">Ready — ${Detector.getPeriodLabel()}</div>
    </div>`;
  document.body.appendChild(panel);

  // Collapse
  q('rpa-cb').onclick=()=>{
    const bd=q('rpa-bd'),cb=q('rpa-cb');
    bd.style.display=bd.style.display==='none'?'':'none';
    cb.textContent=bd.style.display===''?'▼':'▲';
  };

  // Drag
  (()=>{
    const h=q('rpa-dh'); let dr=false,ox=0,oy=0;
    h.onmousedown=e=>{dr=true;const r=panel.getBoundingClientRect();ox=e.clientX-r.left;oy=e.clientY-r.top;e.preventDefault();};
    document.addEventListener('mousemove',e=>{if(!dr)return;panel.style.left=(e.clientX-ox)+'px';panel.style.top=(e.clientY-oy)+'px';panel.style.right='auto';panel.style.bottom='auto';});
    document.addEventListener('mouseup',()=>dr=false);
  })();

  async function onFillPunches(){
    clrLog();const cfg=saveCfg();disBtn(true);setSt('Filling punches…');
    const r=await PunchFiller.fillWeek({inTime:cfg.inTime,outTime:cfg.outTime},
      m=>log(m,m.startsWith('✘')?'er':m.startsWith('⏭')?'in':'ok'));
    log(`Done: ${r.filled} filled, ${r.skipped} skipped`,'ok');setSt(`Punches: ${r.filled} ✔`);disBtn(false);
  }
  async function onFillDist(){
    clrLog();const cfg=saveCfg();if(!cfg.projectCode){log('⚠ Enter project code','er');return;}
    disBtn(true);setSt('Filling distribution…');
    const r=await DistributionFiller.fillDistribution(cfg.projectCode,{hoursPerDay:cfg.hoursPerDay},
      m=>log(m,m.startsWith('✘')?'er':m.startsWith('⏭')?'in':'ok'));
    log(`Done: ${r.filled} filled, ${r.skipped} skipped`,'ok');setSt(`Dist: ${r.filled} ✔`);disBtn(false);
  }
  async function onFillAll(){
    clrLog();const cfg=saveCfg();disBtn(true);setSt('Running…');
    const pr=await PunchFiller.fillWeek({inTime:cfg.inTime,outTime:cfg.outTime},m=>log(m,m.startsWith('✘')?'er':m.startsWith('⏭')?'in':'ok'));
    log(`Punches: ${pr.filled} filled`,'ok');
    if(cfg.projectCode){
      const dr=await DistributionFiller.fillDistribution(cfg.projectCode,{hoursPerDay:cfg.hoursPerDay},m=>log(m,m.startsWith('✘')?'er':m.startsWith('⏭')?'in':'ok'));
      log(`Distribution: ${dr.filled} filled`,'ok');
    }else{log('ℹ No project – dist skipped','in');}
    setSt('All done ✔');disBtn(false);
  }

  q('rpa-fp').onclick=onFillPunches;
  q('rpa-fd').onclick=onFillDist;
  q('rpa-fa').onclick=onFillAll;
})();
