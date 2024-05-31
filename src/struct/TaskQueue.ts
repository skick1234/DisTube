class Task {
  resolve!: () => void;
  promise: Promise<void>;
  constructor() {
    this.promise = new Promise<void>(res => {
      this.resolve = res;
    });
  }
}

/**
 * Task queuing system
 */
export class TaskQueue {
  /**
   * The task array
   */
  #tasks: Task[] = [];

  /**
   * Waits for last task finished and queues a new task
   */
  queuing(): Promise<void> {
    const next = this.remaining ? this.#tasks[this.#tasks.length - 1].promise : Promise.resolve();
    this.#tasks.push(new Task());
    return next;
  }

  /**
   * Removes the finished task and processes the next task
   */
  resolve(): void {
    this.#tasks.shift()?.resolve();
  }

  /**
   * The remaining number of tasks
   */
  get remaining(): number {
    return this.#tasks.length;
  }
}
