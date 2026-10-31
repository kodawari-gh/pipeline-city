import { decode, REG_NAMES, SPEC_BY_NAME } from "./isa";

const r = (n: number): string => REG_NAMES[n] ?? `x${n}`;

/** Word -> mnemonic text, in the syntax the assembler accepts (branch/jal offsets are raw byte offsets). */
export function disassemble(word: number): string {
  const i = decode(word);
  if (!i) return `.word 0x${(word >>> 0).toString(16).padStart(8, "0")}`;
  const spec = SPEC_BY_NAME.get(i.name)!;
  switch (spec.fmt) {
    case "N": return i.name;
    case "R": return spec.amo ? `${i.name} ${r(i.rd)}, ${r(i.rs2)}, (${r(i.rs1)})` : `${i.name} ${r(i.rd)}, ${r(i.rs1)}, ${r(i.rs2)}`;
    case "I":
      return spec.mem
        ? `${i.name} ${r(i.rd)}, ${i.imm}(${r(i.rs1)})`
        : `${i.name} ${r(i.rd)}, ${r(i.rs1)}, ${i.imm}`;
    case "S": return `${i.name} ${r(i.rs2)}, ${i.imm}(${r(i.rs1)})`;
    case "B": return `${i.name} ${r(i.rs1)}, ${r(i.rs2)}, ${i.imm}`;
    case "U": return `${i.name} ${r(i.rd)}, 0x${i.imm.toString(16)}`;
    case "J": return `${i.name} ${r(i.rd)}, ${i.imm}`;
  }
}
