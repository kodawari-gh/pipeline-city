// The Trust jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

export const TRUST_HIGH_LEVEL: Record<string, HighLevel> = {
  secure: {
    cpp: `// secure.sign: measure, attest, hash in protected mode, seal, unseal
#include <cstdint>
uint32_t sign(Tpm& tpm, const uint32_t* data, int words, uint32_t handle) {
    uint32_t m = tpm.measure(data, words);       // the TPM hashes the data (a fixed, slow wait)
    tpm.attest(m);                               // a quote binding it
    tpm.protect(program_start, scratch_base);    // from here every RAM access pays the encryption surcharge
    uint32_t h = 5381;
    for (int i = 0; i < words; i++) h = ((h + (h << 5)) ^ data[i]);   // the same loop as the checksum, but slower
    tpm.unprotect();
    tpm.seal(handle, h);
    return tpm.unseal(handle) & 63;
}`,
    python: `# secure.sign: measure, attest, hash in protected mode, seal, unseal
def sign(tpm, data, handle):
    m = tpm.measure(data)               # the TPM hashes the data (a fixed, slow wait)
    tpm.attest(m)                       # a quote binding it
    tpm.protect()                       # from here every RAM access pays the encryption surcharge
    h = 5381
    for w in data:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF   # the same loop as the checksum, but slower
    tpm.unprotect()
    tpm.seal(handle, h)
    return tpm.unseal(handle) & 63`,
  },
  verify: {
    cpp: `// secure.verify: measure each block with the TPM and compare it with the digest promised for it
#include <cstdint>
extern uint32_t tpm_measure(const uint32_t* p, int words);   // writes ARG0, ARG1, CMD, polls STATUS, reads RESULT
uint32_t verify(const uint32_t* data, const uint32_t* promised, int blocks) {
    uint32_t sum = 0;
    for (int i = 0; i < blocks; i++) {
        uint32_t m = tpm_measure(data + 8 * i, 8);   // the module hashes it word by word on its own slow clock
        if (m == promised[i]) sum += m;              // bne: a block that was changed adds nothing
    }
    return sum & 1023;
}`,
    python: `# secure.verify: measure each block with the TPM and compare it with the digest promised for it
def verify(tpm, data, promised):
    total = 0
    for i, want in enumerate(promised):
        m = tpm.measure(data[8 * i: 8 * i + 8])      # the module hashes it word by word on its own slow clock
        if m == want:                                # bne: a block that was changed adds nothing
            total += m
    return total & 1023`,
  },
  measure: {
    cpp: `// secure.measure: a chain of measurements, as at a measured boot
#include <cstdint>
extern uint32_t tpm_measure(const uint32_t* p, int words);
uint32_t measured_boot(const uint32_t* stage, int blocks) {
    uint32_t chain = 5381;
    for (int i = 0; i < blocks; i++)
        chain = (chain + (chain << 5)) ^ tpm_measure(stage + 8 * i, 8);   // each stage is measured, then folded into the chain
    return chain & 1023;
}`,
    python: `# secure.measure: a chain of measurements, as at a measured boot
def measured_boot(tpm, stage, blocks):
    chain = 5381
    for i in range(blocks):
        m = tpm.measure(stage[8 * i: 8 * i + 8])
        chain = ((chain + (chain << 5)) ^ m) & 0xFFFFFFFF   # each stage is measured, then folded into the chain
    return chain & 1023`,
  },
  encrypt: {
    cpp: `// secure.encrypt: hash two buffers inside protected mode
#include <cstdint>
extern void tpm_protect(const void* lo, const void* hi);   // RAM outside the range is refused, and every access inside it costs extra
extern void tpm_unprotect();
uint32_t protected_hash(const uint32_t* a, const uint32_t* c, int n) {
    tpm_protect(program_start, scratch_buffer);
    uint32_t ha = 5381, hc = 5381;
    for (int i = 0; i < n; i++) ha = (ha + (ha << 5)) ^ a[i];   // every load pays the surcharge
    for (int i = 0; i < n; i++) hc = (hc + (hc << 5)) ^ c[i];
    tpm_unprotect();
    return (ha ^ hc) & 1023;
}`,
    python: `# secure.encrypt: hash two buffers inside protected mode
def protected_hash(tpm, a, c):
    tpm.protect()                                    # RAM outside the range is refused, and every access inside it costs extra
    ha = hc = 5381
    for w in a:
        ha = ((ha + (ha << 5)) ^ w) & 0xFFFFFFFF     # every load pays the surcharge
    for w in c:
        hc = ((hc + (hc << 5)) ^ w) & 0xFFFFFFFF
    tpm.unprotect()
    return (ha ^ hc) & 1023`,
  },
  vault: {
    cpp: `// secure.vault: seal several values under their own handles, then unseal them all
#include <cstdint>
extern void tpm_seal(uint32_t handle, uint32_t value);
extern uint32_t tpm_unseal(uint32_t handle);
uint32_t vault(const uint32_t* secrets, int n, uint32_t first_handle) {
    for (int i = 0; i < n; i++) tpm_seal(first_handle + i, secrets[i]);   // each command crosses the header and back
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) sum += tpm_unseal(first_handle + i);
    return sum & 1023;
}`,
    python: `# secure.vault: seal several values under their own handles, then unseal them all
def vault(tpm, secrets, first_handle):
    for i, s in enumerate(secrets):
        tpm.seal(first_handle + i, s)                # each command crosses the header and back
    return sum(tpm.unseal(first_handle + i) for i in range(len(secrets))) & 1023`,
  },
  rotate: {
    cpp: `// secure.rotate: unseal a value, change it, seal it again, round after round
#include <cstdint>
extern void tpm_seal(uint32_t handle, uint32_t value);
extern uint32_t tpm_unseal(uint32_t handle);
uint32_t rotate(uint32_t handle, uint32_t v0, int rounds, uint32_t m, uint32_t a) {
    tpm_seal(handle, v0);
    for (int i = 0; i < rounds; i++) {
        uint32_t v = tpm_unseal(handle);             // the next round needs the last one's answer
        tpm_seal(handle, v * m + a);                 // mul, addi, then the module again
    }
    return tpm_unseal(handle) & 1023;
}`,
    python: `# secure.rotate: unseal a value, change it, seal it again, round after round
def rotate(tpm, handle, v0, rounds, m, a):
    tpm.seal(handle, v0)
    for _ in range(rounds):
        v = tpm.unseal(handle)                       # the next round needs the last one's answer
        tpm.seal(handle, (v * m + a) & 0xFFFFFFFF)   # mul, addi, then the module again
    return tpm.unseal(handle) & 1023`,
  },
  attest: {
    cpp: `// secure.attest: a burst of quotes, counted (a quote is the machine's own random word: never shown)
#include <cstdint>
extern uint32_t tpm_attest(uint32_t nonce);
uint32_t attest_burst(uint32_t nonce, int quotes) {
    for (int i = 0; i < quotes; i++)
        tpm_attest(nonce);                           // the module works out each quote on its own slow clock
    return quotes & 1023;
}`,
    python: `# secure.attest: a burst of quotes, counted (a quote is the machine's own random word: never shown)
def attest_burst(tpm, nonce, quotes):
    for _ in range(quotes):
        tpm.attest(nonce)                            # the module works out each quote on its own slow clock
    return quotes & 1023`,
  },
};
