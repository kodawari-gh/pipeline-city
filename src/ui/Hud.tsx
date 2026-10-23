import { snapshot } from '../game/store';

export function Hud() {
  const { cycle, money } = snapshot.value;
  return (
    <div>
      <div>${money.toLocaleString()}</div>
      <div>cycle {cycle.toLocaleString()}</div>
    </div>
  );
}
