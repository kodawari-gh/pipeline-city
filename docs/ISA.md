# Toy ISA

Code: `src/sim/isa` (definition, encode/decode, disassembler, memory map), `src/sim/asm` (assembler), `src/sim/ref` (reference interpreter). Opcodes are our own, RISC-V-shaped but not compatible.

## Basics

32-bit words, little-endian, byte-addressed, 16 registers, fixed 4-byte instructions. Branch and jump offsets are in bytes (multiples of 4) relative to the instruction itself, so code is position independent.

Registers: `x0 zero` (always 0), `x1 ra` (link), `x2 sp` (stack, grows down, starts at top of RAM), `x3-x6 a0-a3` (args/results), `x7-x11 t0-t4` (temporaries), `x12-x15 s0-s3` (saved). Both `a0` and `x3` spellings assemble.

## Formats

Opcode is always bits [6:0]; every mnemonic has its own opcode (no funct fields).

| Fmt | Fields |
|---|---|
| R | rd[10:7] rs1[14:11] rs2[18:15] |
| I | rd[10:7] rs1[14:11] imm[31:15] (17-bit signed) |
| S | imm[3:0]=[10:7] rs1[14:11] rs2[18:15] imm[16:4]=[31:19] |
| B | as S; imm is a byte offset, multiple of 4 |
| U | rd[10:7] imm[31:11] (21 bits) |
| J | rd[10:7] imm[31:11] (21-bit signed byte offset, multiple of 4) |

## Opcodes

| Fmt | Mnemonics (opcode) |
|---|---|
| R | add 01, sub 02, and 03, or 04, xor 05, sll 06, srl 07, sra 08, slt 09, sltu 0a, mul 0b (low 32 bits) |
| I | addi 10, andi 11, ori 12, xori 13, slli 14, srli 15, srai 16, slti 17, sltiu 18, jalr 19 |
| I (loads) | lw 20, lb 21 (sign-extend), lbu 22 |
| S | sw 28, sb 29 |
| R (atomics) | amoadd 2a, amoswap 2b: `amoadd rd, rs2, (rs1)`. One step: `rd = mem[rs1]; mem[rs1] = rd + rs2` (amoswap: `= rs2`). `rs1` must be a word-aligned RAM address, else a fault. Always served by the L2 (never the L1), see [`ENGINES.md`](ENGINES.md) |
| B | beq 30, bne 31, blt 32, bge 33, bltu 34, bgeu 35 |
| U | lui 38 (`rd = imm << 11`), auipc 39 (`rd = pc + (imm << 11)`) |
| J | jal 40 (`rd = pc+4; pc += imm`) |
| - | ecall 70: end of a standalone program, halts the core. A program run from a USB key ("hosted") ends by jumping to the boot ROM's done vector instead, see [`ASSEMBLY.md`](ASSEMBLY.md) |
| - | iret 71: return from an interrupt handler. `pc` = the interrupt controller's EPC register, interrupts back on when it retires. Predicted not taken like `jalr`. See [`CPU.md`](CPU.md) |

`jalr rd, rs1, imm`: `rd = pc+4; pc = (rs1+imm) & ~3`. Word loads/stores must be 4-aligned. Opcode 0 is illegal on purpose. Shifts use the low 5 bits of the amount.

## Memory map

| Range | What |
|---|---|
| `0x0000_0000` + RAM size (64 KiB default) | RAM, program loaded at 0, PC starts at 0 |
| `0x4000_0000`, 4 KiB window | Text display: 64x16 ASCII bytes, row-major |
| `0x4001_0000`, 4 KiB window | Device status/command registers |
| `0x4002_0000`, 20 KiB window | PCH: USB host registers, key program window, result window (see [`ASSEMBLY.md`](ASSEMBLY.md)) |
| `0x4003_0000` + k x 4 KiB | Storage ports (see [`OS.md`](OS.md)) |
| `0x4004_0000`, 256 B | Interrupt controller (see [`CPU.md`](CPU.md)) |

Constants live in `src/sim/isa/memmap.ts`. Display and status are plain memory in the reference interpreter for now.

## Assembly syntax

`label:`, comments with `#` or `;`, operands `rd, rs1, rs2` / `rd, rs1, imm` / `lw rd, imm(rs1)` / `sw rs2, imm(rs1)` / `beq rs1, rs2, target`. Targets are labels or raw byte offsets. Numbers: decimal, `0x`, `0b`, `'c'`.

Directives: `.string "text"` (NUL-terminated, escapes `\n \t \r \0 \\ \"`), `.byte n,...`, `.word n|label,...`, `.align` (pad to 4). Instructions and `.word` must be word aligned, so put `.align` after bytes/strings.

Pseudo-instructions:

| Pseudo | Expands to |
|---|---|
| `nop` | `addi zero, zero, 0` |
| `mv rd, rs` | `addi rd, rs, 0` |
| `li rd, n` | `addi rd, zero, n` if n fits 17 bits signed, else `lui` (+ `addi` if the low 11 bits are non-zero). n must be a literal |
| `la rd, label` | `auipc` + `addi` (always 2 words, PC-relative) |
| `j label` | `jal zero, label` |
| `call label` | `jal ra, label` |
| `ret` | `jalr zero, ra, 0` |

Errors are `AsmError` with `line` set and messages prefixed `line N:`.
