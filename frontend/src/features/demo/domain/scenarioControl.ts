import type { ScenarioStatus } from './DemoWorld';

/** What the screen may ask of a running simulation. */
export interface ScenarioControl {
  /** Where the storyline stands; null while the simulation is still being prepared. */
  status(): ScenarioStatus | null;
  /** Start the storyline again from the beginning. */
  restart(): void;
}
