// Game feature: the USB key's life. Plug, eject, pay, decline, the auto-eject, and the job log and almanac entries a key leaves.
// Every export is a `Game` method (see game.ts).

export { plugAndBoot, plugKey, ejectKey, deliver, trayKeyIds } from './keysPlug';
export { declineKey, declineJob, pluggedKey, pluggedIngested, autoEject } from './keysDecline';
export {
  afterMachine,
  startOf,
  ranOf,
  stampRan,
  countersNow,
  closeWindow,
  liveOf,
  onCard,
  addLog,
  dexSeen,
  dexDone,
} from './keysLog';
