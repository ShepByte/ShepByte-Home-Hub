'use strict';
const $=id=>document.getElementById(id);
const panels={
  devices:[['Paired devices','Preview only'],['Live dashboard','Use the backend address']],
  system:[['Dashboard','V0.2'],['Mode','Visual prototype'],['Hub health','Not connected']],
  data:[['History','Available in live dashboard'],['Live readings','Never stored by this preview']],
  updates:[['Dashboard','V0.2'],['Device versions','Available when connected']],
  errors:[['Connection state','Not connected'],['Device issues','Available in live dashboard']],
  settings:[['Navigation','Swipe, drag or arrow keys'],['Zoom','Pinch or + / −'],['Environment','Ambient; umbrella toggles rain'],['Weather source','Decorative, not live weather']]
};
let lastNode=null;
function showPanel(name){
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('active',n.dataset.node===name));
  if(name==='home'){$('panel').hidden=true;return;}
  lastNode=document.querySelector(`[data-node="${name}"]`);
  $('panel-title').textContent=name[0].toUpperCase()+name.slice(1);
  $('panel-body').replaceChildren();
  for(const [label,value] of panels[name]||[]){
    const row=document.createElement('div');row.className='panel-row';
    const l=document.createElement('span'),r=document.createElement('strong');
    l.textContent=label;r.textContent=value;row.append(l,r);$('panel-body').append(row);
  }
  $('panel').hidden=false;$('close-panel').focus({preventScroll:true});
}
document.querySelectorAll('[data-node]').forEach(n=>n.addEventListener('click',()=>showPanel(n.dataset.node)));
function closePanel(){$('panel').hidden=true;if(lastNode)lastNode.focus({preventScroll:true});}
$('close-panel').addEventListener('click',closePanel);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
function clock(){const now=new Date();$('clock-mini').textContent=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});$('date-mini').textContent=now.toLocaleDateString('en-GB',{day:'numeric',month:'short'});}
clock();setInterval(clock,1000);
/* V0.2 camera. Identical in both entry points; no API or backend dependencies. */
(() => {
  'use strict';
  const viewport = document.querySelector('.world-viewport');
  const world = viewport.querySelector('.world-camera');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const points = {home:[1200,850],devices:[740,440],system:[540,860],data:[820,1280],updates:[1660,440],errors:[1860,860],settings:[1580,1280]};
  let x=1200, y=850, scale=innerWidth<700?.9:1, frame=0, animation=0;
  let gesture=null, suppressClick=false, current='home';
  const pointers=new Map();
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  const size=()=>({w:viewport.clientWidth,h:viewport.clientHeight});
  function paint() {
    frame=0;
    const {w,h}=size();
    if (!w || !h) return;
    x=clamp(x,300,2100); y=clamp(y,240,1460);
    world.style.transform=`translate(${w/2-x*scale}px,${h/2-y*scale}px) scale(${scale})`;
    viewport.querySelector('#zoom-level').textContent=Math.round(scale*100)+'%';
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
  function travel(name,animate=true){
    cancelAnimationFrame(animation);
    const point=points[name]; if(!point)return;
    current=name;
    viewport.querySelectorAll('[data-travel]').forEach(b=>{
      if(b.dataset.travel===name)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');
    });
    const sx=x,sy=y,start=performance.now();
    function step(now){
      const progress=animate&&!reducedMotion.matches?Math.min(1,(now-start)/450):1;
      const ease=1-Math.pow(1-progress,3);
      x=sx+(point[0]-sx)*ease;y=sy+(point[1]-sy)*ease;schedule();
      if(progress<1)animation=requestAnimationFrame(step);
    }
    animation=requestAnimationFrame(step);
  }
  function zoom(next,cx=size().w/2,cy=size().h/2){
    const {w,h}=size(),before=scale;
    scale=clamp(next,.6,1.4);
    x+=(cx-w/2)*(1/before-1/scale);y+=(cy-h/2)*(1/before-1/scale);schedule();
  }
  const isControl=target=>target.closest('.camera-controls,.world-nav');
  const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
  viewport.addEventListener('pointerdown',event=>{
    if(isControl(event.target)||event.button>0)return;
    cancelAnimationFrame(animation);
    // Clear a previous drag only when starting a new gesture, not at pointerup
    // (the synthetic click follows pointerup on touch screens).
    if(!pointers.size)suppressClick=false;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1)gesture={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY};
    else {gesture={distance:distance(),scale};suppressClick=true;}
    viewport.classList.add('dragging');
    // Capture on the original button so a tap still activates it.
    event.target.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>=2){
      const rect=viewport.getBoundingClientRect(),[a,b]=[...pointers.values()];
      if(gesture.distance>0)zoom(gesture.scale*distance()/gesture.distance,(a.x+b.x)/2-rect.left,(a.y+b.y)/2-rect.top);
    }else if(gesture){
      if(Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)>7)suppressClick=true;
      if(suppressClick){x-=(event.clientX-gesture.x)/scale;y-=(event.clientY-gesture.y)/scale;schedule();}
      gesture.x=event.clientX;gesture.y=event.clientY;
    }
  });
  function end(event){
    pointers.delete(event.pointerId);
    if(pointers.size===1){const p=[...pointers.values()][0];gesture={...p,startX:p.x,startY:p.y};}
    else if(!pointers.size){gesture=null;viewport.classList.remove('dragging');}
  }
  viewport.addEventListener('pointerup',end);
  viewport.addEventListener('pointercancel',event=>{suppressClick=true;end(event);});
  viewport.addEventListener('lostpointercapture',end);
  viewport.addEventListener('click',event=>{
    if(isControl(event.target))return;
    if(suppressClick){event.stopImmediatePropagation();event.preventDefault();return;}
    const node=event.target.closest('[data-node]');if(node)travel(node.dataset.node);
  },true);
  viewport.addEventListener('wheel',event=>{
    if(isControl(event.target))return;
    event.preventDefault();cancelAnimationFrame(animation);
    const rect=viewport.getBoundingClientRect();
    if(event.ctrlKey||event.metaKey)zoom(scale*Math.exp(-event.deltaY*.008),event.clientX-rect.left,event.clientY-rect.top);
    else{const unit=event.deltaMode===1?16:event.deltaMode===2?size().h:1;x+=event.deltaX*unit/scale;y+=event.deltaY*unit/scale;schedule();}
  },{passive:false});
  viewport.addEventListener('keydown',event=>{
    if(event.target.closest('button'))return;
    const keys={ArrowLeft:[-70,0],ArrowRight:[70,0],ArrowUp:[0,-70],ArrowDown:[0,70]};
    if(keys[event.key]){event.preventDefault();cancelAnimationFrame(animation);x+=keys[event.key][0]/scale;y+=keys[event.key][1]/scale;schedule();}
    if(event.key==='Home'){event.preventDefault();travel('home');}
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale+.1);}
    if(event.key==='-'){event.preventDefault();zoom(scale-.1);}
  });
  viewport.querySelectorAll('[data-travel]').forEach(b=>b.addEventListener('click',()=>{
    travel(b.dataset.travel);
    // Keyboard users can reach every island without navigating a huge canvas.
    const node=viewport.querySelector(`[data-node="${b.dataset.travel}"]`);
    node.focus({preventScroll:true});
  }));
  viewport.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>{
    const command=b.dataset.camera;
    if(command==='in')zoom(scale+.1);
    if(command==='out')zoom(scale-.1);
    if(command==='home'){scale=innerWidth<700?.9:1;travel('home');}
    if(command==='weather'){
      const enabled=viewport.querySelector('.environment').classList.toggle('rain');
      b.setAttribute('aria-pressed',String(enabled));
    }
  }));
  viewport.querySelectorAll('[data-node]').forEach(node=>node.addEventListener('focus',()=>{
    if(!pointers.size && node.matches(':focus-visible') && current!==node.dataset.node)travel(node.dataset.node);
  }));
  const observer=new ResizeObserver(schedule);observer.observe(viewport);
  function motion(){
    const paused=document.hidden||reducedMotion.matches||!viewport.clientWidth;
    viewport.classList.toggle('scene-paused',paused);
    const svg=viewport.querySelector('.world-branches');
    if(paused)svg.pauseAnimations();else svg.unpauseAnimations();
  }
  document.addEventListener('visibilitychange',motion);reducedMotion.addEventListener('change',motion);
  new ResizeObserver(motion).observe(viewport);
  window.addEventListener('blur',()=>{pointers.clear();gesture=null;viewport.classList.remove('dragging');});
  schedule();motion();
})();
