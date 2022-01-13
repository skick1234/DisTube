class Task {
  resolve!: () => void;
  promise: Promise<void>;
  resolveInfo: boolean;
  constructor(resolveInfo: boolean) {
    this.resolveInfo = resolveInfo;
    this.promise = new Promise<void>(res => {
      this.resolve = res;
    });
  }
}

/**
 * Task queuing system
 * @private
 */
export class TaskQueue {
  /**
   * The task array
   * @type {Task[]}
   * @private
   */
  #tasks: Task[] = [];

  /**
   * Waits for last task finished and queues a new task
   * @param {boolean} [resolveInfo=false] Whether the task is a resolving info task
   * @returns {Promise<void>}
   */
  public queuing(resolveInfo = false): Promise<void> {
    const next = this.remaining ? this.#tasks[this.#tasks.length - 1].promise : Promise.resolve();
    this.#tasks.push(new Task(resolveInfo));
    return next;
  }

  /**
   * Removes the finished task and processes the next task
   */
  public resolve(): void {
    this.#tasks.shift()?.resolve();
  }

  /**
   * The remaining number of tasks
   * @type {number}
   */
  public get remaining(): number {
    return this.#tasks.length;
  }

  /**
   * Whether or not having a resolving info task
   * @type {boolean}
   */
  public get hasResolveTask(): boolean {
    return !!this.#tasks.find(t => t.resolveInfo);
  }
}
