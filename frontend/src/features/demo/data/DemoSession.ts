import type { DemoWorld } from '../domain/DemoWorld';
import { BUILT_IN_ROSTER, type RosterEntry } from '../domain/roster';
import type { ScenarioControl } from '../domain/scenarioControl';

/** The live registry may be asleep (free hosting): start with the built-in roster after this long. */
const ROSTER_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * One running simulation. It casts the real fleet (names, posts, vest codes)
 * when the registry can be read, otherwise the built-in roster, and is moved
 * to the current time whenever someone reads from it.
 */
export class DemoSession implements ScenarioControl {
  private generation = 0;
  private current: Promise<DemoWorld>;
  private ready: DemoWorld | null = null;

  constructor(
    private readonly loadRoster: () => Promise<RosterEntry[]>,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.current = this.create();
  }

  private async create(): Promise<DemoWorld> {
    const generation = ++this.generation;
    this.ready = null;
    const [{ DemoWorld }, roster] = await Promise.all([
      // The simulation engine is its own chunk: live-only visitors never download it.
      import('../domain/DemoWorld'),
      withTimeout(Promise.resolve().then(this.loadRoster), ROSTER_TIMEOUT_MS).catch((): RosterEntry[] => []),
    ]);
    const world = new DemoWorld({ roster: roster.length ? roster : BUILT_IN_ROSTER, start: this.clock() });
    if (generation === this.generation) this.ready = world;
    return world;
  }

  /** The simulation, brought up to now. */
  async world(): Promise<DemoWorld> {
    const world = await this.current;
    world.advanceTo(this.clock());
    return world;
  }

  status() {
    if (!this.ready) return null;
    this.ready.advanceTo(this.clock());
    return this.ready.scenario();
  }

  restart(): void {
    this.current = this.create();
  }
}
