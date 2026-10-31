# Program generator

Code: `src/features/jobs/sim/gen` (import from `src/features/jobs/sim/gen`). No DOM imports. Output is real assembly for the toy ISA ([`ISA.md`](ISA.md)), assembled with `src/features/cpu/sim/asm`, deterministic per seed.

```ts
import { generate, runReference } from "src/features/jobs/sim/gen";
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
| `gpu.render` | a batch kernel (`vadd`, `saxpy`, `blur3`, `mandel`, picked by the seed) over `32 x max(1, scale/2)` seeded words, prints the sum of its outputs, e.g. `#07 blur3 41 OK`. **Hardware-aware**: `generate(..., { gpu })` (a `GpuTarget` of bus base, lanes, card memory) makes the program copy the GPU kernel and data into the card window, launch and poll; without `gpu` (or when the card is too small or the lanes do not divide the work) it runs the same work in a CPU loop. The line is identical either way, and the seed alone picks it. The game passes the first working GPU whose power lead is plugged at plug time. Needs a bus that has the card, so only `Machine` runs the card path; `runReference` runs the CPU path | ~600 to 3k on the CPU path (mandel up to ~10k at scale 4) |
| `secure.sign` | measure the job's data with the TPM, attest the measurement, hash it in protected mode, seal and unseal the digest, print its low 6 bits, e.g. `#07 secure 41 OK` (`4 x scale` data words). Needs a TPM on the bus; `runReference` has an instant fake one | a few hundred steps |
| `npu.infer` | a network of `min(6, 1 + scale)` dense layers `X <- relu(W X + b)` over an 8 x 8 batch with seeded weights, prints the sum of the final activations, e.g. `#07 infer 41 OK`. **Hardware-aware**: `generate(..., { npu, gpu })` picks the NPU path (data and `Layer` descriptors copied into card memory, one launch), else the GPU path (one layer kernel launched per layer), else a CPU loop; the line is the same on every path | ~2.7k steps per layer on the CPU path |
| `cli.scan` | fill then sum a RAM table at 0x4000 with a seeded stride (64 or 128 B, both cache-hostile: every load misses), prints `#72 scan 4x128B 0123 OK` | ~96 (heavy, one third of the starting economy mix) |
| `cli` | picks log / calc / checksum from the seed | 20-40 |

Measured on the reference interpreter (ecall included). The unpipelined engine takes 5 cycles per instruction plus cache-miss stalls, so a program alone is 100-200 CPU cycles; the pacing target is for a whole job including the boot ROM, see [`GAME.md`](GAME.md) "Pacing". Static text is emitted as packed `li`+`sw` word stores (about 3 instructions per 4 characters); only computed numbers go through `printDec`.

## Params, seeds, meta

`generate(template, seed, params?)`. Params: `scale` (1..16, default 1: more log lines, more rounds, more hash words, more scan elements), `row` (display row, default 0), `jobId` (0..99, default from the seed). The seed feeds `Prng` (`src/core/sim/prng.ts`); same inputs give byte-identical `asm`. Unknown templates or out-of-range params throw `RangeError`.

`meta`: `template`, `seed`, resolved `params`, `kernels` (`{kernel, ns, mix, footprintBytes}`), union `mix`, `expectedText` (display contents computed in TypeScript independently of the interpreter), `footprintBytes`, `codeWords`. `runReference(g)` runs the reference interpreter and returns `{steps, text, cpu}`; tests assert `text === meta.expectedText` and that the timed engines match.

Hosted programs: `generate(template, seed, {hosted: true})` replaces the final `ecall` with `li t0, ROM_DONE_VECTOR` + `jalr zero, t0, 0` so a program loaded from a USB key hands control back to the boot ROM (and normally gets `row: JOB_ROW` so its output sits below the POST lines). Everything else is identical, so the standalone tests and the reference interpreter are unchanged. Hosted code is loaded at `USER_BASE` 0x1000, so the code cap is `MAX_CODE_BYTES` 0x3000. See [`ASSEMBLY.md`](ASSEMBLY.md).

Memory use (standalone): code at 0, scan table at `BUF_BASE` 0x4000..0xC000, display and status windows only. Program size is capped at 0x3000 bytes (`MAX_CODE_BYTES`; hosted code starts at 0x1000 and must end below the scan buffer).

## Threaded programs

`Builder.finish(header, text, threads)` with `threads` > 1 makes a threaded program: the first instruction is the nop `addi zero, zero, T` (every engine runs it as a nop; the OS 4 kernel reads T from it), `meta.threads` is T (1 for every other template), and a `thread_end:` label before the final `ecall` is where a thread that is done jumps (a plain program jumps nowhere: it falls through). Thread k gets `a0 = k`, `a1 = T`; the shared words are `THREAD_SYNC` (barrier counter, 0x7f00) and `THREAD_PARTS` (0x7f40, per-thread partials). The reference runs T threads interleaved (`RefThreads`, `src/features/cpu/sim/ref/threads.ts`): a race-free program prints the same text under any interleaving. `threadtest.ts` has `parSum(T)`, a small test-only template (not a job clients send). Real threaded kinds are in `tasks.hpc.ts` (JOBS.md): `hpc.reduce`, `matmul`, `nbody` (2 threads), `montecarlo`, `sort` (4), `bfs`, `fft` (8); `HPC_THREADS` has the counts. They read T at run time, so a program started with a1 = 0 runs as one thread and prints the same text.

## Adding a template

1. Write a `TemplateFn`: draw parameters from `rng` (draw in a fixed order), call `b.add(K.something(b.ns("name")))` for kernels, `b.emit(...)` for main, `b.addData(...)` for data, and return `b.finish(header, expectedText)`. The shared pieces (the `Builder`, the display-line helpers, the parameter and result types) are in `build.ts`; the first templates are in `templates.ts`, and each group of jobs has its own file: `tasks.everyday.ts` (`cli.fib`, `cli.gcd`, `cli.popcount`, `cli.sort`, `cli.matmul`, `cli.reverse`, `cli.crc`), `tasks.memory.ts` (`mem.chase`, `mem.stream`, `mem.stencil`, `mem.transpose`, `mem.sieve`, `mem.hashtab`), `tasks.web.ts` (`web.page`, `web.api`, `web.dns`, `web.form`, `web.search`, `web.upload`, `web.video`, `web.image`), `tasks.trust.ts` (`secure.verify`, `secure.measure`, `secure.encrypt`, `secure.vault`, `secure.rotate`, `secure.attest`). The accelerator jobs are in `templates.ts`: `gpu.<kernel>` for each of the six GPU kernels (`gpuJob`, which `gpu.render` also uses to pick one by seed) and `npu.perceptron`, `npu.infer`, `npu.deep` (`npuJob`, the depth). Start the header with the template name (`# cli.fib request`): the job's name in the log is read from it for the mixed `cli` template.
2. Register it in `TEMPLATES` (a task file exports a record that `templates.ts` spreads in). A kind of job also needs an almanac entry (src/features/jobs/JOBS.md "The catalogue").
3. The generic tests loop over `TEMPLATE_NAMES`, so determinism, reference equality and engine equivalence are checked automatically. Add a pacing test if the template is meant to be a default.
