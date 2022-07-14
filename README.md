# do-taskmanager

A TaskManager for Durable Objects, simplifying the use of Alarms.

_WARNING_: This project code is currently in beta. Please do not use it in production for anything serious.

With TaskManager, you can schedule any number of Tasks at multiple points in the future, and TaskManager will make sure they all get processed on time and automatically retried if they fail.

A full example can be found in `worker/index.ts`, but to get started is easy by creating a Durable Object like this:

```typescript
import { Task, TaskManager, TM_DurableObject, withTaskManager } from 'do-taskmanager'

export interface Env {
  TASK_MANAGER: TaskManager
}

class MyDO implements TM_DurableObject {
  constructor(state: DurableObjectState, protected readonly env: Env) {
    this.storage = state.storage
  }
  async processTask(task: Task): Promise<void> {
    //DoSomethingInteresting(task)
  }
  async fetch(request: Request): Promise<Response> {
    const nextMinute = Date.now() + 60 * 1000
    const headers = [...request.headers.entries()]
    await this.env.TASK_MANAGER.scheduleTaskAt(nextMinute, { url: request.url, headers })
    return new Response('Scheduled!')
  }
}

const DO = withTaskManager(MyDO)
export { DO }
```

The scheduling methods on `TaskManager` are listed below. In all instances `context` is any Javascript object/array/primitive supported by the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), that you want
to include in your task when processTask is called.

* `scheduleTaskAt(time: PointInTime, context: any): Promise<taskId>` where `time` is the time in either ms since the epoch or a JS Date object.
* `scheduleTaskIn(ms: number, context: any): Promise<taskId>` where `ms` is the amount of ms for now the task should be scheduled.
* `scheduleEvery(ms: number, context: any): Promise<taskId>` where `ms` is the interval in milliseconds that the task should be scheduled.
* `cancelTask(taskId: taskId): Promise<void>` where taskId is the id that is returned by any of the scheduling functions.

In practice the exact timing that your function will be called will depend on many factors and may not be as precise, especially for times within 30 seconds from the time of scheduling.

Please note that if your `processTask` throws an exception, it will retry once a minute until it succeeds. If you want to have a finite number of delivery attempts, you can check the `task.attempts` to see how many times this particular task has been attempted to be delivered before.

TaskManager uses the same durable storage that your durable object uses, with the `$$_tasks` prefix. Which means that if you delete those records either directly, or through a `deleteAll`, it will also delete your tasks.

Manually setting your own alarms should work as normal. TaskManager will intercept those calls and schedule them like a task, except the regular `alarm` method will be called instead of the `processTask` method. But it is recommended to only use Tasks. Note that calling `setAlarm` will still override a previous alarm scheduled with `setAlarm`.
