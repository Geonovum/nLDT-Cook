import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractDependencies, getTerminalNodes } from "../engine/dependencyResolver.js";
import { lowerWorkflow } from "./lower.js";
import { raiseRecipe } from "./raise.js";

const rain = JSON.parse(
  readFileSync(
    new URL("../../../nLDT-CookBook/public/dt-rain-traffic.json", import.meta.url),
    "utf8",
  ),
);
const simple = JSON.parse(
  readFileSync(
    new URL("../../../nLDT-CookBook/public/simpleRecipe.json", import.meta.url),
    "utf8",
  ),
);

test("raises the simple cookbook recipe to one HTTP call", () => {
  const { workflow, input } = raiseRecipe(simple);
  assert.equal(workflow.document.dsl, "1.0.3");
  assert.equal(workflow.document.name, "simple-recipe");
  assert.deepEqual(Object.keys(input), []);
  assert.equal(workflow.do.length, 1);
  assert.equal(workflow.do[0].step1.call, "http");
  assert.equal(
    workflow.do[0].step1.with.endpoint,
    "http://localhost:8080/geonovum/v1/processes/add/execution",
  );
  assert.deepEqual(workflow.do[0].step1.with.body.inputs, { number1: 19, number2: 7 });
  assert.equal(workflow.output, undefined);

  const nodes = lowerWorkflow(workflow);
  assert.deepEqual(nodes.map((node) => node.id), ["step1"]);
  assert.deepEqual(getTerminalNodes(nodes), ["step1"]);
});

test("raises the rain recipe as a flat task list", () => {
  const { workflow, input } = raiseRecipe(rain);
  assert.equal(input.mobilityData, 24);
  assert.deepEqual(
    workflow.do.map((item) => Object.keys(item)[0]),
    ["step1", "step2a", "step2b", "step3"],
  );
  assert.equal(workflow.do.some((item) => Object.values(item)[0].fork), false);
  assert.equal(
    workflow.do[1].step2a.with.endpoint,
    "http://localhost:8080/geonovum/v1/processes/multiply/execution",
  );
  assert.equal(workflow.do[2].step2b.with.headers.Prefer, "respond-async");
  assert.equal(
    workflow.do[3].step3.with.body.inputs.number2,
    "${ $workflow.input.mobilityData }",
  );
  assert.equal(workflow.document.metadata.cook.processing[0].id, "processing1");
  assert.match(workflow.output.as, /step2a: \$context\.step2a/);
  assert.match(workflow.output.as, /step3: \./);

  const nodes = lowerWorkflow(workflow);
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  assert.deepEqual(extractDependencies(byId.step2a), ["step1"]);
  assert.deepEqual(extractDependencies(byId.step2b), ["step1"]);
  assert.deepEqual(extractDependencies(byId.step3), ["step2b"]);
  assert.deepEqual(getTerminalNodes(nodes), ["step2a", "step3"]);
  assert.equal(byId.step3.body.inputs.number2, "$mobilityData");
});
