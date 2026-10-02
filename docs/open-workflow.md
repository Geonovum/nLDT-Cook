# Open Workflow Specification in Cook

Cook should accept an [Open Workflow Specification](https://open-workflow-specification.org/) 1.0.3 document as another way to describe the same process graph it already runs. It should not become a general Open Workflow runtime.

The sample document is `examples/open-workflow/add-multiply.json`. `src/openworkflow/lower.js` turns that document into Cook nodes. `src/openworkflow/raise.js` turns a cookbook recipe the other way. The two hosted recipes are in `examples/open-workflow/from-cookbook/`. The current `DagEngine` can already schedule the lowered nodes.

```bash
node --test src/openworkflow/lower.test.js
```

## What already matches

Cook posts each step to `{process href}/execution` with a JSON body, runs steps whose inputs are ready in the same wave, and returns the terminal steps. DSL 1.0.3 has a direct spelling for that:

| Cook | Open Workflow 1.0.3 |
|---|---|
| one process node | `call: http` with `method: post` and an `/execution` endpoint |
| literal input | JSON value in `with.body.inputs` |
| `:step.outputs.name` | `${ $context.step.name }` after that task exports `{ step: . }` |
| `$ingredient` | `${ $workflow.input.ingredient }` |
| the graph | derived from `${ $context.step.name }`, not written as `fork` |
| `Prefer: respond-async` | the same header on the HTTP call |
| process subscriber | `body.subscriber`, left for Cook's process client |
| terminal results | workflow `output.as`, selecting the leaf values |

`call: http` is a required function of every Open Workflow runtime. A synchronous OGC process returns `200` and a JSON object such as `{ "sum": 17 }`. The call's default output is that content, so `.sum` is the process output.

The `do` list does not describe the graph. Each task exports its result under its own name, and a later task reads that name: `${ $context.step1.sum }`. The lowerer turns that reference into `:step1.outputs.sum`. `DagEngine` then runs every task whose references are ready, so `step2a` and `step2b` run together even though they are written one after the other. An author does not write `fork` or `branches`. A strict Open Workflow runtime would instead run `do` in order, so those two tasks would not overlap there.

## What Cook should keep to itself

A generic Open Workflow runtime and Cook disagree on asynchronous OGC jobs.

`call: http` treats every `2xx` response as success and returns the body. Cook treats `201` and `202` as "job accepted", then polls `Location` or waits for the subscriber callback. The sample marks `step2b` with `Prefer: respond-async` and a subscriber. Lowering preserves both, so the existing `ProcessClient` still waits. Another runtime would stop at the acceptance response and would not call the subscriber URLs.

`listen` does not close that gap. It waits for broker events, not for an HTTP callback delivered to Cook.

These tasks are outside this investigation: `for`, `switch`, `try`, `emit`, `run` (container, script, shell), `call: openapi`, `call: grpc`, `call: asyncapi`, and schedules. A document that uses one is rejected by the lowerer.

## POST /execute

`POST /execute` runs a workflow document with the same engine as a recipe. Post the document itself:

```json
{
  "document": { "dsl": "1.0.3", "namespace": "https://nldt.geonovum.nl/cook", "name": "add-multiply", "version": "1.0.0" },
  "do": []
}
```

When a task reads `${ $workflow.input.name }`, pass those values beside the document:

```json
{
  "type": "workflow",
  "input": { "mobilityData": 24 },
  "workflow": { "document": {}, "do": [] }
}
```

Cook lowers the document to one processing group named `document.name`, substitutes `input` as ingredients, and returns the terminal steps. Several terminal steps use the same `multipart/related` response as a recipe. A task Cook cannot lower returns `400` with code `invalid-workflow`. A recipe body is unchanged.
