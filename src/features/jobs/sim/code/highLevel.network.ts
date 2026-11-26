// The Network jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

export const NETWORK_HIGH_LEVEL: Record<string, HighLevel> = {
  page: {
    cpp: `// web.page: put the response together from its parts, then hash it
#include <cstdint>
uint32_t page(const uint32_t* body, uint32_t* out, int n) {
    for (int i = 0; i < n; i++) out[i] = body[i];          // copy_block: lw, sw
    uint32_t h = 5381;
    for (int i = 0; i < n; i++) h = (h + (h << 5)) ^ out[i]; // checksum of what is sent
    return h & 1023;
}`,
    python: `# web.page: put the response together from its parts, then hash it
def page(body):
    out = list(body)                                       # copy_block: lw, sw
    h = 5381
    for w in out:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF              # checksum of what is sent
    return h & 1023`,
  },
  api: {
    cpp: `// web.api: the total of an order, price times quantity for each line
#include <cstdint>
uint32_t api_total(const uint32_t* price, const uint32_t* qty, int lines) {
    uint32_t total = 0;
    for (int i = 0; i < lines; i++)
        total += price[i] * qty[i];                        // two loads and a mul for every line
    return total & 1023;
}`,
    python: `# web.api: the total of an order, price times quantity for each line
def api_total(price, qty):
    return sum(p * q for p, q in zip(price, qty)) & 1023   # two loads and a mul for every line`,
  },
  dns: {
    cpp: `// web.dns: look each name up in a sorted table by halving it
#include <cstdint>
uint32_t dns(const uint32_t* table, int size, const uint32_t* names, int n) {
    uint32_t sum = 0;
    for (int k = 0; k < n; k++) {
        int lo = 0, hi = size - 1;
        while (lo <= hi) {                                 // blt: stop when the range is empty
            int mid = (lo + hi) >> 1;
            if (table[mid] == names[k]) { sum += mid; break; }
            if (table[mid] < names[k]) lo = mid + 1; else hi = mid - 1;   // which way depends on the name
        }
    }
    return sum & 1023;
}`,
    python: `# web.dns: look each name up in a sorted table by halving it
def dns(table, names):
    total = 0
    for name in names:
        lo, hi = 0, len(table) - 1
        while lo <= hi:                                    # blt: stop when the range is empty
            mid = (lo + hi) >> 1
            if table[mid] == name:
                total += mid
                break
            if table[mid] < name: lo = mid + 1             # which way depends on the name
            else: hi = mid - 1
    return total & 1023`,
  },
  form: {
    cpp: `// web.form: count the digits and the capital letters of what was typed
#include <cstdint>
uint32_t form_check(const uint8_t* text, int n) {
    uint32_t digits = 0, caps = 0;
    for (int i = 0; i < n; i++) {
        digits += (uint8_t)(text[i] - '0') < 10;           // addi, sltiu: a range test with no branch
        caps   += (uint8_t)(text[i] - 'A') < 26;
    }
    return (digits + 2 * caps) & 1023;
}`,
    python: `# web.form: count the digits and the capital letters of what was typed
def form_check(text):
    digits = sum(1 for c in text if 48 <= c <= 57)         # addi, sltiu: a range test with no branch
    caps = sum(1 for c in text if 65 <= c <= 90)
    return (digits + 2 * caps) & 1023`,
  },
  search: {
    cpp: `// web.search: count where a pair of letters occurs in the text
#include <cstdint>
uint32_t search(const uint8_t* text, int n, uint8_t c0, uint8_t c1) {
    uint32_t hits = 0;
    for (int i = 0; i < n; i++)
        if (text[i] == c0 && text[i + 1] == c1)            // the second load only when the first matched
            hits++;
    return hits & 1023;
}`,
    python: `# web.search: count where a pair of letters occurs in the text
def search(text, c0, c1):
    return sum(1 for i in range(len(text) - 1)
               if text[i] == c0 and text[i + 1] == c1) & 1023   # the second load only when the first matched`,
  },
  upload: {
    cpp: `// web.upload: scan the file that arrived for words that carry a signature
#include <cstdint>
uint32_t upload_scan(const uint32_t* file, int n, uint32_t mask, uint32_t sig) {
    uint32_t hits = 0;
    for (int i = 0; i < n; i++)
        if ((file[i] & mask) == sig) hits++;               // lw, and, bne for every word
    return hits & 1023;
}`,
    python: `# web.upload: scan the file that arrived for words that carry a signature
def upload_scan(file, mask, sig):
    return sum(1 for w in file if (w & mask) == sig) & 1023   # lw, and, bne for every word`,
  },
  video: {
    cpp: `// web.video: filter every sample of a chunk
#include <cstdint>
uint32_t video(const uint32_t* chunk, int n) {
    uint32_t sum = 0;
    for (int i = 0; i < n; i++)
        sum += (chunk[i] * 3 + 1) >> 1;                    // a mul, an add and a shift for every sample
    return sum & 1023;
}`,
    python: `# web.video: filter every sample of a chunk
def video(chunk):
    return sum(((w * 3 + 1) & 0xFFFFFFFF) >> 1 for w in chunk) & 1023   # a mul, an add and a shift for every sample`,
  },
  image: {
    cpp: `// web.image: shrink a square byte image to half size by averaging 2 x 2
#include <cstdint>
uint32_t image(const uint8_t* px, int w) {
    uint32_t sum = 0;
    for (int r = 0; r < w; r += 2)
        for (int c = 0; c < w; c += 2)
            sum += (px[r * w + c] + px[r * w + c + 1] + px[(r + 1) * w + c] + px[(r + 1) * w + c + 1]) >> 2;   // four lbu, three adds, a shift
    return sum & 1023;
}`,
    python: `# web.image: shrink a square byte image to half size by averaging 2 x 2
def image(px, w):
    total = 0
    for r in range(0, w, 2):
        for c in range(0, w, 2):
            total += (px[r*w + c] + px[r*w + c + 1] + px[(r+1)*w + c] + px[(r+1)*w + c + 1]) >> 2   # four lbu, three adds, a shift
    return total & 1023`,
  },
};
