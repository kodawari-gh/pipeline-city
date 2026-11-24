import { Icon } from '@/core/ui/kit/Icons';
import type { Alert } from './buildhud';

type Stage = import('../render/three/buildmode3d').BuildStage;

/**
 * What is wrong with the machine, at the top of the right panel (nothing when nothing is). Build my PC fits any part that fits its socket, so a supply too
 * small, a card with no lead or a hot CPU is said here, in words, with what the machine will do. An alert about a part outlines it on the stage while the
 * pointer is on it, and a click picks it. The same list drives the pill at the top (`pillOf`) and the marks on the rows (`BuildMachine`).
 */
export function BuildAlerts({ stage, alerts }: { stage: Stage | null; alerts: readonly Alert[] }) {
  if (!alerts.length) return null;
  return (
    <section class="bld-alerts" aria-label="Problems with this machine">
      <ul>
        {alerts.map((a) => {
          const body = (
            <>
              <Icon name="warn" size={13} class="bld-ai" />
              <span class="bld-at">
                <b>{a.title}</b>
                <em>{a.text}</em>
              </span>
            </>
          );
          return (
            <li key={`${a.id}:${a.part ?? ''}`} class={`bld-al ${a.level}`}>
              {a.part && stage ? (
                <button
                  title="Pick the part this is about"
                  onPointerEnter={() => stage.glow(a.part)}
                  onPointerLeave={() => stage.glow(null)}
                  onClick={() => stage.select(a.part)}
                >
                  {body}
                </button>
              ) : (
                <div>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
