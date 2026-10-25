// Plain-language + nerd descriptions for board regions and world objects that are not device specs.
// A layperson line first, a technical line second. Ids are the ones the renderer writes to hover/selected.

export interface Description { title: string; plain: string; nerd: string }

export const REGIONS: Record<string, Description> = {
  board: {
    title: 'Motherboard',
    plain: 'Everything plugs into this. Each part has its own socket.',
    nerd: 'Mini board: 1 CPU, 2 DIMM, 1 ATX, 1 cooler, 1 display slot. Bigger boards cost more.',
  },
  vrm: {
    title: 'Voltage regulators (core)',
    plain: "Turn the power supply's 12 volts into the small, steady voltage the processor needs.",
    nerd: 'VRM: buck converters (inductor + MOSFET phases) feeding Vcore. All CPU current flows through here.',
  },
  vrm2: {
    title: 'Voltage regulators (memory)',
    plain: 'The same job for the memory sticks: a gentle, steady supply for the RAM.',
    nerd: 'DRAM VRM: phases of buck converters feeding the DIMMs at 1.2 V. Lit by RAM current; overclocking memory loads it, a RAM VRM heatsink cools it.',
  },
  pcie: {
    title: 'Expansion slots (PCIe)',
    plain: 'Long slots for add-in cards. A network card goes here; graphics cards come later.',
    nerd: 'PCIe x16 lanes straight from the CPU. No GPU exists in the sim yet, so the bus stays dark.',
  },
  chipset: {
    title: 'Chipset (PCH)',
    plain: 'The platform controller. It holds the boot program, runs the USB port, and performs the power-on self-test and the loader that starts each client job.',
    nerd: 'PCH: boot ROM shadowed into RAM at reset, USB host controller (key windows, STATUS/PHASE registers), display routing. Linked to the CPU over DMI.',
  },
  io: {
    title: 'Rear connectors',
    plain: 'Where the monitor cable and the USB port live. Client keys go into the USB port.',
    nerd: 'Rear I/O: HDMI out (display routing from the PCH) and the USB host port the boot ROM polls.',
  },
  atx: {
    title: 'ATX power socket (24-pin)',
    plain: 'The main power plug from the power supply. Without it nothing turns on.',
    nerd: 'ATX 24-pin: 3.3 V, 5 V, 12 V rails and power-good. Required for the power button to work.',
  },
  cpw: {
    title: 'CPU power socket (8-pin)',
    plain: 'A second plug that feeds the processor directly. Without it the self-test fails.',
    nerd: 'EPS 8-pin 12 V into the VRM row. POST reports NO CPU POWER if it is missing.',
  },
  m2: {
    title: 'M.2 storage slot',
    plain: 'A slot for fast NVMe drives. Needs the bigger board. Drag a drive here.',
    nerd: 'M.2 NVMe, PCIe x4: the m2 slot. Accepts the NVMe drive; a missing slot is shown as a shop reason.',
  },
  sata: {
    title: 'Drive bay (SATA)',
    plain: 'Where the storage drives go. Click it to buy a drive: an HDD is slow and cheap, an SSD is faster. The OS lives on a drive.',
    nerd: 'SATA drive bays (sata0, sata1 on bigger boards). A drive draws PSU watts; there is no separate connector in the sim.',
  },
  bay: {
    title: 'Drive bay (SATA)',
    plain: 'Where the storage drives go. Click it to buy a drive: an HDD is slow and cheap, an SSD is faster. The OS lives on a drive.',
    nerd: 'SATA drive bays (sata0, sata1 on bigger boards). A drive draws PSU watts; there is no separate connector in the sim.',
  },
  case: {
    title: 'Computer case',
    plain: 'The box everything sits in: the board, the power supply and the drive bays.',
    nerd: 'Chassis. Decor only: the parts inside are what matter.',
  },
  os: {
    title: 'Operating system (on this drive)',
    plain: 'The OS installed on this drive. Click the badge for its status, queue and uninstall. The monitor only shows its text.',
    nerd: 'Badge for the OS on its storage device: the boot image sits on the drive, the job queue in kernel RAM. Systems on offer: click a drive bay.',
  },
  bat: {
    title: 'Clock battery',
    plain: 'A coin battery that keeps the clock and settings alive when the power is off.',
    nerd: 'CR2032 backing the RTC and CMOS. Decor: no effect in the sim.',
  },
  audio: {
    title: 'Audio chip',
    plain: 'Would make sound. This workshop has no use for it.',
    nerd: 'HD audio codec. Decor.',
  },
  hex: { title: 'Decoration', plain: 'Just board art.', nerd: 'Hex-pattern silkscreen on the board: decor, no effect in the sim.' },
  qr: { title: 'Decoration', plain: 'A sticker. Nothing to see.', nerd: 'QR-style sticker on the board: decor, no effect in the sim.' },
  psu: {
    title: 'Power supply',
    plain: 'Feeds the whole machine. If parts ask for more power than it has, everything slows down or shuts off.',
    nerd: 'Select it for load and upgrades. The ATX and CPU cables plug into it.',
  },
  monitor: {
    title: 'Monitor',
    plain: 'Shows what the machine is doing: the self-test, then the work on each client job. It needs its video cable.',
    nerd: 'CLI display driven by the PCH through the HDMI path. Rows 0-3 POST, 5 status, 8 the job output.',
  },
  crate: {
    title: 'Inventory',
    plain: 'Spare parts you own but have not fitted. Open the inventory (top bar) and drag them onto the matching socket.',
    nerd: 'The inventory: purchases land here; parts only change while the machine is off.',
  },
  tray: {
    title: 'Key tray',
    plain: 'Clients leave their jobs here on USB keys. Pick one and plug it into the USB port.',
    nerd: 'The work queue (capped). Old keys hurt your reputation while they wait.',
  },
  usb: {
    title: 'USB port',
    plain: 'Work comes in here. Plug in one client key and the machine runs that job and writes the answer on the key. Remove the key to get paid.',
    nerd: 'PCH USB host, one key at a time. The boot ROM copies the program into RAM, runs it, and writes the result back.',
  },
  power: {
    title: 'Power button',
    plain: 'Turns the machine on and off. Parts and cables can only be changed while it is off.',
    nerd: 'On needs a PSU and the ATX cable. POST then needs a CPU, the CPU power cable and RAM.',
  },
  'cable.atx': {
    title: 'ATX cable (24-pin)',
    plain: 'The main power cable from the power supply to the motherboard.',
    nerd: 'Carries the 3.3 / 5 / 12 V rails. Without it the power button does nothing.',
  },
  'cable.cpu': {
    title: 'CPU power cable (8-pin)',
    plain: 'Feeds the processor directly from the power supply.',
    nerd: 'EPS 12 V. POST fails with NO CPU POWER without it.',
  },
  'cable.video': {
    title: 'Video cable',
    plain: 'Carries the picture from the motherboard to the monitor.',
    nerd: 'HDMI path from the PCH. The machine also runs without it, but blind.',
  },
  'cable.pcie': {
    title: 'PCIe power cable',
    plain: 'Extra power for graphics cards. Not needed yet.',
    nerd: 'PCIe 6-pin; arrives with GPUs.',
  },
  'psu.readout': {
    title: 'Power readout',
    plain: 'Shows how much power the machine uses compared with what the supply can give.',
    nerd: 'Load = sum of device watts against the rated budget; over 100% trips the supply.',
  },
  // Zoomed-in processor die (src/render/pipeline.ts), one id per block.
  'cpu.IF': { title: 'Fetch', plain: 'Reads the next instruction from memory.', nerd: 'IF: instruction fetch, PC to I-port.' },
  'cpu.ID': { title: 'Decode', plain: 'Works out what the instruction asks for.', nerd: 'ID: decode, register read, hazard check.' },
  'cpu.EX': { title: 'Execute', plain: 'Does the arithmetic or works out an address.', nerd: 'EX: ALU, branch resolve, address generation.' },
  'cpu.MEM': { title: 'Memory', plain: 'Reads or writes memory for loads and stores.', nerd: 'MEM: data access through the cache, memory port.' },
  'cpu.WB': { title: 'Write back', plain: 'Puts the result into a register. The instruction is done.', nerd: 'WB: register file write, retire.' },
  'cpu.IC': { title: 'Instruction cache', plain: 'A small, fast copy of recent instructions.', nerd: 'I-side cache. The toy machine has none yet: every fetch reads RAM.' },
  'cpu.BP': { title: 'Branch predictor', plain: 'Guesses which way a branch goes so work can start early.', nerd: 'BP: branch prediction; a wrong guess flushes the wrong-path instructions.' },
  'cpu.CLK': { title: 'Clock', plain: 'Sets how fast the processor steps.', nerd: 'Core clock domain: divider and multiplier against the base tick.' },
  'cpu.DC': { title: 'Data cache', plain: 'A small, fast copy of recent data.', nerd: 'D-side cache, misses go to RAM.' },
  'cpu.RF': { title: 'Registers', plain: 'The processor’s own scratch slots.', nerd: 'Register file: 16 x 32-bit.' },
  'cpu.UNCORE': { title: 'Uncore', plain: 'Everything outside the core that the core talks to.', nerd: 'Bus interface, interrupts, uncore clocks.' },
  'cpu.MC': { title: 'Memory controller', plain: 'Talks to the memory sticks.', nerd: 'MC: RAM port, latency from the RAM spec.' },
  'cpu.IO': { title: 'I/O port', plain: 'The door to devices such as the chipset.', nerd: 'Memory-mapped I/O, the bus to the PCH.' },
  'cpu.L2': { title: 'Second-level cache', plain: 'A bigger, slower cache behind the small ones.', nerd: 'L2: not modelled yet.' },
};

/** Plain explanation of the four job types. */
export const JOB_TYPES: Record<string, string> = {
  log: 'A simple log job: print a few lines. Easy and quick.',
  calc: 'A calculation job: crunch some numbers, then print the answer.',
  checksum: 'A checksum job: add up a block of data to prove it is intact.',
  scan: 'A scan job: sweep through lots of memory. Memory-hungry, so faster RAM helps.',
  db: 'A database job: lots of reads from a fast drive. Needs an operating system and a SATA SSD or better.',
  web: 'A web job: serve a page over the network. Needs a network link.',
  secure: 'A secure job: signs and checks data. Needs a secure module (TPM).',
  gpu: 'A graphics job: heavy parallel work. Needs a graphics card.',
  npu: 'An AI job: neural network work. Needs a neural accelerator.',
  hpc: 'A heavy compute job: big work that wants several cores. Needs a multicore processor.',
};
