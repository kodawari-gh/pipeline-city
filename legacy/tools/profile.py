# Times each render layer at die / mid / board zoom, plus sim cost. Software-rendered headless
# Chromium: absolute numbers are pessimistic, proportions are what matter.
# Usage: python3 tools/profile.py
import asyncio, json, pathlib
from playwright.async_api import async_playwright
URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist/index.html').as_uri()
JS = """() => {
  const T_ = (fn, n=15) => { const t0=performance.now(); for(let i=0;i<n;i++) fn(); return +((performance.now()-t0)/n).toFixed(2); };
  const X = () => ctx.setTransform(DPR*cam.z,0,0,DPR*cam.z,DPR*(VW/2-cam.x*cam.z),DPR*(VH/2-cam.y*cam.z));
  const out = {}; fly = null;
  const views = {die:camTarget(L,false), board:boardTarget(false), mid:{x:0,y:0,z:.35}};
  for (const k in views) { Object.assign(cam, views[k]); out[k] = {
    fullFrame: T_(()=>draw(performance.now())),
    board: T_(()=>{X();drawBoard();}),
    socket_pkg: T_(()=>{X();drawSocket();drawPackage();}),
    decor: T_(()=>{X();drawDecor(.5);}),
    tiles_chips: T_(()=>{X();for(const k in L.tiles)drawTile(L.tiles[k]);drawDistricts();for(const f of fx.values())drawChip(f);}) }; }
  Object.assign(cam, views.board);
  out.board_bgDotGrid = T_(()=>{X();const sp=40,ax=cam.x-VW/2/cam.z,ay=cam.y-VH/2/cam.z;ctx.fillStyle=T.dot;for(let gx=Math.floor(ax/sp)*sp;gx<ax+VW/cam.z;gx+=sp)for(let gy=Math.floor(ay/sp)*sp;gy<ay+VH/cam.z;gy+=sp)ctx.fillRect(gx-1.5,gy-1.5,3,3);});
  const smd = FILL.smd.slice(); FILL.smd.length = 0; out.board_withoutSMD = T_(()=>{X();drawBoard();}); FILL.smd.push(...smd);
  out.sim_us_per_cycle = {}; for (const m of ['pipe','wide','ooo']) { const E=ENG[m]; E.reset(); out.sim_us_per_cycle[m] = +(T_(()=>E.step({fwd:true,shared:false}),2000)*1000).toFixed(1); }
  return out; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1360,'height':800})
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        print(json.dumps(await pg.evaluate(JS), indent=1)); await b.close()
asyncio.run(main())
