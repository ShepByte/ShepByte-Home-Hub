const $=id=>document.getElementById(id);
const panels={
  devices:[['Status','No devices paired'],['Online','0'],['Offline','0']],
  system:[['Hub status','Healthy'],['Frontend','Loaded'],['Mode','Prototype']],
  data:[['Stored events','0'],['Live data','Transient'],['History','Ready']],
  updates:[['Home Hub','v0.1 prototype'],['Updates','None pending']],
  errors:[['Active','0'],['Warnings','0'],['Acknowledged','0']],
  settings:[['Theme','Dark'],['Environment','Subtle'],['Motion','Enabled']]
};
function setClock(){
  const now=new Date();
  const mini=$('clock-mini'),date=$('date-mini');
  if(mini)mini.textContent=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  if(date)date.textContent=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}
function showPanel(name){
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('selected',n.dataset.node===name));
  if(name==='home'){ $('panel').hidden=true; return; }
  $('panel-title').textContent=name.charAt(0).toUpperCase()+name.slice(1);
  const body=$('panel-body'); body.replaceChildren();
  for(const [k,v] of panels[name]||[]){
    const row=document.createElement('div'); row.className='panel-row';
    const left=document.createElement('span'); left.textContent=k;
    const right=document.createElement('strong'); right.textContent=v;
    row.append(left,right); body.append(row);
  }
  if(name==='devices'){
    const btn=document.createElement('button');
    btn.textContent='Open Devices';
    btn.style.cssText='width:100%;margin-top:14px;padding:11px;border:0;border-radius:10px;background:#1676d2;color:white';
    btn.onclick=()=>{$('home-screen').classList.remove('active');$('devices-screen').classList.add('active');};
    body.append(btn);
  }
  $('panel').hidden=false;
}
document.querySelectorAll('.node').forEach(node=>node.addEventListener('click',()=>showPanel(node.dataset.node)));
$('close-panel').addEventListener('click',()=>showPanel('home'));
$('back-home').addEventListener('click',()=>{$('devices-screen').classList.remove('active');$('home-screen').classList.add('active');showPanel('home');});
setClock();setInterval(setClock,1000);