export type CompatSeverity = 'error' | 'warn' | 'tip';

export interface CompatIssue {
  /** Stable id, for the UI to pick its wording or an icon (`vrm-overload`, `psu-brownout`...). */
  id: string;
  severity: CompatSeverity;
  /** The device id the issue is about; null for the board or the machine as a whole. */
  part: string | null;
  /** One plain sentence for the player. */
  message: string;
  /** The number that broke the limit, and the limit (in the unit of the message). */
  value?: number;
  limit?: number;
  /** A change that clears it, when there is one that is only a setting: the CPU clock (in clock units) that is safe. */
  fix?: { clock: number } | undefined;
}
