# The light bake's Blender side (`src/features/room/light.md`, "Offline bakes"; T179). `bake.mjs` runs it:
#   blender -b --factory-startup -P tools/bake/bake.py -- <work dir> [group ...]
# It reads the room that `bake.mjs` wrote (`scene.json`, `scene.bin`), bakes each light group's indirect light into one float lightmap with
# Cycles (the receivers share one atlas), denoises it, and writes `<group>.f32` (RGB float32, rows from the bottom) back into the work dir.
# The light reaches the lightmaps in the game's units: the irradiance its shader adds (a lamp's: what its real-time light would give once it
# bounced; the sky's and the city's: for a radiance of 1 in their half of the sky; the sun's: for an irradiance of 1). A first bake of one
# lit plane measures what each kind of Blender light gives (`calibrate`).
import bpy, json, math, os, sys, time
import numpy as np
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
WORK, ONLY, PREVIEW = ARGS[0], {a for a in ARGS[1:] if not a.startswith('--')}, '--preview' in ARGS
CFG = json.load(open(os.path.join(WORK, 'scene.json')))
BLOB = open(os.path.join(WORK, 'scene.bin'), 'rb').read()
scene = bpy.context.scene


def log(*a):
    print('[bake]', *a, flush=True)


def arr(off, n, dt):
    return np.frombuffer(BLOB, dtype=dt, count=n, offset=off)


def cycles(samples):
    """Cycles on the GPU (OptiX), no clamp, no caustics: light as it is, the denoiser takes the noise."""
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    gpu = any(d.use for d in prefs.devices)
    c = scene.cycles
    c.device = 'GPU' if gpu else 'CPU'
    c.samples = samples
    c.use_adaptive_sampling = False  # every texel takes all its samples: the dark ones too, where the noise shows
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces, c.transparent_max_bounces, c.volume_bounces = 12, 8, 4, 0, 8, 0
    c.sample_clamp_direct = c.sample_clamp_indirect = 0
    c.caustics_reflective = c.caustics_refractive = False
    c.blur_glossy = 1.0
    return [d.name for d in prefs.devices if d.use] or ['CPU']


def tree(idb):
    if idb.node_tree is None:
        idb.use_nodes = True
    return idb.node_tree


def float_image(name, w, h):
    img = bpy.data.images.new(name, w, h, float_buffer=True, alpha=False)
    for cs in ('Non-Color', 'Data'):
        try:
            img.colorspace_settings.name = cs
            break
        except TypeError:
            pass
    return img


def material(name, colour, rough, metal, image):
    """A Principled surface; a receiver's also holds the bake's image (its active node: Cycles bakes into it)."""
    m = bpy.data.materials.new(name)
    nt = tree(m)
    b = nt.nodes.get('Principled BSDF') or nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (*colour, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if image is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image
        nt.nodes.active = t
    return m


def joined(name, parts, materials):
    """
    One object of many meshes (Blender bakes object by object, each a new Cycles session: one object bakes in one). A part: its positions (in
    Blender's frame: metres, z up), normals, triangles and material slot; a receiver's also its lightmap UVs and its charts, a value a corner.
    """
    pos, tri, nrm, mats, uvs, charts, base = [], [], [], [], [], [], 0
    for p in parts:
        t = p['idx'].reshape(-1, 3).astype(np.int64)
        v = p['pos'].reshape(-1, 3)
        # three's front face is its counter-clockwise side; a mesh drawn mirrored (or wound the other way) turns so its faces look where its normals do
        face = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
        vn = p['nrm'].reshape(-1, 3)[t].sum(axis=1)
        turn = [0, 2, 1] if (np.einsum('ij,ij->i', face, vn) < 0).sum() > len(t) / 2 else [0, 1, 2]
        t = t[:, turn]
        pos.append(v)
        tri.append(t + base)
        nrm.append(p['nrm'].reshape(-1, 3)[t].reshape(-1, 3))
        mats.append(np.full(len(t), p['mat'], np.int32))
        if 'uv' in p:
            uvs.append(p['uv'].reshape(-1, 3, 2)[:, turn].reshape(-1, 2))
            charts.append(p['chart'].reshape(-1, 3)[:, turn].ravel())
        base += len(v)
    pos, tri = np.concatenate(pos).astype(np.float32), np.concatenate(tri).astype(np.int32).ravel()
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(pos))
    me.vertices.foreach_set('co', pos.ravel())
    me.loops.add(len(tri))
    me.loops.foreach_set('vertex_index', tri)
    me.polygons.add(len(tri) // 3)
    me.polygons.foreach_set('loop_start', np.arange(0, len(tri), 3, dtype=np.int32))
    me.polygons.foreach_set('material_index', np.concatenate(mats))
    me.update(calc_edges=True)
    if uvs:
        me.uv_layers.new(name='lm').data.foreach_set('uv', np.concatenate(uvs).astype(np.float32).ravel())
        rnd = (np.concatenate(charts).astype(np.uint64) * 2654435761) & 0xffffffff
        col = np.ones((len(tri), 4), np.float32)
        for k in range(3):
            col[:, k] = 0.15 + 0.85 * ((rnd >> np.uint64(8 * k)) & np.uint64(255)) / 255.0
        me.color_attributes.new('chart', 'FLOAT_COLOR', 'CORNER').data.foreach_set('color', col.ravel())
    me.normals_split_custom_set(np.concatenate(nrm).astype(np.float32))
    for m in materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def world(mode, strength):
    """The world: dark, or a radiance of `strength` over its upper half (the sky) or its lower half (the city's glow)."""
    w = scene.world or bpy.data.worlds.new('bake')
    scene.world = w
    nt = tree(w)
    nt.nodes.clear()
    co, sep, cmp = nt.nodes.new('ShaderNodeTexCoord'), nt.nodes.new('ShaderNodeSeparateXYZ'), nt.nodes.new('ShaderNodeMath')
    mul, bg, out = nt.nodes.new('ShaderNodeMath'), nt.nodes.new('ShaderNodeBackground'), nt.nodes.new('ShaderNodeOutputWorld')
    cmp.operation = 'LESS_THAN' if mode == 'city' else 'GREATER_THAN'
    cmp.inputs[1].default_value = 0.0
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = strength if mode in ('sky', 'city') else 0.0
    bg.inputs['Color'].default_value = (1, 1, 1, 1)
    nt.links.new(co.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], cmp.inputs[0])
    nt.links.new(cmp.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], bg.inputs['Strength'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])


def light(kind, name, at=(0, 0, 0), rot=Matrix.Identity(3)):
    data = bpy.data.lights.new(name, {'point': 'POINT', 'spot': 'SPOT', 'area': 'AREA', 'sun': 'SUN'}[kind])
    if kind in ('point', 'spot'):
        data.shadow_soft_size = 0.0
        if hasattr(data, 'use_soft_falloff'):
            data.use_soft_falloff = False
    ob = bpy.data.objects.new(name, data)
    ob.matrix_world = Matrix.Translation(Vector(at)) @ rot.to_4x4()
    scene.collection.objects.link(ob)
    return ob


def bake(receivers, pass_filter, kind='DIFFUSE'):
    for o in scene.objects:
        o.select_set(False)
    for o in receivers:
        o.select_set(True)
    bpy.context.view_layer.objects.active = receivers[0]
    opts = dict(type=kind, use_clear=True, margin=CFG['padding'], margin_type='EXTEND', target='IMAGE_TEXTURES')
    if kind == 'DIFFUSE':
        opts['pass_filter'] = pass_filter
    if kind == 'NORMAL':
        opts['normal_space'] = 'OBJECT'
    bpy.ops.object.bake(**opts)


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def calibrate():
    """What each kind of Blender light gives a white plane 1 m off (the direct light only), in the bake's own numbers."""
    cycles(256)
    img = float_image('cal', 17, 17)  # odd: a texel's centre is the plane's centre
    pos = np.array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], np.float32)
    plane = joined('cal', [dict(pos=pos, nrm=np.tile([0, 0, 1], 4).astype(np.float32), idx=np.array([0, 1, 2, 0, 2, 3]), mat=0,
                                uv=np.array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], np.float32), chart=np.zeros(6, np.uint32))],
                   [material('cal', (1, 1, 1), 0.5, 0.0, img)])
    down = Matrix.Identity(3)  # a light looks down its -z

    def measure(ob, whole=False):
        bake([plane], {'DIRECT'})
        px = pixels(img)[..., 0]
        if ob is not None:
            bpy.data.objects.remove(ob)
        return float(px.mean() if whole else px[8, 8])

    world('dark', 0)
    p = light('point', 'cal-point', (0, 0, 1)); p.data.energy = 1
    v_pt = measure(p)
    s = light('spot', 'cal-spot', (0, 0, 1), down); s.data.energy = 1; s.data.spot_size = math.radians(120); s.data.spot_blend = 0
    v_sp = measure(s)
    a = light('area', 'cal-area', (0, 0, 1), down); a.data.energy = 1; a.data.shape = 'SQUARE'; a.data.size = 0.05
    v_ar = measure(a)
    u = light('sun', 'cal-sun', (0, 0, 1), down); u.data.energy = 1; u.data.angle = 0
    v_sun = measure(u)
    world('sky', 1.0)
    v_w = measure(None, True)
    world('city', 1.0)
    v_c = measure(None, True)
    world('dark', 0)
    bpy.data.objects.remove(plane)
    cal = dict(point=v_pt, spot=v_sp, area=v_ar, sun=v_sun, sky=v_w, city_on_up_plane=v_c)
    log('calibration', cal)
    if v_c > 0.02 * v_w:
        raise RuntimeError('the city\'s half of the world lights an upward plane: the world mask is wrong')
    return cal


def lamp(g, k, l, cal):
    """One of the game's lights as a Blender light of the same power: a point's or a spot's intensity (per m²), an area's radiance."""
    rot = Matrix.Identity(3)
    if l['kind'] == 'spot':
        rot = Vector(l['dir']).to_track_quat('-Z', 'Y').to_matrix()
    if l['kind'] == 'area':
        x, y = Vector(l['x']), Vector(l['y'])
        rot = Matrix((x, y, x.cross(y))).transposed()
    ob = light(l['kind'], f"{g}-{k}", l['pos'], rot)
    d = ob.data
    d.color = l['colour']
    if l['kind'] == 'point':
        d.energy = l['power'] / cal['point']
    elif l['kind'] == 'spot':
        d.energy = l['power'] / cal['spot']
        d.spot_size = min(math.pi, 2 * l['angle'])
        c0, c1 = math.cos(l['angle']), math.cos(l['angle'] * (1 - l['penumbra']))
        d.spot_blend = max(0.0, min(1.0, (c1 - c0) / (1 - c0)))
    else:
        d.shape, d.size, d.size_y = 'RECTANGLE', l['w'], l['h']
        d.energy = l['power'] * l['w'] * l['h'] / cal['area']
    return ob


def denoiser(W, H):
    """A compositor scene that denoises the lightmap (OIDN), steered by the charts' colours and the normals so no chart bleeds into the next."""
    s = bpy.data.scenes.new('denoise')
    ng = bpy.data.node_groups.new('denoise', 'CompositorNodeTree')
    s.compositing_node_group = ng
    s.render.use_compositing = True
    s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = W, H, 100
    s.render.compositor_denoise_final_quality = 'HIGH'
    ins = {k: ng.nodes.new('CompositorNodeImage') for k in ('lm', 'albedo', 'normal')}
    d = ng.nodes.new('CompositorNodeDenoise')
    d.inputs['HDR'].default_value = True
    f = ng.nodes.new('CompositorNodeOutputFile')
    f.file_output_items.new('RGBA', 'out')
    f.directory, f.file_name = WORK, 'denoised'
    f.format.media_type = 'IMAGE'
    f.format.file_format, f.format.color_depth, f.format.color_mode = 'OPEN_EXR', '32', 'RGB'
    ng.links.new(ins['lm'].outputs['Image'], d.inputs['Image'])
    ng.links.new(ins['albedo'].outputs['Image'], d.inputs['Albedo'])
    ng.links.new(ins['normal'].outputs['Image'], d.inputs['Normal'])
    ng.links.new(d.outputs['Image'], f.inputs[0])
    return s, ins


def denoise(s, ins, img):
    ins['lm'].image = img
    path = os.path.join(WORK, 'denoisedout.exr')
    if os.path.exists(path):
        os.remove(path)
    bpy.ops.render.render(scene=s.name)
    out = bpy.data.images.load(path, check_existing=False)
    px = pixels(out)
    bpy.data.images.remove(out)
    return px


def preview(rec, blockers, img, px, path):
    """
    A look at one group's lightmap (`--preview`): the receivers glow with it (as white surfaces would, at an exposure that shows its shape),
    the blockers hidden, from the bed's foot toward the west wall's corner by the glass (the floor lantern's).
    """
    cam = bpy.data.objects.get('preview')
    if cam is None:
        cam = bpy.data.objects.new('preview', bpy.data.cameras.new('preview'))
        cam.data.lens = 16
        scene.collection.objects.link(cam)
        at, to = Vector((1.2, -3.2, 0.3)), Vector((-2.1, -0.7, -0.4))
        cam.matrix_world = Matrix.Translation(at) @ (to - at).to_track_quat('-Z', 'Y').to_matrix().to_4x4()
    scene.camera = cam
    m = bpy.data.materials.get('preview') or bpy.data.materials.new('preview')
    nt = tree(m)
    nt.nodes.clear()
    uv, tex, em, mo = nt.nodes.new('ShaderNodeUVMap'), nt.nodes.new('ShaderNodeTexImage'), nt.nodes.new('ShaderNodeEmission'), nt.nodes.new('ShaderNodeOutputMaterial')
    uv.uv_map, tex.image = 'lm', img
    lit = px[..., :3].max(axis=2)
    em.inputs['Strength'].default_value = 0.7 / max(1e-9, float(np.percentile(lit[lit > 0], 95))) if (lit > 0).any() else 1
    nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], mo.inputs['Surface'])
    own = list(rec.data.materials)
    for i in range(len(own)):
        rec.data.materials[i] = m
    blockers.hide_render = True
    hidden = [o for o in scene.objects if o.type == 'LIGHT' and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    world('dark', 0)  # the next group sets its own
    s = scene.cycles.samples
    scene.cycles.samples = 16
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 100
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scene.cycles.samples = s
    for o in hidden:
        o.hide_render = False
    blockers.hide_render = False
    for i, mm in enumerate(own):
        rec.data.materials[i] = mm


def main():
    t0 = time.time()
    for o in list(bpy.data.objects):  # the start-up scene's cube, lamp and camera
        bpy.data.objects.remove(o)
    cal = calibrate()
    devices = cycles(CFG['samples'])
    log('devices', devices, 'samples', CFG['samples'])
    W, H = CFG['width'], CFG['height']
    lm = float_image('lm', W, H)
    # the receivers in one object, the blockers in another; the surfaces of one look share a material
    keys, slots, parts = {}, {True: [], False: []}, {True: [], False: []}
    for m in CFG['meshes']:
        n, r = m['verts'], m['receiver']
        key = (r, *(round(c, 4) for c in m['colour']), round(m['roughness'], 3), round(m['metalness'], 3))
        if key not in keys:
            keys[key] = len(slots[r])
            slots[r].append(material(f"{'r' if r else 'b'}{len(slots[r])}", m['colour'], m['roughness'], m['metalness'], lm if r else None))
        part = dict(pos=arr(m['pos'], 3 * n, '<f4'), nrm=arr(m['nrm'], 3 * n, '<f4'), mat=keys[key],
                    idx=arr(m['index'], m['corners'], '<u4') if m['index'] >= 0 else np.arange(n, dtype=np.uint32))
        if r:
            part['uv'], part['chart'] = arr(m['uv'], 2 * m['corners'], '<f4'), arr(m['chart'], m['corners'], '<u4')
        parts[r].append(part)
    receivers = [joined('receivers', parts[True], slots[True])]
    blockers = joined('blockers', parts[False], slots[False])
    log(f"{len(CFG['meshes'])} meshes ({len(parts[True])} receivers), {len(slots[True]) + len(slots[False])} materials, built in {time.time() - t0:.0f} s")

    # the denoiser's guides: each chart's colour (an emission bake) and the normals, through one shared material for the moment
    aux = bpy.data.materials.new('aux')
    nt = tree(aux)
    nt.nodes.clear()
    at, em, mo, tex = nt.nodes.new('ShaderNodeAttribute'), nt.nodes.new('ShaderNodeEmission'), nt.nodes.new('ShaderNodeOutputMaterial'), nt.nodes.new('ShaderNodeTexImage')
    at.attribute_name = 'chart'
    nt.links.new(at.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], mo.inputs['Surface'])
    nt.nodes.active = tex
    own = list(receivers[0].data.materials)
    for i in range(len(own)):
        receivers[0].data.materials[i] = aux
    scene.cycles.samples = 4
    albedo, normal = float_image('albedo', W, H), float_image('normal', W, H)
    tex.image = albedo
    bake(receivers, None, 'EMIT')
    tex.image = normal
    bake(receivers, None, 'NORMAL')
    n = pixels(normal)
    n[..., :3] = n[..., :3] * 2 - 1
    normal.pixels.foreach_set(n.ravel())
    for i, m in enumerate(own):
        receivers[0].data.materials[i] = m
    scene.cycles.samples = CFG['samples']
    dn, ins = denoiser(W, H)
    ins['albedo'].image, ins['normal'].image = albedo, normal

    lights = {}
    for g in CFG['groups']:
        if g['kind'] == 'lamp':
            lights[g['id']] = [lamp(g['id'], k, l, cal) for k, l in enumerate(g['lights'])]
        elif g['kind'] == 'sun':
            ob = light('sun', g['id'], (0, 0, 5), Vector(g['dir']).to_track_quat('Z', 'Y').to_matrix())
            ob.data.energy, ob.data.angle = 1 / cal['sun'], math.radians(0.53)
            lights[g['id']] = [ob]
        else:
            lights[g['id']] = []
    for g in CFG['groups']:
        if ONLY and g['id'] not in ONLY:
            continue
        t1 = time.time()
        for k, obs in lights.items():
            for ob in obs:
                ob.hide_render = k != g['id']
        world(g['kind'], math.pi / cal['sky'])
        bake(receivers, {'INDIRECT'})
        raw = pixels(lm)
        out = denoise(dn, ins, lm) if CFG['denoise'] else raw
        out[..., :3].astype('<f4').tofile(os.path.join(WORK, f"{g['id']}.f32"))
        if PREVIEW:
            show = bpy.data.images.get('show') or float_image('show', W, H)
            show.pixels.foreach_set(out.ravel())
            preview(receivers[0], blockers, show, out, os.path.join(WORK, f"preview-{g['id']}.png"))
        log(f"{g['id']}: {time.time() - t1:.0f} s, mean {raw[..., :3].mean():.4g}, max {raw[..., :3].max():.4g}")
    log(f'done in {time.time() - t0:.0f} s')


main()
