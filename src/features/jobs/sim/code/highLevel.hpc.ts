// The High-performance jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

export const HPC_HIGH_LEVEL: Record<string, HighLevel> = {
  'hpc-reduce': {
    cpp: `// hpc.reduce: each thread folds its share of the array; the partial sums are added into one total
#include <atomic>
#include <cstdint>
std::atomic<int32_t> total;
void worker(const int32_t* a, int n, int k, int T) {
    int32_t part = 0;
    for (int i = k * n / T; i < (k + 1) * n / T; i++)
        part += a[i] * a[i] + (a[i] >> 3);
    total += part;                                   // amoadd
}`,
    python: `# hpc.reduce: each thread folds its share of the list; the partial sums are added into one total
def worker(a, k, T, total):
    n = len(a)
    part = sum(x * x + (x >> 3) for x in a[k * n // T:(k + 1) * n // T])
    total.add(part)                                  # an atomic add`,
  },
  'hpc-matmul': {
    cpp: `// hpc.matmul: C = A x B (8 x K by K x 8); each thread computes its rows of C and adds them up
void worker(const int32_t* A, const int32_t* B, int K, int k, int T, std::atomic<int32_t>& total) {
    int32_t part = 0;
    for (int i = k * 8 / T; i < (k + 1) * 8 / T; i++)
        for (int j = 0; j < 8; j++)
            for (int x = 0; x < K; x++)
                part += A[i * K + x] * B[x * 8 + j];   // a multiply each
    total += part;
}`,
    python: `# hpc.matmul: C = A x B (8 x K by K x 8); each thread computes its rows of C and adds them up
def worker(A, B, K, k, T, total):
    rows = range(k * 8 // T, (k + 1) * 8 // T)
    total.add(sum(A[i][x] * B[x][j] for i in rows for j in range(8) for x in range(K)))`,
  },
  'hpc-nbody': {
    cpp: `// hpc.nbody: every body moves by the pull of all the others, from the positions of the step before; a barrier ends each step
void worker(int32_t* pos[2], const int32_t* mass, int steps, int k, int T, Barrier& bar) {
    for (int s = 0; s < steps; s++) {
        const int32_t* now = pos[s & 1]; int32_t* next = pos[(s & 1) ^ 1];
        for (int i = k * 16 / T; i < (k + 1) * 16 / T; i++) {
            int32_t pull = 0;
            for (int j = 0; j < 16; j++) pull += (now[j] - now[i]) * mass[j];
            next[i] = now[i] + (pull >> 8);
        }
        bar.wait();                                    // nobody starts the next step early
    }
}`,
    python: `# hpc.nbody: every body moves by the pull of all the others, from the positions of the step before; a barrier ends each step
def worker(pos, mass, steps, k, T, barrier):
    for s in range(steps):
        now, nxt = pos[s & 1], pos[(s & 1) ^ 1]
        for i in range(k * 16 // T, (k + 1) * 16 // T):
            pull = sum((now[j] - now[i]) * mass[j] for j in range(16))
            nxt[i] = now[i] + (pull >> 8)
        barrier.wait()`,
  },
  'hpc-montecarlo': {
    cpp: `// hpc.montecarlo: a point is a hash of its number; count the ones inside the quarter circle
void worker(int n, int k, int T, std::atomic<int32_t>& hits) {
    int32_t mine = 0;
    for (int i = k * n / T; i < (k + 1) * n / T; i++) {
        uint32_t h = (uint32_t)(i + 1) * 0x9e3779b1u;
        uint32_t x = h >> 24, y = (h >> 16) & 255;
        if (x * x + y * y < 65536) mine++;
    }
    hits += mine;
}`,
    python: `# hpc.montecarlo: a point is a hash of its number; count the ones inside the quarter circle
def worker(n, k, T, hits):
    mine = 0
    for i in range(k * n // T, (k + 1) * n // T):
        h = ((i + 1) * 0x9e3779b1) & 0xffffffff
        x, y = h >> 24, (h >> 16) & 255
        mine += x * x + y * y < 65536
    hits.add(mine)`,
  },
  'hpc-sort': {
    cpp: `// hpc.sort: each thread sorts its run (bubble sort), then thread 0 merges the runs and adds up value x position
void worker(int32_t* a, int n, int k, int T, Barrier& bar) {
    int lo = k * n / T, hi = (k + 1) * n / T;
    for (int end = hi - 1; end > lo; end--)
        for (int i = lo; i < end; i++)
            if (a[i + 1] < a[i]) std::swap(a[i], a[i + 1]);
    bar.wait();
    if (k == 0) { /* merge the T sorted runs into one, then sum a[i] * (i + 1) */ }
}`,
    python: `# hpc.sort: each thread sorts its run, then thread 0 merges the runs and adds up value x position
def worker(a, k, T, barrier):
    n = len(a)
    a[k * n // T:(k + 1) * n // T] = sorted(a[k * n // T:(k + 1) * n // T])
    barrier.wait()
    if k == 0:
        merged = sorted(a)                           # the merge of the sorted runs
        return sum(v * (i + 1) for i, v in enumerate(merged))`,
  },
  'hpc-bfs': {
    cpp: `// hpc.bfs: level by level, every thread settles its own points whose in-edge was settled on the level before; a barrier ends each level
void worker(const int* in1, const int* in2, int* dist, int n, int k, int T, Barrier& bar) {
    for (int level = 1; level < n; level++) {
        for (int v = k * n / T; v < (k + 1) * n / T; v++)
            if (dist[v] < 0 && (dist[in1[v]] == level - 1 || dist[in2[v]] == level - 1))
                dist[v] = level;
        bar.wait();
    }
}`,
    python: `# hpc.bfs: level by level, every thread settles its own points whose in-edge was settled on the level before; a barrier ends each level
def worker(in1, in2, dist, k, T, barrier):
    n = len(dist)
    for level in range(1, n):
        for v in range(k * n // T, (k + 1) * n // T):
            if dist[v] < 0 and level - 1 in (dist[in1[v]], dist[in2[v]]):
                dist[v] = level
        barrier.wait()`,
  },
  'hpc-fft': {
    cpp: `// hpc.fft: butterflies (a sum and a difference) stage by stage, in place; the threads share each stage and wait for each other after it
void worker(int32_t* x, int n, int k, int T, Barrier& bar) {
    for (int s = 0; (1 << s) < n; s++) {
        for (int bf = k * (n / 2) / T; bf < (k + 1) * (n / 2) / T; bf++) {
            int i = ((bf >> s) << (s + 1)) | (bf & ((1 << s) - 1)), j = i + (1 << s);
            int32_t u = x[i], v = x[j];
            x[i] = u + v; x[j] = u - v;
        }
        bar.wait();
    }
}`,
    python: `# hpc.fft: butterflies (a sum and a difference) stage by stage, in place; the threads share each stage and wait for each other after it
def worker(x, k, T, barrier):
    n, s = len(x), 0
    while (1 << s) < n:
        for bf in range(k * (n // 2) // T, (k + 1) * (n // 2) // T):
            i = ((bf >> s) << (s + 1)) | (bf & ((1 << s) - 1))
            j = i + (1 << s)
            x[i], x[j] = x[i] + x[j], x[i] - x[j]
        barrier.wait()
        s += 1`,
  },
};
