# Layout-check renderer for the Pipeline design sheet. Not a deliverable: Asset Maker makes the mocks.
import os, subprocess, json
HERE = os.path.dirname(os.path.abspath(__file__))
TOK = """
:root{--c-void:#04060f;--c-panel:#0a0e22;--c-raised:#0d1636;--c-stage:#081628;--c-line:#2a366a;--c-trace:#4e5360;
--c-ink:#e2eaff;--c-mute:#a6b4da;--c-accent:#3be3ff;--c-brand:#a68bff;--c-ok:#6dffa6;--c-warn:#ffc247;--c-bad:#ff5a78;
--t-xs:0.8rem;--t-sm:0.933rem;--t-md:1.2rem;--t-lg:1.6rem;--t-xl:2.133rem;--t-2xl:2.667rem;--t-display:5.333rem;--t-display-lg:6.667rem;
--s1:0.267rem;--s2:0.533rem;--s3:0.8rem;--s4:1.067rem;--s5:1.6rem;--s6:2.133rem;--h-row:3.2rem;--r1:0.267rem;--r2:0.4rem}
*{box-sizing:border-box} body{margin:0;position:relative;overflow:hidden;background:var(--c-void);font-family:'IBM Plex Sans';color:var(--c-ink);font-variant-numeric:tabular-nums}
.abs{position:absolute} .mono{font-family:'IBM Plex Mono';font-weight:500} .cond{font-family:'IBM Plex Sans Condensed';font-weight:600}
.xs{font-size:var(--t-xs);line-height:1.4} .sm{font-size:var(--t-sm);line-height:1.4} .md{font-size:var(--t-md);line-height:1.25} .lg{font-size:var(--t-lg);line-height:1.1}
.xl{font-size:var(--t-xl);line-height:1.1} .x2{font-size:var(--t-2xl);line-height:1} .ink{color:var(--c-ink)} .mute{color:var(--c-mute)} .warn{color:var(--c-warn)} .bad{color:var(--c-bad)} .ok{color:var(--c-ok)}
.w5{font-weight:500} .w6{font-weight:600}
.wm{font-family:'IBM Plex Sans Condensed';font-weight:600;text-transform:uppercase;line-height:.86}
.wm .l2{display:flex;align-items:flex-end;justify-content:space-between}
.cells{display:flex;gap:.4rem;margin-bottom:.6rem} .cells i{width:.933rem;height:.933rem;background:var(--c-trace);display:block} .cells i:first-child{background:var(--c-brand)}
.build{font:500 var(--t-xs) 'IBM Plex Mono';color:var(--c-mute);margin-top:var(--s4);text-transform:none}
/* rail */
.rail{position:absolute} .ri{display:flex;align-items:center;gap:var(--s5);min-height:var(--h-row);margin-top:var(--s2);position:relative}
.ri:first-child{margin-top:0}
.tag{flex:none;width:2.667rem;height:1.6rem;display:flex;align-items:center;justify-content:center;font:500 var(--t-xs) 'IBM Plex Mono';color:var(--c-mute)}
.tag.short:empty::after{content:'';width:.533rem;height:.533rem;background:var(--c-trace)}
.ri.sel .tag,.ri.focus .tag{background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)}
.ri.sel .tag.short,.ri.focus .tag.short{width:1.067rem;margin:0 .8rem}
.ri.sel .tag.short::after,.ri.focus .tag.short::after{display:none}
.ri.dis .tag{border:1px dashed var(--c-trace);border-radius:var(--r1);color:var(--c-mute)}
.ri.dis .tag.short::after{display:none}
.lab{font:600 var(--t-lg)/1 'IBM Plex Sans Condensed';color:var(--c-mute)}
.ri.sel .lab,.ri.focus .lab,.ri.hero .lab{color:var(--c-ink)}
.ri.hero .lab{font-size:var(--t-2xl)} .ri.hero{min-height:5.333rem}
.ri.sm{gap:var(--s3)} .ri.sm .lab{font:500 var(--t-sm)/1.2 'IBM Plex Sans'} .ri.md .lab{font:500 var(--t-md)/1.2 'IBM Plex Sans'}
.meta{font:500 var(--t-xs) 'IBM Plex Mono';color:var(--c-mute)} .sub{display:block;font:400 var(--t-sm)/1.4 'IBM Plex Sans';color:var(--c-mute);margin-top:var(--s1)}
/* segmented */
.seg{display:flex;align-items:center;gap:1.067rem;min-height:var(--h-row)} .opt{font:500 var(--t-sm) 'IBM Plex Sans';color:var(--c-mute);padding:0 var(--s3);height:2.133rem;display:flex;align-items:center;border-radius:var(--r1);position:relative}
.opt.on{background:var(--c-accent);color:var(--c-void)} .opt.fx{outline:1px solid var(--c-accent);outline-offset:-1px;color:var(--c-ink)}
.opt+.opt::before{content:'';position:absolute;left:calc(-1.067rem + 4px);width:calc(1.067rem - 8px);top:50%;height:2px;margin-top:-1px;background:var(--c-trace)}
/* slider */
.sl{display:flex;align-items:center;gap:var(--s3);min-height:var(--h-row)} .sl .tr{position:relative;flex:1;height:2px;background:var(--c-trace)} .sl .tr i{position:absolute;left:0;top:0;height:2px;background:var(--c-accent)}
.sl .tr b{position:absolute;top:-11px;width:.8rem;height:1.6rem;margin-left:-.4rem;background:var(--c-accent);border-radius:var(--r1)} .sl .v{width:3.2rem;text-align:right}
.btn{display:inline-flex;align-items:center;height:var(--h-row);font:600 var(--t-md) 'IBM Plex Sans';padding:0 var(--s5);border-radius:var(--r1)}
.btn.p{background:var(--c-accent);color:var(--c-void)} .btn.t{color:var(--c-mute);font:500 var(--t-sm) 'IBM Plex Sans';padding:0 var(--s3)}
.back{display:flex;align-items:center;gap:var(--s3);height:var(--h-row);font:500 var(--t-sm) 'IBM Plex Sans';color:var(--c-mute)}
.sheet{position:absolute;background:rgba(10,14,34,.94)} .plate{position:absolute;background:rgba(10,14,34,.94);border-radius:var(--r2)}
.row{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);min-height:var(--h-row)}
.lbl{font:500 var(--t-sm)/1.3 'IBM Plex Sans';color:var(--c-ink)} .help{font:400 var(--t-xs)/1.4 'IBM Plex Sans';color:var(--c-mute)}
.sec{font:600 var(--t-md)/1.2 'IBM Plex Sans Condensed';color:var(--c-ink)}
"""
TRACE_JS = """<script>
const R=e=>e.getBoundingClientRect(); const G=8, CH=24;
let out='';
const seg=(d,c)=>{out+=`<path d="${d}" stroke="${c}" stroke-width="2" fill="none"/>`};
document.querySelectorAll('.rail').forEach(rail=>{
  const items=[...rail.querySelectorAll(':scope > .ri')]; if(!items.length) return;
  const tags=items.map(i=>R(i.querySelector('.tag')));
  const bx=tags[0].left+tags[0].width/2;
  const fi=items.findIndex(i=>i.classList.contains('focus')||i.classList.contains('sel'));
  const lit = rail.dataset.lit!=='off' && fi>=0;
  const srcSel=rail.dataset.src; let start;
  if(srcSel){ const s=R(document.querySelector(srcSel)); const sx=s.left+s.width/2; const y1=+rail.dataset.y1||(s.bottom+16);
     let d;
     if(Math.abs(sx-bx)<6) d=`M${bx} ${s.bottom} V${tags[0].top-G}`;
     else { const dir=sx>bx?-1:1; d=`M${sx} ${s.bottom} V${y1-CH} L${sx+dir*CH} ${y1} H${bx-dir*CH} L${bx} ${y1+CH} V${tags[0].top-G}`; }
     seg(d, lit?'#3be3ff':'#4e5360');
  } else if(rail.dataset.via!=='off'){
     const vy=tags[0].top-G-20; out+=`<rect x="${bx-3}" y="${vy-3}" width="6" height="6" fill="${lit?'#3be3ff':'#4e5360'}"/>`;
     seg(`M${bx} ${vy} V${tags[0].top-G}`, lit?'#3be3ff':'#4e5360');
  }
  for(let i=0;i<tags.length-1;i++) seg(`M${bx} ${tags[i].bottom+G} V${tags[i+1].top-G}`, (lit&&i<fi)?'#3be3ff':'#4e5360');
});
document.querySelectorAll('[data-wire]').forEach(w=>{ // free 45-degree wire: data-wire="fromSel|toSel|lit"
  const [a,b,c,anc]=w.dataset.wire.split('|'); const A=R(document.querySelector(a)), B=R(document.querySelector(b));
  const ax=A.left+A.width/2, ay=A.bottom, by=B.top; let bx=B.left+B.width/2; if(anc==='L') bx=ax; const my=(ay+by)/2; const dx=bx-ax; const ch=Math.min(CH,Math.abs(dx)/2);
  const s=Math.sign(dx)||1; seg(`M${ax} ${ay+G} V${my-ch} L${ax+s*ch} ${my} H${bx-s*ch} L${bx} ${my+ch} V${by-G}`, c==='lit'?'#3be3ff':'#4e5360');
});
const svg=document.getElementById('tr'); svg.innerHTML=out;
</script>"""
def page(size, body, bg=None, scrim=None, bgcolor=None):
    ph = size=='phone'; W,H=(530,1080) if ph else (1920,1080); rem=15 if ph else 16.2
    bgcss = f"background:{bgcolor or '#04060f'}" + (f" url('{HERE}/{bg}') center/cover" if bg else '')
    sc = ''
    if scrim=='menu':
        sc = ("linear-gradient(180deg, rgba(4,6,15,0) 400px, rgba(4,6,15,.88) 580px)" if ph else
              "linear-gradient(90deg, rgba(4,6,15,.88) 0, rgba(4,6,15,.88) 580px, rgba(4,6,15,0) 820px)")
    elif scrim=='wide':
        sc = ("linear-gradient(180deg, rgba(4,6,15,0) 140px, rgba(4,6,15,.88) 300px)" if ph else
              "linear-gradient(90deg, rgba(4,6,15,.88) 0, rgba(4,6,15,.88) 760px, rgba(4,6,15,0) 1000px)")
    elif scrim: sc=scrim
    return f"""<html><head><meta charset="utf-8"><style>html{{font-size:{rem}px}} {TOK} body{{width:{W}px;height:{H}px;{bgcss}}}
    .scrim{{position:absolute;inset:0;background:{sc or 'none'}}}</style></head><body><div class="scrim"></div>{body}
    <svg id="tr" width="{W}" height="{H}" style="position:absolute;left:0;top:0;pointer-events:none"></svg>{TRACE_JS}</body></html>"""
def render(name, size, html):
    W,H=(530,1080) if size=='phone' else (1920,1080)
    p=f'{HERE}/out/{name}-{size}.html'; os.makedirs(f'{HERE}/out',exist_ok=True); open(p,'w').write(html)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--virtual-time-budget=4000',
        f'--window-size={W},{H}',f'--screenshot={HERE}/out/{name}-{size}.png',f'file://{p}'],capture_output=True)
