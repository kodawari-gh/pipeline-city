import type { Level } from './logic';

/** Small horizontal bar. Level is conveyed by colour and by the text label, not colour alone. */
export function Meter(props: { value: number; level?: Level; label: string; max?: number; text?: string; mark?: number }) {
  const max = props.max ?? 1;
  const frac = Math.min(1, Math.max(0, props.value / max));
  return (
    <div class={`meter ${props.level ?? 'ok'}`} role="meter" aria-label={props.label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={props.value} aria-valuetext={props.text}>
      <div class="fill" style={{ width: `${frac * 100}%` }} />
      {props.mark !== undefined && <div class="mark" style={{ left: `${Math.min(1, props.mark / max) * 100}%` }} />}
    </div>
  );
}
