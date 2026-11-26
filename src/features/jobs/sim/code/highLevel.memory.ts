// The Memory-hungry jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

export const MEMORY_HIGH_LEVEL: Record<string, HighLevel> = {
  scan: {
    cpp: `// cli.scan: fill a buffer at a stride, then sum it
#include <cstdint>
uint32_t scan(uint8_t* buf, int count, int stride_bytes, uint32_t start) {
    uint8_t* p = buf;
    for (int i = 0; i < count; i++, p += stride_bytes)
        *(uint32_t*)p = start + 3 * i;       // fill_stride: one store per element, each on a new cache line
    uint32_t sum = 0;
    p = buf;
    for (int i = 0; i < count; i++, p += stride_bytes)
        sum += *(uint32_t*)p;                // array_sum: one load per element
    return sum & 1023;
}`,
    python: `# cli.scan: fill a buffer at a stride, then sum it
def scan(mem, buf, count, stride, start):
    for i in range(count):
        mem.store32(buf + i * stride, start + 3 * i)   # fill_stride: each on a new cache line
    total = 0
    for i in range(count):
        total += mem.load32(buf + i * stride)          # array_sum
    return total & 1023`,
  },
  chase: {
    cpp: `// mem.chase: build a ring of 64-byte nodes, then follow it
#include <cstdint>
uint32_t chase(uint8_t* base, int nodes, int steps) {
    for (int i = 0; i < nodes; i++)
        *(uint32_t*)(base + 64 * i) = (uint32_t)(base + 64 * ((5 * i + 1) & (nodes - 1)));   // chase_build: store the next address
    uint32_t p = (uint32_t)base;
    for (int s = 0; s < steps; s++)
        p = *(uint32_t*)p;                       // chase_walk: one load, and the next one needs its answer
    return ((p - (uint32_t)base) >> 6) & 1023;
}`,
    python: `# mem.chase: build a ring of 64-byte nodes, then follow it
def chase(mem, base, nodes, steps):
    for i in range(nodes):
        mem.store32(base + 64 * i, base + 64 * ((5 * i + 1) & (nodes - 1)))   # chase_build: store the next address
    p = base
    for _ in range(steps):
        p = mem.load32(p)                        # chase_walk: one load, and the next one needs its answer
    return ((p - base) >> 6) & 1023`,
  },
  stream: {
    cpp: `// mem.stream: fill a block, copy it, hash the copy
#include <cstdint>
uint32_t stream(uint32_t* src, uint32_t* dst, int words, uint32_t start) {
    for (int i = 0; i < words; i++) src[i] = start + 3 * i;     // fill_stride: in order
    for (int i = 0; i < words; i++) dst[i] = src[i];            // copy_block: lw, sw, each the next address
    uint32_t h = 5381;
    for (int i = 0; i < words; i++) h = (h + (h << 5)) ^ dst[i]; // checksum over the copy
    return h & 1023;
}`,
    python: `# mem.stream: fill a block, copy it, hash the copy
def stream(mem, src, dst, words, start):
    for i in range(words):
        mem.store32(src + 4 * i, start + 3 * i)                 # fill_stride: in order
    for i in range(words):
        mem.store32(dst + 4 * i, mem.load32(src + 4 * i))       # copy_block: lw, sw, each the next address
    h = 5381
    for i in range(words):
        h = ((h + (h << 5)) ^ mem.load32(dst + 4 * i)) & 0xFFFFFFFF   # checksum over the copy
    return h & 1023`,
  },
  stencil: {
    cpp: `// mem.stencil: each output is the sum of three neighbours
#include <cstdint>
uint32_t stencil(const uint32_t* a, uint32_t* out, int n) {
    uint32_t sum = 0;
    for (int i = 1; i < n - 1; i++) {
        out[i] = a[i - 1] + a[i] + a[i + 1];     // three loads, two adds, one store: most of the loads were seen last round
        sum += out[i];
    }
    return sum & 1023;
}`,
    python: `# mem.stencil: each output is the sum of three neighbours
def stencil(a, out):
    total = 0
    for i in range(1, len(a) - 1):
        out[i] = a[i - 1] + a[i] + a[i + 1]      # three loads, two adds, one store: most of the loads were seen last round
        total += out[i]
    return total & 1023`,
  },
  transpose: {
    cpp: `// mem.transpose: read along the rows, write down the columns
#include <cstdint>
uint32_t transpose(const uint32_t* src, uint32_t* dst, int n) {
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            dst[j * n + i] = src[i * n + j];     // the load walks in order, the store jumps a whole row
    uint32_t sum = 0;
    for (int k = 0; k < n * n; k++) sum += dst[k] * ((k & 7) + 1);   // weighted_sum: wrong only if a word moved
    return sum & 1023;
}`,
    python: `# mem.transpose: read along the rows, write down the columns
def transpose(src, n):
    dst = [0] * (n * n)
    for i in range(n):
        for j in range(n):
            dst[j * n + i] = src[i * n + j]      # the load walks in order, the store jumps a whole row
    return sum(v * ((k & 7) + 1) for k, v in enumerate(dst)) & 1023   # weighted_sum`,
  },
  sieve: {
    cpp: `// mem.sieve: count the primes below n with a byte of flags each
#include <cstdint>
uint32_t sieve(uint8_t* flags, int n) {
    for (int i = 0; i < n; i++) flags[i] = 0;    // clear the flags
    uint32_t primes = 0;
    for (int i = 2; i < n; i++) {
        if (flags[i]) continue;                  // lbu, bne: a composite already
        primes++;
        for (int j = i * i; j < n; j += i) flags[j] = 1;   // sb: cross off the multiples
    }
    return primes & 1023;
}`,
    python: `# mem.sieve: count the primes below n with a byte of flags each
def sieve(n):
    flags = bytearray(n)                         # clear the flags
    primes = 0
    for i in range(2, n):
        if flags[i]:
            continue                             # lbu, bne: a composite already
        primes += 1
        for j in range(i * i, n, i):
            flags[j] = 1                         # sb: cross off the multiples
    return primes & 1023`,
  },
  hashtab: {
    cpp: `// mem.hashtab: put keys in a 256-slot table in the heap, then look them all up
#include <cstdint>
const uintptr_t HEAP = 0x10000;                  // the big heap, as for the index job
uint32_t hashtab(const uint32_t* keys, int n) {
    uint32_t* table = (uint32_t*)HEAP;
    for (int i = 0; i < 256; i++) table[i] = 0;  // zero_words
    for (int i = 0; i < n; i++) {
        uint32_t s = (keys[i] * 2654435761u) >> 24;          // mul, srli: the slot, scattered over the table
        while (table[s]) s = (s + 1) & 255;                  // a clash steps to the next slot
        table[s] = keys[i];
    }
    uint32_t looked = 0;
    for (int i = 0; i < n; i++) {
        uint32_t s = (keys[i] * 2654435761u) >> 24;
        looked++;
        while (table[s] != keys[i]) { s = (s + 1) & 255; looked++; }
    }
    return looked & 1023;
}`,
    python: `# mem.hashtab: put keys in a 256-slot table in the heap, then look them all up
def hashtab(mem, keys, heap=0x10000):
    for i in range(256):
        mem.store32(heap + 4 * i, 0)             # zero_words
    for k in keys:
        s = ((k * 2654435761) & 0xFFFFFFFF) >> 24            # mul, srli: the slot, scattered over the table
        while mem.load32(heap + 4 * s):
            s = (s + 1) & 255                    # a clash steps to the next slot
        mem.store32(heap + 4 * s, k)
    looked = 0
    for k in keys:
        s = ((k * 2654435761) & 0xFFFFFFFF) >> 24
        looked += 1
        while mem.load32(heap + 4 * s) != k:
            s = (s + 1) & 255
            looked += 1
    return looked & 1023`,
  },
  db: {
    cpp: `// db.index: build a table of 256-byte records, then answer scattered lookups
#include <cstdint>
const uintptr_t HEAP = 0x10000;                // the big heap: virtual 0x10000 up on every OS
uint32_t index_job(int rows, uint32_t mult) {  // rows is a power of two
    for (int i = 0; i < rows; i++)
        *(uint32_t*)(HEAP + 256 * i) = 7 * i + 3;   // index_fill: touches every page once
    uint32_t sum = 0;
    for (int j = 0; j < rows / 2; j++) {
        uint32_t row = (j * mult) & (rows - 1);     // index_probe: a multiply, a mask...
        sum += *(uint32_t*)(HEAP + 256 * row);      // ...and a load that lands anywhere in the table
    }
    return sum & 1023;
}`,
    python: `# db.index: build a table of 256-byte records, then answer scattered lookups
HEAP = 0x10000                                 # the big heap: virtual 0x10000 up on every OS
def index_job(mem, rows, mult):                # rows is a power of two
    for i in range(rows):
        mem.store32(HEAP + 256 * i, 7 * i + 3)         # index_fill: touches every page once
    total = 0
    for j in range(rows // 2):
        row = (j * mult) & (rows - 1)                  # index_probe: a multiply, a mask...
        total += mem.load32(HEAP + 256 * row)          # ...and a load that lands anywhere
    return total & 1023`,
  },
};
