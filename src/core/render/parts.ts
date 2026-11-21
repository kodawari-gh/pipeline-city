/** A part of a graphics card (`pcie1.lane3`, `pcie1.fan0`), of a network card (`pcie0.nic-xtal`) or of the secure module (`tpm0.regs`) hovers on its own, but a click on it is a click on the card: the id of the device in that slot. */
export function deviceOfPart(id: string, devices: readonly { id: string; slot: string }[]): string {
  const part = /^((?:pcie|tpm)\d+)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$/.exec(id);
  return part ? devices.find((d) => d.slot === part[1])?.id ?? id : id;
}
