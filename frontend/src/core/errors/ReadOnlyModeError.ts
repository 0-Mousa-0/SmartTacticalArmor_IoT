/** The active data source cannot change anything (the dashboard's simulation mode). */
export class ReadOnlyModeError extends Error {
  constructor() {
    super('The active data source is read-only');
    this.name = 'ReadOnlyModeError';
  }
}
