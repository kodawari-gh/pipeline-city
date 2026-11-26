// The Everyday jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

// `satisfies` keeps the keys, so highLevel.ts can point the web class at `calc`.
export const EVERYDAY_HIGH_LEVEL = {
  log: {
    cpp: `// cli.log: wait for the display, then write one status line per unit of scale
#include <cstdint>
extern volatile uint8_t display[16][64];     // memory-mapped text display
extern volatile uint32_t display_busy;        // reads 1 while the display is writing

void log_job(const char* const* lines, int scale, int row) {
    while (display_busy) { }                  // poll_idle: spin until the display is free
    for (int i = 0; i < scale; i++)           // one line per unit of scale
        for (int c = 0; lines[i][c]; c++)
            display[row + i][c] = lines[i][c]; // each store waits on the display
}`,
    python: `# cli.log: wait for the display, then write one status line per unit of scale
def log_job(display, lines, scale, row):
    while display.busy():                 # poll_idle: spin until the display is free
        pass
    for i in range(scale):                # one line per unit of scale
        for c, ch in enumerate(lines[i]):
            display[row + i][c] = ch      # each store waits on the display`,
  },
  calc: {
    cpp: `// cli.calc: x = x * m + a, repeated; show the low 6 bits
#include <cstdint>
uint32_t calc(uint32_t x, int rounds, uint32_t m, uint32_t a) {
    for (int i = 0; i < rounds; i++)
        x = x * m + a;                        // mul, then addi: each round needs the last result
    return x & 63;                            // andi, then print_dec
}`,
    python: `# cli.calc: x = x * m + a, repeated; show the low 6 bits
def calc(x, rounds, m, a):
    for _ in range(rounds):
        x = (x * m + a) & 0xFFFFFFFF      # mul, then addi: each round needs the last result
    return x & 63                         # andi, then print_dec`,
  },
  checksum: {
    cpp: `// cli.checksum: hash the data words that travel inside the program
#include <cstdint>
uint32_t checksum(const uint32_t* data, int words) {
    uint32_t h = 5381;
    for (int i = 0; i < words; i++)
        h = ((h + (h << 5)) ^ data[i]);       // lw, slli, add, xor: a load every round
    return h & 63;
}`,
    python: `# cli.checksum: hash the data words that travel inside the program
def checksum(data):
    h = 5381
    for w in data:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF   # lw, slli, add, xor: a load every round
    return h & 63`,
  },
  fib: {
    cpp: `// cli.fib: add the last two numbers, again and again
#include <cstdint>
uint32_t fib(uint32_t x, uint32_t y, int steps) {
    for (int i = 0; i < steps; i++) {
        uint32_t t = x + y;                   // add: needs both of the last two
        x = y; y = t;                         // two mv, no work of their own
    }
    return x & 63;
}`,
    python: `# cli.fib: add the last two numbers, again and again
def fib(x, y, steps):
    for _ in range(steps):
        x, y = y, (x + y) & 0xFFFFFFFF        # add: needs both of the last two
    return x & 63`,
  },
  reverse: {
    cpp: `// cli.reverse: write each word to the display backwards
#include <cstdint>
extern volatile uint8_t display[16][64];
void reverse(const char* word, int n, int row, int col) {
    for (int i = 0; i < n; i++)
        display[row][col + n - 1 - i] = word[i];   // lbu, then sb to the display
}`,
    python: `# cli.reverse: write each word to the display backwards
def reverse(display, word, row, col):
    for i, ch in enumerate(word):
        display[row][col + len(word) - 1 - i] = ch   # lbu, then sb to the display`,
  },
  gcd: {
    cpp: `// cli.gcd: the greatest common divisor of each pair, by subtraction, added up
#include <cstdint>
uint32_t gcd_sum(const uint32_t* pairs, int n) {
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) {
        uint32_t a = pairs[2 * i], b = pairs[2 * i + 1];
        while (a != b) {                      // beq: leave when they meet
            if (a < b) b -= a; else a -= b;   // blt: which way depends on the data
        }
        sum += a;
    }
    return sum & 63;
}`,
    python: `# cli.gcd: the greatest common divisor of each pair, by subtraction, added up
def gcd_sum(pairs):
    total = 0
    for a, b in pairs:
        while a != b:                         # beq: leave when they meet
            if a < b: b -= a                  # blt: which way depends on the data
            else: a -= b
        total += a
    return total & 63`,
  },
  popcount: {
    cpp: `// cli.popcount: count the 1 bits of each word, one shift at a time
#include <cstdint>
uint32_t pop_count(const uint32_t* data, int words) {
    uint32_t bits = 0;
    for (int i = 0; i < words; i++)
        for (uint32_t w = data[i]; w; w >>= 1)   // beq: stop when the word is empty
            bits += w & 1;                       // andi, add, srli: per bit
    return bits & 63;
}`,
    python: `# cli.popcount: count the 1 bits of each word, one shift at a time
def pop_count(data):
    bits = 0
    for w in data:
        while w:                              # beq: stop when the word is empty
            bits += w & 1                     # andi, add, srli: per bit
            w >>= 1
    return bits & 63`,
  },
  sort: {
    cpp: `// cli.sort: insertion sort in memory, then a checksum that needs every number in place
#include <cstdint>
uint32_t sort_check(uint32_t* a, const uint32_t* src, int n) {
    for (int i = 0; i < n; i++) a[i] = src[i];        // the copy: lw, sw
    for (int i = 1; i < n; i++) {
        uint32_t key = a[i]; int j = i;
        while (j > 0 && a[j - 1] > key) { a[j] = a[j - 1]; j--; }   // lw, compare, sw: data decides how far
        a[j] = key;
    }
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) sum += (i + 1) * a[i]; // mul: position times value
    return sum & 1023;
}`,
    python: `# cli.sort: insertion sort in memory, then a checksum that needs every number in place
def sort_check(src):
    a = list(src)                             # the copy: lw, sw
    for i in range(1, len(a)):
        key, j = a[i], i
        while j > 0 and a[j - 1] > key:       # lw, compare, sw: data decides how far
            a[j] = a[j - 1]; j -= 1
        a[j] = key
    return sum((i + 1) * v for i, v in enumerate(a)) & 1023   # mul: position times value`,
  },
  matmul: {
    cpp: `// cli.matmul: the sum of the elements of A x B, element by element
#include <cstdint>
uint32_t mat_mul(const uint32_t* A, const uint32_t* B, int n) {
    uint32_t total = 0;
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            for (int k = 0; k < n; k++)
                total += A[i * n + k] * B[k * n + j];   // two index multiplies, two loads, one product
    return total & 1023;
}`,
    python: `# cli.matmul: the sum of the elements of A x B, element by element
def mat_mul(A, B, n):
    total = 0
    for i in range(n):
        for j in range(n):
            for k in range(n):
                total += A[i * n + k] * B[k * n + j]    # two index multiplies, two loads, one product
    return total & 1023`,
  },
  crc: {
    cpp: `// cli.crc: CRC-32 (reflected, 0xEDB88320) of each word, a bit at a time
#include <cstdint>
uint32_t crc32(const uint32_t* data, int words) {
    uint32_t crc = 0xFFFFFFFF;
    for (int i = 0; i < words; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 32; bit++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;   // beq on the low bit: half go each way
    }
    return ~crc & 1023;
}`,
    python: `# cli.crc: CRC-32 (reflected, 0xEDB88320) of each word, a bit at a time
def crc32(data):
    crc = 0xFFFFFFFF
    for w in data:
        crc ^= w
        for _ in range(32):
            crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1   # beq on the low bit: half go each way
    return ~crc & 1023`,
  },
} satisfies Record<string, HighLevel>;
