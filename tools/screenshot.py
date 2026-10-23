# Headless screenshots. Needs: pip install playwright && playwright install chromium
# Usage: python3 tools/screenshot.py [dark|light]   (writes /tmp/pc_*.png)
import asyncio, sys, pathlib
from playwright.async_api import async_playwright
URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist/index.html').as_uri()
async def main(scheme):
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1360,'height':800}, color_scheme=scheme)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.evaluate("document.getElementById('speed').value=8;document.getElementById('speed').dispatchEvent(new Event('input'))")
        await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/pc_intro.png')
        await pg.wait_for_timeout(3800); await pg.screenshot(path='/tmp/pc_die.png')
        await pg.click('#b-board'); await pg.wait_for_timeout(2000); await pg.click('#h-miss'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='/tmp/pc_board.png')
        for m in ['wide','ooo','unpipe']:
            await pg.click(f'#m-{m}'); await pg.wait_for_timeout(3500); await pg.screenshot(path=f'/tmp/pc_{m}.png')
        print('errors:', errs or 'none'); await b.close()
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'dark'))
