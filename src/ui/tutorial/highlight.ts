// Syntax colouring for the almanac's code views: assembly (the machine's own, coloured by what each instruction does), C++ and Python.
// Pure: text in, a list of coloured pieces out (`Tok`), so the view only has to draw them and tests can read them.

import { opClassOf, type OpClass } from '../../sim/game/jobcode';

export type Lang = 'asm' | 'cpp' | 'python';

/** A coloured piece of text: `k` is the kind (a CSS class suffix), and for an assembly mnemonic `cls` is the instruction class. */
export interface Tok { t: string; k: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'func' | 'label' | 'reg' | 'op' | 'directive' | 'punct' | 'pre'; cls?: OpClass }

const REGS = new Set(['zero', 'ra', 'sp', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 's0', 's1', 's2', 's3']);
const MNEMONICS = new Set(['add', 'sub', 'and', 'or', 'xor', 'sll', 'srl', 'sra', 'slt', 'sltu', 'mul', 'addi', 'andi', 'ori', 'xori', 'slli', 'srli', 'srai', 'slti', 'lw', 'lb', 'lbu', 'sw', 'sb',
  'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr', 'lui', 'ecall', 'iret',
  // the assembler's pseudo-instructions
  'li', 'la', 'mv', 'j', 'call', 'ret', 'nop', 'not', 'neg', 'beqz', 'bnez', 'seqz']);
const PSEUDO_CLASS: Record<string, OpClass> = { li: 'alu', la: 'alu', mv: 'alu', nop: 'alu', not: 'alu', neg: 'alu', seqz: 'alu', j: 'br', call: 'br', ret: 'br', beqz: 'br', bnez: 'br' };

const CPP_KW = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'const', 'static', 'extern', 'volatile', 'struct', 'class', 'namespace', 'using', 'new', 'delete', 'inline', 'constexpr', 'auto', 'true', 'false', 'nullptr', 'sizeof']);
const CPP_TYPES = new Set(['void', 'int', 'char', 'bool', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'uint8_t', 'uint16_t', 'uint32_t', 'int32_t', 'uint64_t', 'uintptr_t', 'size_t', 'Tpm']);
const PY_KW = new Set(['def', 'return', 'for', 'while', 'in', 'if', 'elif', 'else', 'pass', 'import', 'from', 'as', 'with', 'class', 'lambda', 'and', 'or', 'not', 'is', 'None', 'True', 'False', 'break', 'continue']);
const PY_BUILTINS = new Set(['range', 'sum', 'max', 'min', 'len', 'zip', 'enumerate', 'print', 'abs']);

type Rule = [RegExp, (m: RegExpExecArray, out: Tok[]) => Tok[]];

const tok = (t: string, k: Tok['k'], cls?: OpClass): Tok => (cls ? { t, k, cls } : { t, k });

function lex(text: string, rules: Rule[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (t: Tok) => { const last = out[out.length - 1]; if (last && last.k === t.k && !t.cls && !last.cls && (t.k === 'plain' || t.k === 'punct')) last.t += t.t; else out.push(t); };
  while (i < text.length) {
    let hit = false;
    for (const [re, make] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m.index === i && m[0].length > 0) {
        for (const t of make(m, out)) push(t);
        i += m[0].length;
        hit = true;
        break;
      }
    }
    if (!hit) { push(tok(text[i]!, 'plain')); i++; }
  }
  return out;
}

const NUM = /0x[0-9a-fA-F]+|\b\d+\b/y;

const ASM: Rule[] = [
  [/#[^\n]*/y, (m) => [tok(m[0], 'comment')]],
  [/\.[a-z]+/y, (m) => [tok(m[0], 'directive')]],
  [/[A-Za-z_][\w.]*:/y, (m) => [tok(m[0], 'label')]],
  [/[A-Za-z_][\w.]*/y, (m, out) => {
    const w = m[0];
    if (REGS.has(w)) return [tok(w, 'reg')];
    const first = out.every((t) => t.k === 'label' || (t.k === 'plain' && t.t.trim() === '')); // the first word of a line is the instruction
    if (first && MNEMONICS.has(w)) return [tok(w, 'op', PSEUDO_CLASS[w] ?? opClassOf(w))];
    return [tok(w, 'label')]; // a branch or call target
  }],
  [/-?0x[0-9a-fA-F]+|-?\d+/y, (m) => [tok(m[0], 'number')]],
  [/[,()+\-]/y, (m) => [tok(m[0], 'punct')]],
];

const CPP: Rule[] = [
  [/\/\/[^\n]*/y, (m) => [tok(m[0], 'comment')]],
  [/\/\*[\s\S]*?\*\//y, (m) => [tok(m[0], 'comment')]],
  [/#\s*\w+[^\n]*/y, (m) => [tok(m[0], 'pre')]],
  [/"(?:[^"\\\n]|\\.)*"/y, (m) => [tok(m[0], 'string')]],
  [/0x[0-9a-fA-F]+|\b\d+\b/y, (m) => [tok(m[0], 'number')]],
  [/[A-Za-z_]\w*/y, (m) => {
    const w = m[0];
    if (CPP_KW.has(w)) return [tok(w, 'keyword')];
    if (CPP_TYPES.has(w)) return [tok(w, 'type')];
    return [tok(w, 'plain')];
  }],
  [/[{}()[\];,.<>=+\-*/&|^!~%?:]/y, (m) => [tok(m[0], 'punct')]],
];

const PY: Rule[] = [
  [/#[^\n]*/y, (m) => [tok(m[0], 'comment')]],
  [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y, (m) => [tok(m[0], 'string')]],
  [/0x[0-9a-fA-F]+|\b\d+\b/y, (m) => [tok(m[0], 'number')]],
  [/[A-Za-z_]\w*/y, (m, out) => {
    const w = m[0], prev = [...out].reverse().find((t) => !(t.k === 'plain' && t.t.trim() === ''));
    if (PY_KW.has(w)) return [tok(w, 'keyword')];
    if (prev && prev.k === 'keyword' && prev.t === 'def') return [tok(w, 'func')];
    if (PY_BUILTINS.has(w)) return [tok(w, 'type')];
    return [tok(w, 'plain')];
  }],
  [/[{}()[\];,.<>=+\-*/&|^!~%?:]/y, (m) => [tok(m[0], 'punct')]],
];

/** Colour `text` as `lang`. The pieces join back to exactly `text`. */
export function highlight(lang: Lang, text: string): Tok[] {
  void NUM;
  return lex(text, lang === 'asm' ? ASM : lang === 'cpp' ? CPP : PY);
}

/** One line at a time (what the listing draws), keeping the pieces of a multi-line comment together is not needed for the code shown. */
export function highlightLines(lang: Lang, text: string): Tok[][] {
  return text.split('\n').map((l) => highlight(lang, l));
}
