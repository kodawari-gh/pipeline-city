# r3 in-game renderer: the game is the subject, UI is a thin overlay at the edges. Layout checks only, not mocks.
import sys, os
sys.path.insert(0,'/workspace/menu-review/v2/sheet')
from base import TOK, TRACE_JS
from kit import EXTRA_CSS, TRACE2, HJS, dtitle, bracket, silk, pinrow, ruler, P, D
import subprocess
SH='/workspace/menu-review/shots/'; IMG='/workspace/menu-review/v2/sheet/'
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out3')
SHADE='10,10,12'; A=.86      # proposed --c-shade #0a0a0c; 86 % keeps every palette colour at 4.5:1 or more even over pure white
STUDIO='#111113'             # proposed --c-studio
CSS3 = """
.bk{position:absolute;background:rgba(%s,%s)}
.ramp{position:absolute;inset:0}
.cy{color:var(--c-accent)}
.hi.sm{font:500 var(--t-sm) 'IBM Plex Sans'} .hi.md{font:600 var(--t-md) 'IBM Plex Sans Condensed'}
.hi.via{min-height:0;width:6px;height:6px;background:var(--c-trace)}
.key{font:500 var(--t-md) 'IBM Plex Mono';color:var(--c-ink);width:8.2rem;flex:none}
.kr{display:flex;align-items:baseline;min-height:2.7rem}
.gc{display:inline-flex;gap:5px;vertical-align:middle} .gc i{width:11px;height:11px;background:var(--c-trace);display:block}
.dt.sm .dmeta{margin-top:var(--s3)}
.noui .ui{visibility:hidden}
""" % (SHADE, A)
def ch(c=14, corners=''):
    pts={'tl':(f'{c}px 0',None),'tr':None}
    # build polygon clockwise with optional chamfers on tl,tr,br,bl
    p=[]
    p += [f'0 {c}px', f'{c}px 0'] if 'tl' in corners else ['0 0']
    p += [f'calc(100% - {c}px) 0', f'100% {c}px'] if 'tr' in corners else ['100% 0']
    p += [f'100% calc(100% - {c}px)', f'calc(100% - {c}px) 100%'] if 'br' in corners else ['100% 100%']
    p += [f'{c}px 100%', f'0 calc(100% - {c}px)'] if 'bl' in corners else ['0 100%']
    return f"clip-path:polygon({', '.join(p)});"
def bk(x,y,w,h,corners='',c=14): return f'<div class="bk ui" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;{ch(c,corners) if corners else ""}"></div>'
def ramp(css): return f'<div class="ramp ui" style="background:{css}"></div>'
def sh(a): return f'rgba({SHADE},{a})'

def page3(s, body, bg=None, bgcolor='#0a0a0c', bgpos='center/cover', noui=False):
    ph=s==P; W,H=(530,1080) if ph else (1920,1080); rem=15 if ph else 16.2
    bgcss=f"background:{bgcolor}" + (f" url('{bg}') {bgpos} no-repeat" if bg else '')
    return f"""<html><head><meta charset="utf-8"><style>html{{font-size:{rem}px}} {TOK} {EXTRA_CSS} {CSS3}
    body{{width:{W}px;height:{H}px;{bgcss}}}</style></head><body class="{'noui' if noui else ''}">{body}
    <svg id="tr" class="ui" width="{W}" height="{H}" style="position:absolute;left:0;top:0;pointer-events:none"></svg>{TRACE2}{HJS}</body></html>"""
def render3(name, s, html, tag=''):
    W,H=(530,1080) if s==P else (1920,1080); os.makedirs(OUT,exist_ok=True)
    p=f'{OUT}/{name}-{s}{tag}.html'; open(p,'w').write(html)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--virtual-time-budget=4000',
        f'--window-size={W},{H}',f'--screenshot={OUT}/{name}-{s}{tag}.png',f'file://{p}'],capture_output=True)

# ---------------- shared HUD pieces ----------------
def speed(s, state='1x'):
    ph=s==P; opts=['Pause','1x'] if ph else ['Pause','0.25x','0.5x','1x','2x','3x']
    it=''.join(f'<div class="hi sm" style="{"color:var(--c-ink);font-weight:600" if o==state else ""}">{o}</div>' for o in opts)
    return it
def hud_top(s, paused=False, staged=False, toast=False):
    ph=s==P; b=''
    if not ph:
        # top-left tab: money + one Mono meta line (+ toast line)
        h=112 if toast else 84
        b+=bk(0,0,420,h,'br')
        b+='<div class="abs cond xl ink ui" style="left:32px;top:12px">$600</div>'
        if not staged: b+='<div class="abs meta ui" style="left:32px;top:54px">2 s · rep 1.00 · power $0 · machine off</div>'
        if toast: b+='<div class="abs mono xs ui" style="left:32px;top:80px"><span class="ok">[ ok ]</span> <span class="ink">Saved.</span>  <span class="mute">Dismiss</span></div>'
        if not staged:
            b+=bk(770,0,380,72,'bl br')
            b+='<div class="abs ui" style="left:770px;width:380px;top:10px;text-align:center"><div class="cond md ink">Level 1 · Garage Bench</div><div class="meta" style="margin-top:6px"><span class="gc"><i></i><i></i><i></i></span>  0 / 3 goals</div></div>'
        w=660 if not staged else 150
        b+=bk(1920-w,0,w,64,'bl')
        if not staged:
            b+=f'<div class="hrail ui" style="left:{1920-w+28}px;top:6px;gap:26px">{speed(s,"Pause" if paused else "1x")}<div class="hi via"></div><div class="hi sm">Zoom slow <span class="meta" style="margin-left:6px">ON</span></div></div>'
        b+=f'<div class="abs cond md ui {"ink" if paused else "mute"}" style="right:32px;top:18px">Menu</div>'
    else:
        h=96 if not staged else 52
        b+=bk(0,0,530,h)
        b+='<div class="abs cond lg ink ui" style="left:16px;top:12px">$600</div>'
        if not staged:
            b+='<div class="abs meta ui" style="left:88px;top:20px">2 s · rep 1.00</div>'
            b+=f'<div class="hrail ui" style="left:300px;top:0px;gap:14px">{speed(s,"Pause" if paused else "1x")}</div>'
            b+='<div class="abs ui" style="left:16px;top:58px"><span class="cond md ink">Level 1 · Garage Bench</span>   <span class="meta"><span class="gc"><i></i><i></i><i></i></span>  0 / 3</span></div>'
        b+=f'<div class="abs cond md ui {"ink" if paused else "mute"}" style="right:16px;top:14px">Menu</div>'
        if toast:
            b+=bk(0,96,290,34,'br',10)+'<div class="abs mono xs ui" style="left:16px;top:104px"><span class="ok">[ ok ]</span> <span class="ink">Saved.</span>  <span class="mute">Dismiss</span></div>'
    return b
def dock(s, only=None):
    ph=s==P
    if only:
        items=[('Inventory 1','inv')]
    else:
        items=[('Inventory 1','inv'),('Shop',''),('|',''),('Power',''),('Airflow',''),('|',''),('Almanac',''),('Job log','')] if not ph else \
              [('Inventory 1','inv'),('Shop',''),('|',''),('Lens',''),('|',''),('Almanac',''),('Log','')]
    it=''.join('<div class="hi via"></div>' if n=='|' else f'<div class="hi md" {"id=\"inv\"" if i else ""}>{n}</div>' for n,i in items)
    if not ph:
        w=150 if only else 860; x=(1920-w)//2
        b=bk(x,1024,w,56,'tl tr')+f'<div class="hrail ui" style="left:{x}px;width:{w}px;justify-content:center;top:1026px;gap:26px">{it}</div>'
        if not only: b+=silk(x+18,1062,'J1')
        return b
    w=530 if not only else 150
    return bk(0,1016,w,64,'' if not only else 'tr')+f'<div class="hrail ui" style="left:16px;top:1024px;gap:14px">{it}</div>'

# ---------------- 12 HUD ----------------
def hud(s): return hud_top(s, toast=True)+dock(s)

# ---------------- 10 Paused / 09 Controls: shared pause frame ----------------
def pause_frame(s):
    ph=s==P
    if ph: return ramp(f"linear-gradient(180deg, {sh(0)} 470px, {sh(A)} 536px)")+hud_top(s,paused=True)
    return ramp(f"linear-gradient(90deg, {sh(A)} 0, {sh(A)} 560px, {sh(0)} 680px)")+hud_top(s,paused=True)
def rail(s, rows, top=None, bottom=None, w=None, src='#src', tp='TP1', x=None):
    ph=s==P; x = x if x is not None else (24 if ph else 64)
    pos=f'top:{top}px' if top is not None else f'bottom:{bottom}px'
    return f'<div class="rail ui" data-tp="{tp}" data-src="{src}" data-y1="#srcm" style="left:{x}px;{pos};width:{w or (482 if ph else 520)}px">{rows}</div>'
def ri(tag,label,meta='',cls=''):
    m=f'<span class="meta">{meta}</span>' if meta and 'hero' not in cls else ''
    lab=f'<div><div class="lab">{label}</div><div class="meta" style="margin-top:4px">{meta}</div></div>' if 'hero' in cls else f'<span class="lab">{label}</span>{m}'
    return f'<div class="ri {cls}"><span class="tag">{tag}</span>{lab}</div>'
def paused(s):
    ph=s==P; b=pause_frame(s)
    if ph: b+='<div class="ui">'+dtitle(s,['Paused'],cell=None,meta='Clock stopped at 2 s',x=24,top=548,size='4rem')+'</div>'
    else:  b+='<div class="ui">'+dtitle(s,['Paused'],cell=None,meta='Clock stopped at 2 s · resumes at 1x',x=64,top=300,size='5.333rem')+'</div>'
    rows=ri('IF','Resume','at 1x','hero focus')+ri('ID','Save now','saved 10 s ago')+ri('EX','Settings')+ri('MEM','Controls')+ri('WB','Main menu','saves first')
    rows+='<div class="ri sm"><span class="tag short"></span><span class="lab">Files</span><span class="lab">Tools</span><span class="lab">Help</span></div>'
    b+=rail(s,rows,bottom=(40 if ph else 150))
    if not ph: b+='<div class="abs meta ui" style="left:64px;top:1000px">↑ ↓ move   Enter open   Esc resume</div>'
    return b
def controls(s):
    ph=s==P; b=pause_frame(s)
    if ph:
        b+='<div class="abs back ui" style="left:24px;top:540px">← Back</div>'
        b+='<div class="ui">'+dtitle(s,['Controls'],cell=3,meta='MEM · controls · touch',x=24,top=604,size='4rem')+'</div>'
        rows=[('Drag','Pan the view'),('Pinch','Zoom in or out'),('Tap a part','Pick it and open its card'),('Drag a part','From the shelf onto the board to fit it')]
        b+='<div class="abs ui" style="left:24px;top:760px;width:482px">'+pinrow(0,0,60,key=2).replace('class="orn"','class="orn" style="position:relative;display:block;margin-bottom:12px"',1)
        b+=''.join(f'<div class="kr" style="min-height:3.2rem"><span class="cond lg ink" style="width:9.5rem;flex:none">{k}</span><span class="sm mute">{v}</span></div>' for k,v in rows)+'</div>'
        return b
    b+='<div class="abs back ui" style="left:64px;top:112px">← Back <span class="meta">Esc</span></div>'
    b+='<div class="ui">'+dtitle(s,['Controls'],cell=3,meta='MEM · controls · keyboard and mouse',x=64,top=190,size='5.333rem')+'</div>'
    tabs=''.join(f'<div class="hi tab {"sel" if i==0 else ""}" {"id=\"t0\"" if i==0 else ""}><span class="tg">{t}</span><span class="tl">{n}</span></div>' for i,(t,n) in enumerate([('IF','Mouse'),('ID','View'),('EX','Game')]))
    b+=f'<div class="hrail ui" style="left:64px;top:372px;gap:96px">{tabs}</div><div class="ui" data-wire="#src|#t0 .tg|lit"></div>'
    rows=[('Drag','Pan the view'),('Right-drag','Turn the view'),('Scroll','Zoom in or out at the pointer'),('Click','Pick a part and open its card'),('Drag a part','From the shelf onto the board to fit it')]
    b+='<div class="abs ui" style="left:64px;top:470px;width:480px">'+'<div style="height:4px;margin-bottom:14px">'+pinrow(0,0,58,key=4).replace('class="orn"','class="orn" style="position:relative"',1)+'</div>'
    b+=''.join(f'<div class="kr"><span class="key">{k}</span><span class="sm mute">{v}</span></div>' for k,v in rows)+'</div>'
    b+='<div class="abs meta ui" style="left:64px;top:1000px">← → group   Esc or ? back</div>'
    return b

# ---------------- 11 First frame ----------------
def first_frame(s):
    ph=s==P; b=hud_top(s,staged=True)
    if ph:
        b+=ramp(f"linear-gradient(180deg, {sh(0)} 640px, {sh(A)} 700px)")
        b+='<div class="abs ui" style="left:24px;top:716px;width:482px"><div class="meta" style="display:flex;justify-content:space-between"><span>IF · tutorial · step 1</span><span class="sm mute">Skip tutorial</span></div>'
        b+='<div class="dt" style="font-size:3.2rem;margin-top:12px">Welcome</div><div class="sm ink" style="margin-top:12px">Welcome to Pipeline City! This tiny workshop is yours now. Clients will bring you jobs on little USB sticks called keys.</div></div>'
        b+='<div class="abs ui" style="left:24px;top:922px;display:flex;align-items:center;gap:12px"><span class="tag" id="nx" style="background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)">IF</span><span class="cond lg ink">Next</span></div>'
        b+=dock(s,only=True)+'<div class="ui" data-wire="#nx|#inv|lit|L"></div>'
        return b
    b+=bk(0,720,700,360,'tr',20)
    b+='<div class="abs ui" style="left:48px;top:752px;width:600px"><div class="meta" style="display:flex;justify-content:space-between"><span>IF · tutorial · step 1 · new instruction</span><span class="sm mute" style="margin-top:-3px">Skip tutorial</span></div>'
    b+='<div class="dt" style="font-size:4rem;margin-top:16px">Welcome</div><div class="md ink" style="margin-top:16px;line-height:1.4">Welcome to Pipeline City! This tiny workshop is yours now. Clients will bring you jobs on little USB sticks called keys.</div></div>'
    b+='<div class="abs ui" style="left:48px;top:984px;display:flex;align-items:center;gap:12px"><span class="tag" style="background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)">IF</span><span class="cond lg ink" id="nx">Next</span></div>'
    b+=dock(s,only=True)+'<div class="ui" data-hwire="#nx|#inv|lit"></div>'
    return b

# ---------------- 07 Build my PC ----------------
OPC=[('ALL','All parts'),('CS','Case'),('MB','Board'),('CPU','Processor'),('CL','Cooling'),('FAN','Fan'),('RAD','Radiator'),('MEM','Memory'),('PSU','Power'),('SSD','Drive'),('GPU','Graphics')]
SHELF=[('case2','Mid tower','T2 · $160'),('case3','Full tower','T3 · $320'),('case1','Micro tower','T1 · $70')]
def build(s):
    ph=s==P; b=''
    if not ph:
        # top-left: back + title + readout meta
        b+=bk(0,0,440,150,'br',20)
        b+='<div class="abs back ui" style="left:32px;top:2px">← Back <span class="meta">Esc</span></div>'
        b+='<div class="ui">'+dtitle(s,['Build my PC'],cell=2,meta='EX · <span class="ok">ready to start</span><br>$53,180 · 58–263 W / 1000 W · 29 parts',x=32,top=52,size='3.2rem')+'</div>'
        # top-right: lenses + benchmark
        b+=bk(1400,0,520,64,'bl')
        b+='<div class="hrail ui" style="left:1432px;top:6px;gap:16px"><div class="hi sm">Power</div><div class="hi sm">Airflow</div><div class="hi sm">Graphics</div></div>'
        b+='<div class="abs ui" style="left:1690px;top:10px;height:44px;display:flex;align-items:center;padding:0 14px;font:600 var(--t-md) \'IBM Plex Sans Condensed\';color:var(--c-ink)">Benchmark <span class="meta" style="margin-left:8px">score —</span></div>'
        # left: slim opcode rail (tags only) + contextual flyout for the selected category
        b+=bk(0,150,96,802,'')
        tags=''.join(f'<div class="ri {"focus" if i==1 else ""}" style="min-height:2.6rem;margin-top:6px" {"id=\"cs\"" if i==1 else ""}><span class="tag">{t}</span></div>' for i,(t,n) in enumerate(OPC))
        b+=f'<div class="rail ui" data-src="#src" data-y1="#srcm" style="left:26px;top:178px;width:60px">{tags}</div>'
        b+=bk(96,214,300,262,'tr br')
        b+='<div class="abs ui" style="left:116px;top:224px"><div class="cond md ink">Case</div><div class="meta" style="margin-top:2px">3 fit this board</div></div>'
        b+='<div class="abs ui" style="left:116px;top:278px;width:270px">'+''.join(f'<div style="display:flex;align-items:center;gap:12px;height:62px"><img src="{IMG}{p}.webp" style="width:64px;height:45px;object-fit:contain"><div><div class="cond md {"ink" if i==0 else "mute"}">{n}</div><div class="meta">{m}</div></div></div>' for i,(p,n,m) in enumerate(SHELF))+'</div>'
        # right: collapsed machine list tab
        b+=bk(1700,140,220,88,'tl bl')
        b+='<div class="abs ui" style="left:1724px;top:150px"><div class="cond md ink">In the machine</div><div class="meta" style="margin-top:4px">29 parts · $53,180  ‹</div></div>'
        # bottom: run (left), hint (centre), view (right)
        b+=bk(0,1016,600,64,'tr')
        b+='<div class="hrail ui" style="left:24px;top:1022px;gap:24px"><div class="hi md ink">Power on</div><div class="hi via"></div><div class="hi sm">OS Multicore 4.0</div><div class="hi via"></div><div class="hi sm" style="color:var(--c-ink);font-weight:600">1x</div><div class="hi sm">4x</div><div class="hi sm">16x</div><div class="hi sm">64x</div></div>'
        b+=bk(640,1040,540,40,'tl tr',10)
        b+='<div class="abs meta ui" style="left:640px;width:540px;top:1052px;text-align:center">Click the side panel to reach the parts inside.</div>'
        b+=bk(1220,1016,700,64,'tl')
        b+='<div class="hrail ui" style="left:1244px;top:1022px;gap:24px"><div class="hi sm">Side panel&nbsp;&nbsp;<span class="meta">SHUT</span></div><div class="hi via"></div><div class="hi sm">Undo</div><div class="hi sm">Redo</div><div class="hi via"></div><div class="hi sm">Steps&nbsp;&nbsp;<span class="meta">1x</span></div><div class="hi via"></div><div class="hi sm">View&nbsp;&nbsp;<span class="meta">ANGLE</span></div><div class="hi sm">Focus</div></div>'
        # ornament: brackets around the machine stage, silk
        return b
    # phone
    b+=bk(0,0,530,100)
    b+='<div class="abs back ui" style="left:16px;top:0px">← Back</div>'
    b+='<div class="abs ui" style="right:16px;top:8px;height:36px;display:flex;align-items:center;padding:0 12px;font:600 var(--t-md) \'IBM Plex Sans Condensed\';color:var(--c-ink)">Benchmark</div>'
    b+='<div class="ui">'+dtitle(s,['Build my PC'],cell=2,meta='EX · <span class="ok">ready</span> · $53,180 · 29 parts',x=16,top=46,size='2.133rem')+'</div>'
    b+=bk(0,800,530,280)
    tabs=''.join(f'<div class="hi" style="gap:8px;flex:none" {"id=\"bt0\"" if i==1 else ""}><span class="tag" style="{"background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)" if i==1 else ""}">{t}</span>{f"<span class=\"cond md ink\">{n}</span>" if i==1 else ""}</div>' for i,(t,n) in enumerate(OPC[:7]))
    b+=f'<div class="hrail ui" data-lit="on" data-lead="8" style="left:16px;top:806px;gap:12px">{tabs}</div>'
    b+='<div class="abs ui" style="left:16px;top:866px;display:flex;gap:16px">'+''.join(f'<div style="width:150px"><img src="{IMG}{p}.webp" style="width:96px;height:67px;object-fit:contain;display:block"><div class="cond md {"ink" if i==0 else "mute"}">{n}</div><div class="meta">{m}</div></div>' for i,(p,n,m) in enumerate(SHELF))+'</div>'
    it=''.join(f'<div class="hi md" style="{"color:var(--c-ink)" if i==0 else ""}">{v}</div>' for i,v in enumerate(['Parts','Machine','Run']))
    b+=f'<div class="hrail ui" style="left:16px;top:1024px;gap:28px">{it}</div>'
    return b

# ---------------- 08 Gallery ----------------
GCAT=[('CS','Case',4),('MB','Board',4),('CPU','Processor',6),('CL','Cooling',3),('FAN','Fan',3),('RAD','Radiator',2),('RAM','Memory',5),('PSU','Power',4),('MON','Monitor',3),('SSD','Drive',4),('VRM','VRM sink',2),('RSK','RAM sink',2),('NET','Network',3),('GPU','Graphics',5),('AI','AI card',2),('SEC','Secure',2)]
def gallery(s):
    ph=s==P; b=''
    shelf=[('case0','Mini tower','T0 · $25'),('case1','Micro tower','T1 · $70'),('case2','Mid tower','T2 · $160'),('case3','Full tower','T3 · $320')]
    if not ph:
        b+='<div class="abs back ui" style="left:32px;top:2px">← Back <span class="meta">Esc</span></div>'
        b+='<div class="ui">'+dtitle(s,['Gallery'],cell=3,meta='MEM · gallery · 64 parts',x=32,top=52,size='3.2rem')+'</div>'
        rows=''.join(f'<div class="ri sm {"focus" if i==0 else ""}" style="min-height:2.4rem;margin-top:4px"><span class="tag">{t}</span><span class="lab" style="font:600 var(--t-md) \'IBM Plex Sans Condensed\';{"color:var(--c-ink)" if i==0 else ""}">{n}</span><span class="meta">{c}</span></div>' for i,(t,n,c) in enumerate(GCAT))
        b+=f'<div class="rail ui" data-src="#src" data-y1="#srcm" style="left:32px;top:190px;width:240px">{rows}</div>'
        b+='<div class="ui">'+bracket(380,140,1120,760,arm=24,pin1=True)+silk(380,124,'U3 · CASE · MID TOWER')+silk(420,882,'3 / 4','right')+ruler(380,910,1120,major=80)+'</div>'
        b+='<div class="abs ui" style="left:1560px;top:150px;width:330px">'+pinrow(0,0,40,key=0).replace('class="orn"','class="orn" style="position:relative;display:block;margin-bottom:16px"',1)
        b+='<div class="meta">CS · case · tier 2</div><div class="dt" style="font-size:3.2rem;margin-top:10px">Mid tower</div><div class="md mute" style="margin-top:8px">ATX case</div><div class="cond xl ink" style="margin-top:10px">$160</div>'
        b+='<div class="meta" style="margin-top:20px;display:flex;justify-content:space-between"><span>BIGGEST BOARD</span><span class="ink">ATX</span></div><div class="meta" style="margin-top:8px;display:flex;justify-content:space-between"><span>MEMORY SLOTS IT CAN HOLD</span><span class="ink">4</span></div></div>'
        b+='<div class="abs ui" style="left:1560px;top:520px;width:330px">'+''.join(f'<div style="display:flex;align-items:center;gap:12px;height:62px"><img src="{IMG}{p}.webp" style="width:64px;height:45px;object-fit:contain"><div><div class="cond md {"ink" if i==2 else "mute"}">{n}</div><div class="meta">{m}</div></div></div>' for i,(p,n,m) in enumerate(shelf))+'</div>'
        b+='<div class="abs meta ui" style="left:380px;top:1000px">Drag turn · Right-drag pan · Scroll zoom · Double-click reset · ← → part · ↑ ↓ category · Esc back</div>'
        return b
    b+='<div class="abs back ui" style="left:16px;top:0px">← Back</div><div class="abs meta ui" style="right:16px;top:16px">MEM · gallery · 64 parts</div>'
    b+='<div class="ui">'+bracket(12,56,506,520,arm=16,pin1=True)+silk(16,582,'U3 · CASE')+'</div>'
    b+='<div class="abs ui" style="left:16px;top:610px;width:498px"><div class="meta">CS · case · tier 2 · ATX case</div><div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px"><span class="dt" style="font-size:3.2rem">Mid tower</span><span class="cond xl ink">$160</span></div></div>'
    tabs=''.join(f'<div class="hi" style="gap:8px;flex:none"><span class="tag" style="{"background:var(--c-accent);color:var(--c-void);border-radius:var(--r1)" if i==0 else ""}">{t}</span>{f"<span class=\"cond md ink\">{n}</span>" if i==0 else ""}</div>' for i,(t,n,c) in enumerate(GCAT[:7]))
    b+=f'<div class="hrail ui" data-lead="8" style="left:16px;top:706px;gap:12px">{tabs}</div>'
    b+='<div class="abs ui" style="left:16px;top:770px;display:flex;gap:12px">'+''.join(f'<div style="width:112px"><img src="{IMG}{p}.webp" style="width:96px;height:67px;object-fit:contain;display:block"><div class="cond md {"ink" if i==2 else "mute"}">{n}</div><div class="meta">{m}</div></div>' for i,(p,n,m) in enumerate(shelf))+'</div>'
    b+='<div class="abs ui" style="left:16px;top:930px;width:498px">'+pinrow(0,0,60,key=2).replace('class="orn"','class="orn" style="position:relative;display:block;margin-bottom:12px"',1)+'<div class="meta" style="display:flex;justify-content:space-between"><span>BIGGEST BOARD</span><span class="ink">ATX</span></div><div class="meta" style="margin-top:6px;display:flex;justify-content:space-between"><span>MEMORY SLOTS IT CAN HOLD</span><span class="ink">4</span></div></div>'
    b+='<div class="abs meta ui" style="left:16px;top:1040px">Drag to turn · Pinch to zoom · Swipe the shelf</div>'
    return b

# ---------------- backdrops ----------------
def backdrop(name, s):
    ph=s==P
    if name.startswith(('09','10','11','12')): return dict(bg=f'{SH}bg-ingame-{s}.png')
    if name.startswith('07'):
        if not ph: return dict(bg=f'{SH}bg-build-desktop-v2.png', bgpos='-218px 14px/2208px 1242px', bgcolor='#49484a')
        return dict(bg=f'{SH}bg-build-desktop-v2.png', bgpos='-445px 160px/1267px 713px', bgcolor='#49484a')
    if name.startswith('08'):
        return dict(bgcolor=STUDIO)
def model(name,s):  # Gallery still sits in the scene layer (not UI)
    if not name.startswith('08'): return ''
    if s==P: return f'<img src="{IMG}case2.webp" style="position:absolute;left:25px;top:76px;width:480px">'
    return f'<img src="{IMG}case2.webp" style="position:absolute;left:420px;top:150px;width:1040px">'
SCREENS={'07-build-my-pc':build,'08-gallery':gallery,'09-controls':controls,'10-pause-menu':paused,'11-first-frame':first_frame,'12-hud':hud}
if __name__=='__main__':
    only=sys.argv[1:]
    for n,fn in SCREENS.items():
        if only and not any(n.startswith(o) for o in only): continue
        for s in (D,P):
            kw=backdrop(n,s); body=model(n,s)+fn(s)
            render3(n,s,page3(s,body,**kw)); render3(n,s,page3(s,body,noui=True,**kw),'-noui')
        print('rendered',n)
