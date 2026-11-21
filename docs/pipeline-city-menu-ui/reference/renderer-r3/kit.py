# r2 renderer helpers: display titles, horizontal rails, branches, ornament kit. Layout checks only.
import os, subprocess
from base import page as _page, HERE, TRACE_JS
P='phone'; D='desktop'
EXTRA_CSS = """
.dt{font-family:'IBM Plex Sans Condensed';font-weight:600;text-transform:uppercase;line-height:.86;color:var(--c-ink);white-space:nowrap}
.dt .ln{display:flex;align-items:flex-end;gap:1.067rem}
.dt .cells{margin-bottom:.6rem}
.cells i.lit{background:var(--c-accent)} .cells i.done{background:var(--c-ink)}
.dmeta{font:500 var(--t-xs) 'IBM Plex Mono';color:var(--c-mute);margin-top:var(--s4);text-transform:none;white-space:nowrap}
.hrail{position:absolute;display:flex;align-items:center}
.hi{display:flex;align-items:center;min-height:3.2rem;color:var(--c-mute);position:relative}
.hi.sel{color:var(--c-ink)}
.hi.chip{background:var(--c-accent);color:var(--c-void);border-radius:var(--r1);min-height:2.133rem;padding:0 var(--s3)}
.bv{font:600 var(--t-xl)/1 'IBM Plex Sans Condensed'} .bv.lg{font-size:var(--t-lg)} .bv.md{font-size:var(--t-md)}
.silk{font:500 11px/1 'IBM Plex Mono';color:var(--c-mute);letter-spacing:.04em;position:absolute;white-space:nowrap}
.orn{position:absolute;pointer-events:none}
.code{font:500 var(--t-xs) 'IBM Plex Mono'}
"""
# --- ornament kit (all 1px, #4e5360 unless lit) ---
NOORN = os.environ.get('NOORN')=='1'
def bracket(x,y,w,h,arm=16,pin1=False,c='#4e5360'):
    if NOORN: return ''
    s=f'<svg class="orn" style="left:{x}px;top:{y}px" width="{w}" height="{h}"><g stroke="{c}" stroke-width="1" fill="none">'
    s+=f'<path d="M0.5 {arm} V0.5 H{arm}"/><path d="M{w-arm} 0.5 H{w-.5} V{arm}"/><path d="M0.5 {h-arm} V{h-.5} H{arm}"/><path d="M{w-arm} {h-.5} H{w-.5} V{h-arm}"/></g>'
    if pin1: s+=f'<rect x="4" y="4" width="4" height="4" fill="{c}"/>'
    return s+'</svg>'
def silk(x,y,t,anchor='left'):
    if NOORN: return ''
    return f'<span class="silk" style="{anchor}:{x}px;top:{y}px">{t}</span>'
def pinrow(x,y,n,key=None,vertical=False):
    if NOORN: return ''
    s=''.join(f'<rect x="{0 if vertical else i*8}" y="{i*8 if vertical else 0}" width="4" height="4" fill="#4e5360"/>' for i in range(n) if i!=key)
    w,h=(4,n*8-4) if vertical else (n*8-4,4)
    return f'<svg class="orn" style="left:{x}px;top:{y}px" width="{w}" height="{h}">{s}</svg>'
def notch(x,y,w,at=None,depth=4,nw=24):
    at = at if at is not None else w-nw-24
    d=f'M0 0.5 H{at} L{at+depth} {depth+.5} H{at+nw-depth} L{at+nw} 0.5 H{w}'
    return f'<svg class="orn" style="left:{x}px;top:{y}px" width="{w}" height="{depth+2}"><path d="{d}" stroke="#4e5360" stroke-width="1" fill="none"/></svg>'
def testpoint(x,y,label=None):
    s=f'<svg class="orn" style="left:{x-5}px;top:{y-5}px" width="10" height="10"><circle cx="5" cy="5" r="4" stroke="#4e5360" stroke-width="1" fill="none"/></svg>'
    return s+(silk(x+10,y-5,label) if label else '')
def bus(x,y,length,n=3,vertical=True,turn=None):
    p=''
    for i in range(n):
        o=i*4+.5
        if vertical: p+=f'<path d="M{o} 0 V{length}"/>'
        else: p+=f'<path d="M0 {o} H{length}"/>'
    w,h=((n-1)*4+1,length) if vertical else (length,(n-1)*4+1)
    return f'<svg class="orn" style="left:{x}px;top:{y}px" width="{w}" height="{h}"><g stroke="#4e5360" stroke-width="1">{p}</g></svg>'
def ruler(x,y,length,step=8,major=40,up=False,lit_to=None):
    if NOORN: return ''
    t=''
    for i in range(0,length+1,step):
        hgt=8 if i%major==0 else 4
        c='#3be3ff' if (lit_to is not None and i<=lit_to) else '#4e5360'
        t+=f'<path d="M{i+.5} {0 if not up else 8-hgt} V{hgt if not up else 8}" stroke="{c}"/>'
    return f'<svg class="orn" style="left:{x}px;top:{y}px" width="{length+1}" height="8"><g stroke-width="1">{t}</g></svg>'
def chamfer_clip(c=12, corner='tr'):
    pts={'tr':f'polygon(0 0, calc(100% - {c}px) 0, 100% {c}px, 100% 100%, 0 100%)',
         'tl':f'polygon({c}px 0, 100% 0, 100% 100%, 0 100%, 0 {c}px)',
         'br':f'polygon(0 0, 100% 0, 100% calc(100% - {c}px), calc(100% - {c}px) 100%, 0 100%)',
         'bl':f'polygon(0 0, 100% 0, 100% 100%, {c}px 100%, 0 calc(100% - {c}px))'}[corner]
    return f'clip-path:{pts};'
# --- structures ---
def dtitle(s, lines, cell=None, meta='', x=None, top=None, size=None, cid='src', cells=True, done=0):
    ph = s==P; x = x if x is not None else (24 if ph else 96); top = top if top is not None else (112)
    fs = size or ('5.333rem' if ph else '6.667rem')
    def strip():
        out='<span class="cells">'
        for i in range(5):
            cls=[]; 
            if i==cell: cls.append('lit')
            elif 0<i<=done: cls.append('done')
            idattr = f' id="{cid}"' if i==(cell if cell is not None else 0) else ''
            out+=f'<i class="{" ".join(cls)}"{idattr}></i>'
        return out+'</span>'
    html=f'<div class="abs dt" style="left:{x}px;top:{top}px;font-size:{fs}">'
    for i,l in enumerate(lines):
        last = i==len(lines)-1
        html+=f'<div class="ln"><span>{l}</span>{strip() if (last and cells) else ""}</div>'
    html+=f'<div class="dmeta" id="{cid}m">{meta}</div></div>'
    return html
TRACE2 = TRACE_JS.replace("const y1=+rail.dataset.y1||(s.bottom+16);",
 "let y1=s.bottom+16; if(rail.dataset.y1){ y1 = rail.dataset.y1[0]=='#' ? R(document.querySelector(rail.dataset.y1)).bottom+16 : +rail.dataset.y1; }")
HJS = """<script>
(function(){const R=e=>e.getBoundingClientRect(),G=8,CH=24;let out='';const seg=(d,c)=>{out+=`<path d="${d}" stroke="${c}" stroke-width="2" fill="none"/>`};
document.querySelectorAll('.hrail').forEach(r=>{const it=[...r.querySelectorAll(':scope > .hi')]; if(!it.length) return;
 const bs=it.map(R); const y=bs[0].top+bs[0].height/2; const si=it.findIndex(i=>i.classList.contains('sel')||i.classList.contains('chip'));
 const lit=r.dataset.lit==='on'; const C=(i)=> (lit && i<si)?'#3be3ff':'#4e5360';
 if(r.dataset.from){ const f=R(document.querySelector(r.dataset.from)); seg(`M${f.right+G} ${y} H${bs[0].left-G}`, lit&&si>=0?'#3be3ff':'#4e5360'); }
 else if(r.dataset.src){ const s=R(document.querySelector(r.dataset.src)); const sx=s.left+s.width/2; const sy=s.bottom;
   if(Math.abs(sx-bs[0].left)<2) seg(`M${sx} ${sy+G} V${bs[0].top-G}`,lit?'#3be3ff':'#4e5360');
   else { const dr=Math.sign(bs[0].left-sx)||1; seg(`M${sx} ${sy+G} V${y-CH} L${sx+dr*CH} ${y} H${dr>0?bs[0].left-G:bs[0].left-G}`, lit&&si>=0?'#3be3ff':'#4e5360'); } }
 else if(r.dataset.lead){ seg(`M${bs[0].left-G-(+r.dataset.lead)} ${y} H${bs[0].left-G}`,'#4e5360'); }
 for(let i=0;i<bs.length-1;i++) seg(`M${bs[i].right+G} ${y} H${bs[i+1].left-G}`, C(i+1));
 if(r.dataset.tail) seg(`M${bs[bs.length-1].right+G} ${y} H${bs[bs.length-1].right+G+(+r.dataset.tail)}`,'#4e5360');
});
document.querySelectorAll('[data-hwire]').forEach(w=>{ // from right edge of A, horizontal, 45 down/up into top/bottom of B
 const [a,b,c]=w.dataset.hwire.split('|'); const A=R(document.querySelector(a)),B=R(document.querySelector(b));
 const ay=A.top+A.height/2, bx=B.left+B.width/2; const down=B.top>ay; const by=down?B.top-G:B.bottom+G;
 const dy=Math.abs(by-ay); const ch=Math.min(CH,dy);
 seg(`M${A.right+G} ${ay} H${bx-ch} L${bx} ${ay+(down?ch:-ch)} V${by}`, c==='lit'?'#3be3ff':'#4e5360'); });
document.querySelectorAll('[data-lwire]').forEach(w=>{ const [a,m,b,xm,c]=w.dataset.lwire.split('|'); const A=R(document.querySelector(a)),M=R(document.querySelector(m)),B=R(document.querySelector(b));
 const sx=A.left+A.width/2, ym=M.bottom+12, X=+xm, ty=B.top+B.height/2;
 seg(`M${sx} ${A.bottom+G} V${ym-CH} L${sx-CH} ${ym} H${X+CH} L${X} ${ym+CH} V${ty-CH} L${X+CH} ${ty} H${B.left-G}`, c==='lit'?'#3be3ff':'#4e5360'); });
document.querySelectorAll('.rail[data-tp]').forEach(r=>{const it=[...r.querySelectorAll(':scope > .ri')]; if(!it.length) return; const t=R(it[it.length-1].querySelector('.tag')); const x=t.left+t.width/2, y0=t.bottom+G, y1=y0+20;
 seg(`M${x} ${y0} V${y1}`,'#4e5360'); out+=`<circle cx="${x}" cy="${y1+4}" r="4" stroke="#4e5360" stroke-width="1" fill="none"/><text x="${x+9}" y="${y1+8}" font-family="IBM Plex Mono" font-weight="500" font-size="11" fill="#a6b4da">${r.dataset.tp}</text>`;});
document.getElementById('tr').insertAdjacentHTML('beforeend',out);})();
</script>"""
def page2(s, body, bg=None, scrim=None, bgcolor=None, scrim2=None):
    h=_page(s, body, bg=bg, scrim=scrim, bgcolor=bgcolor)
    h=h.replace(TRACE_JS, TRACE2+HJS).replace('</style>', EXTRA_CSS+'</style>',1)
    if scrim2: h=h.replace('<div class="scrim"></div>', f'<div class="scrim"></div><div class="scrim" style="background:{scrim2}"></div>',1)
    return h
def render2(name, s, html, outdir='out2'):
    W,H=(530,1080) if s==P else (1920,1080)
    d=f'{HERE}/{outdir}'; os.makedirs(d,exist_ok=True); p=f'{d}/{name}-{s}.html'; open(p,'w').write(html)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--virtual-time-budget=4000',
        f'--window-size={W},{H}',f'--screenshot={d}/{name}-{s}.png',f'file://{p}'],capture_output=True)
EXTRA_CSS += """
.tab{flex-direction:column;align-items:center;min-height:0;gap:6px}
.tab .tg{width:2.667rem;height:1.6rem;display:flex;align-items:center;justify-content:center;font:500 var(--t-xs) 'IBM Plex Mono';color:var(--c-mute)}
.tab .tl{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);font:600 var(--t-lg)/1 'IBM Plex Sans Condensed';color:var(--c-mute);white-space:nowrap}
.tab .tl.sm{font-size:var(--t-md)} .tab.sel .tg{background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)} .tab.sel .tl{color:var(--c-ink)}
"""
