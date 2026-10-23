# Program generator

Code: `src/sim/gen` (import from `src/sim/gen`). No DOM imports. Output is real assembly for the toy ISA ([`ISA.md`](ISA.md)), assembled with `src/sim/asm`, deterministic per seed.

```ts
import { generate, runReference } from "src/sim/gen";
const g = generate("cli", seed, { scale: 1 });   // { asm, program: Uint32Array, symbols, meta }
machine.attach(createEngine(cfg), g.program);
```

## Kernels (`kernels.ts`)

Small leaf subroutines, args in `a0..a3`, result in `a0`, return with `ret`. They clobber `a0-a3`, `t0-t4`, keep `s0-s3` and `sp` (leaves, so no stack traffic yet). Each factory takes a label namespace `ns`: the entry label is `ns`, internal labels are `ns_*`, so composition cannot collide. Each returns `Kernel { name, ns, mix, footprintBytes, asm }`; `mix` is a list of tags (`alu mul mem branch io`) and `footprintBytes` the static memory it touches (templates add runtime-sized regions).

| Kernel | Args -> result | Notes |
|---|---|---|
| `printDec(ns, width)` | a0 dst, a1 n -> a0 += width | zero-padded decimal, width 2..4, divide-by-10 via `(n*205)>>11` (needs n <= 1028) |
| `printStr(ns)` | a0 dst, a1 NUL string -> a0 end | byte copy loop, used for display text |
| `memcpy(ns)` | a0 dst, a1 src, a2 bytes (>=1) | byte loop |
| `checksum(ns)` | a1 ptr, a2 words (>=1) -> a0 | `h = h*33 ^ w` from 5381 |
| `arraySum(ns, strideBytes)` | a0 ptr, a1 count -> a0 | stride 4 is cache-friendly, 64 and 128 (multiples of the cache line count x line size) are hostile |
| `fillStride(ns, strideBytes)` | a0 ptr, a1 count, a2 start | stores `start, start+3, ...` |
| `mulLoop(ns, mul, add)` | a0 x, a1 rounds (>=1) -> a0 | `x = x*mul + add`, multiplier heavy |
| `pollIdle(ns, offset, mask)` | none | spins while a status-word bit is set; status is plain storage today so it falls through after one poll |

## Templates (`templates.ts`)

`TEMPLATES` maps a name to `TemplateFn = (rng: Prng, p: ResolvedParams) => Built`. A small `Builder` hands out namespaces, collects `main` code, kernels and data.

| Name | What it does | Instructions (ref, scale 1) |
|---|---|---|
| `cli.log` | poll display idle, write a status line `#72 user login OK` as packed word stores | 20-22 |
| `cli.calc` | 1-2 rounds of `x*m+a`, prints `#72 mul=31 OK` (result & 63) | 36 or 40 |
| `cli.checksum` | hashes one embedded data word, prints `#72 sum=31 OK` | 40 |
| `cli.scan` | fill then sum a RAM table at 0x4000 with a seeded stride (64 or 128 B, both cache-hostile: every load misses), prints `#72 scan 4x128B 0123 OK` | ~96 (heavy, one third of the starting economy mix) |
| `cli` | picks log / calc / checksum from the seed | 20-40 |

Measured on the reference interpreter (ecall included). The unpipelined engine takes 5 cycles per instruction plus cache-miss stalls, so the first request is 100-200 CPU cycles; the pacing target (20-40 s at 1 tick/s) therefore needs the CPU base rate set accordingly, or the count lowered. Static text is emitted as packed `li`+`sw` word stores (about 3 instructions per 4 characters); only computed numbers go through `printDec`.

## Params, seeds, meta

`generate(template, seed, params?)`. Params: `scale` (1..16, default 1: more log lines, more rounds, more hash words, more scan elements), `row` (display row, default 0), `jobId` (0..99, default from the seed). The seed feeds `Prng` (`src/sim/machine/prng.ts`); same inputs give byte-identical `asm`. Unknown templates or out-of-range params throw `RangeError`.

`meta`: `template`, `seed`, resolved `params`, `kernels` (`{kernel, ns, mix, footprintBytes}`), union `mix`, `expectedText` (display contents computed in TypeScript independently of the interpreter), `footprintBytes`, `codeWords`. `runReference(g)` runs the reference interpreter and returns `{steps, text, cpu}`; tests assert `text === meta.expectedText` and that the timed engines match.

Memory use: code at 0, scan table at `BUF_BASE` 0x4000..0xC000, display and status windows only. Program size is capped at 0x4000 bytes.

## Adding a template

1. Write a `TemplateFn` in `templates.ts`: draw parameters from `rng` (draw in a fixed order), call `b.add(K.something(b.ns("name")))` for kernels, `b.emit(...)` for main, `b.addData(...)` for data, and return `b.finish(header, expectedText)`.
2. Register it in `TEMPLATES`. Planned: `web`, `gpu.render` (will also emit a second ISA kernel), `secure`.
3. The generic tests loop over `TEMPLATE_NAMES`, so determinism, reference equality and engine equivalence are checked automatically. Add a pacing test if the template is meant to be a default.
