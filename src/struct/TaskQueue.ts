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
 */
export class TaskQueue {
  /**
   * The task array
   */
  #tasks: Task[] = [];

  /**
   * Waits for last task finished and queues a new task
   *
   * @param resolveInfo - Whether the task is a resolving info task
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
   */
  public get remaining(): number {
    return this.#tasks.length;
  }

  /**
   * Whether or not having a resolving info task
   */
  public get hasResolveTask(): boolean {
    return this.#tasks.some(t => t.resolveInfo);
  }
}
