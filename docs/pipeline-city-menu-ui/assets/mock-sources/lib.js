// r2 in-page geometry + trace lib. All trace geometry is computed from live boxes after fonts load.
const AC='#3be3ff', GR='#4e5360', GAP=8, CH=24;
const $=id=>{const e=document.getElementById(id); if(!e) throw new Error('missing #'+id); return e;};
const R=id=>$(id).getBoundingClientRect();
const ctr=r=>(r.top+r.bottom)/2, cx=r=>(r.left+r.right)/2;
const SEGS=[], SKIP=[], BOX=[], OKC=[], OKV=[], IMG=[], DASH=[];
function poly(pts,col,kind){ pts=pts.map(p=>[Math.round(p[0]*2)/2,Math.round(p[1]*2)/2]); SEGS.push({pts,col,kind:kind||'trace'}); }
// strip: 5 cells after the last word of a display title, bottom 10px above the last line's baseline
function strip(tid, n, cell, gap, lit, done, gapAfter, alignRight){
  const t=$(tid); const lines=t.querySelectorAll('.ln'); const last=lines[lines.length-1].querySelector('.lt');
  const rg=document.createRange(); rg.selectNodeContents(last); const rr=rg.getBoundingClientRect();
  const base=R(tid+'_bl').top; const bot=base-10;
  let x1 = alignRight!=null ? alignRight-5*cell-4*gap : rr.right+gapAfter;
  const s=$(tid+'_s');
  for(let i=0;i<5;i++){ const c=document.createElement('div'); c.className='a'; c.id=tid+'_c'+i;
    const col = i==0?'#a68bff':(i==lit?AC:(i>0&&i<=done?'#e2eaff':GR));
    c.style.cssText=`left:${x1+i*(cell+gap)}px;top:${bot-cell}px;width:${cell}px;height:${cell}px;background:${col}`; s.appendChild(c);
    if(i==lit) OKC.push(rr2(c)); if(i==0) OKV.push(rr2(c)); }
  return {x1, bot};
}
function rr2(e){const r=e.getBoundingClientRect(); return [r.left,r.top,r.width,r.height];}
// place title meta 16px under the title's line box
function metaUnder(tid, mid, dy){ const t=$(tid); const lines=t.querySelectorAll('.ln'); const lb=lines[lines.length-1].getBoundingClientRect().bottom; $(mid).style.top=(lb+(dy==null?16:dy))+'px'; }
// centre a cell on a label's line box
function centreOn(cid, lid){ const c=$(cid); const h=c.getBoundingClientRect().height; c.style.top=(ctr(R(lid))-h/2)+'px'; }
// title drop: lit cell -> 16px under meta -> 45deg -> column -> endY
function drop(cellId, metaId, colX, endY, col, yh){ col=col||AC;
  const c=R(cellId); const x=Math.floor(cx(c)); const y0=Math.round(c.bottom); if(yh==null) yh=Math.round(R(metaId).bottom+16);
  if(Math.abs(x-colX)<6){ poly([[colX,y0],[colX,endY]],col); return; }
  const d=Math.sign(colX-x);
  poly([[x,y0],[x,yh-CH],[x+d*CH,yh],[colX-d*CH,yh],[colX,yh+CH],[colX,Math.round(endY)]],col);
}
// vertical bus between consecutive boxes (ids), first litN segments lit
function vbus(colX, ids, litN, start){
  const rs=ids.map(R); let segs=[];
  if(start!=null){ segs.push([start, rs[0].top-GAP]); }
  for(let i=0;i<rs.length-1;i++) segs.push([rs[i].bottom+GAP, rs[i+1].top-GAP]);
  segs.forEach((s,i)=>{ const y0=Math.round(s[0]), y1=Math.round(s[1]); if(y1-y0<8){SKIP.push({colX,y0,y1}); return;} poly([[colX,y0],[colX,y1]], i<litN?AC:GR); });
}
function hbus(y, ids, litN, lead){
  const rs=ids.map(R); y=Math.round(y);
  if(lead) poly([[Math.round(rs[0].left-GAP-lead),y],[Math.round(rs[0].left-GAP),y]],GR);
  for(let i=0;i<rs.length-1;i++){ const x0=Math.round(rs[i].right+GAP), x1=Math.round(rs[i+1].left-GAP); if(x1-x0<8){SKIP.push({y,x0,x1});continue;} poly([[x0,y],[x1,y]], i<litN?AC:GR); }
}
function hlink(y, fromId, toId, col){ const a=R(fromId), b=R(toId); poly([[Math.round(a.right+GAP),Math.round(y)],[Math.round(b.left-GAP),Math.round(y)]],col); }
// test point: 20px stub under the last box, ring r4, silk label right of it
function tp(colX, lastId, label){
  const b=R(lastId); const y0=Math.round(b.bottom+GAP), y1=y0+20; poly([[colX,y0],[colX,y1]],GR);
  const sv=$('orn'); const ns='http://www.w3.org/2000/svg'; const c=document.createElementNS(ns,'circle');
  c.setAttribute('cx',colX); c.setAttribute('cy',y1+4); c.setAttribute('r',4); c.setAttribute('stroke',GR); c.setAttribute('stroke-width',1); c.setAttribute('fill','none'); sv.appendChild(c);
  const s=$(label.id); s.style.left=(colX+10)+'px'; s.style.top=(y1+4-s.getBoundingClientRect().height/2)+'px';
  return {y1};
}
function box(ab, rects){ let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; rects.forEach(r=>{x0=Math.min(x0,r.left);y0=Math.min(y0,r.top);x1=Math.max(x1,r.right);y1=Math.max(y1,r.bottom);}); BOX.push({ab,x:x0,y:y0,w:x1-x0,h:y1-y0}); }
function boxIds(ab, ids){ box(ab, ids.map(R)); }
function textRects(){
  const out=[];
  document.querySelectorAll('.t').forEach(e=>{ const rg=document.createRange(); rg.selectNodeContents(e);
    for(const r of rg.getClientRects()) if(r.width>0.5) out.push({n:e.dataset.n||e.id||e.textContent.slice(0,24), col:e.dataset.c, on:e.dataset.on||null, txt:e.textContent, x0:r.left,y0:r.top,x1:r.right,y1:r.bottom}); });
  return out;
}
function finish(){
  const sv=$('tr');
  for(const s of SEGS){ const p=document.createElementNS('http://www.w3.org/2000/svg','polyline'); p.setAttribute('points',s.pts.map(q=>q.join(',')).join(' '));
    p.setAttribute('fill','none'); p.setAttribute('stroke',s.col); p.setAttribute('stroke-width','2'); p.setAttribute('stroke-linejoin','miter'); p.setAttribute('stroke-miterlimit','10'); p.setAttribute('stroke-linecap','butt'); sv.appendChild(p); }
  document.querySelectorAll('.chip,.okc').forEach(e=>OKC.push(rr2(e)));
  document.querySelectorAll('img').forEach(e=>IMG.push(rr2(e)));
  document.querySelectorAll('[data-ab]').forEach(e=>{const r=e.getBoundingClientRect(); BOX.push({ab:e.dataset.ab,x:r.left,y:r.top,w:r.width,h:r.height});});
  const silk=[...document.querySelectorAll('.silk')].map(e=>e.textContent);
  window.__geo={segs:SEGS,skip:SKIP,boxes:BOX,okc:OKC,okv:OKV,imgs:IMG,txt:textRects(),silk,orn:[...document.querySelectorAll('#orn > *')].length};
}
