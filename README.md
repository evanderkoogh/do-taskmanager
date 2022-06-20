# do-taskmanager

A TaskManager for Durable Objects, simplifying the use of Alarms.

_WARNING_: Still code is still very much in beta. It needs proper testing before being deployed into production for anything serious.

With TaskManager, you can schedule any number of Tasks at multiple points in the future, and TaskManager will make sure they all get processed on time in the right order.

A full example can be found in `worker/index.ts`, but to get started is easy.

For now, add `do-taskmanager` as a Git dependency with the following dependency in your `package.json`

```json
  "do-taskmanager": "https://github.com/evanderkoogh/do-taskmanager#main",
```

And then create a Durable Object like this:

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

Please note that if your `processTask` throws an exception, it will retry once a minute until it succeeds. If you want to have a finite number of delivery attempts, you can check the `task.attempts` to see how many times this particular task has been attempted to be delivered before.

TaskManager uses the same durable storage that your durable object uses, with the `$$_tasks` prefix. Which means that if you delete those records either directly, or through a `deleteAll`, it will also delete your tasks.

Manually setting your own alarms should work as normal. TaskManager will intercept those calls and schedule them like a task, except your `alarm` method will be called instead of the `processTask` method.
