import { test } from "node:test";
import { strict as assert } from "node:assert";
import { classifyDeltaIssues } from "../scripts/validate-cyclomatic-complexity.mjs";

function namedIssue(name, complexity) {
  return {
    filePath: "src/example.mjs",
    line: 1,
    column: 1,
    message: `Function '${name}' has a complexity of ${complexity}. Maximum allowed is 20.`,
    complexity,
    ruleId: "complexity",
  };
}

function anonymousIssue(complexity, line = 1) {
  return {
    filePath: "src/example.mjs",
    line,
    column: 1,
    message: `Arrow function has a complexity of ${complexity}. Maximum allowed is 20.`,
    complexity,
    ruleId: "complexity",
  };
}

test("identical staged + baseline issue sets produce no delta", () => {
  const issues = [namedIssue("foo", 21), namedIssue("bar", 30), anonymousIssue(25), anonymousIssue(40)];
  const delta = classifyDeltaIssues(
    issues,
    issues.map((issue) => ({ ...issue })),
  );
  assert.deepEqual(delta, []);
});

test("new named function with over-threshold complexity is reported", () => {
  const baseline = [namedIssue("legacy", 21)];
  const staged = [namedIssue("legacy", 21), namedIssue("introduced", 25)];
  const delta = classifyDeltaIssues(staged, baseline);
  assert.equal(delta.length, 1);
  assert.match(delta[0].message, /'introduced'/u);
});

test("worsened named function complexity is reported", () => {
  const baseline = [namedIssue("hotspot", 21)];
  const staged = [namedIssue("hotspot", 25)];
  const delta = classifyDeltaIssues(staged, baseline);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].complexity, 25);
  assert.match(delta[0].message, /'hotspot'/u);
});

test("named function with same or improved complexity is unchanged", () => {
  const baseline = [namedIssue("hotspot", 30)];
  const staged = [namedIssue("hotspot", 25)];
  const delta = classifyDeltaIssues(staged, baseline);
  assert.deepEqual(delta, []);
});

test("anonymous arrow matched tightest-fit against baseline of same set", () => {
  const baseline = [anonymousIssue(23), anonymousIssue(79), anonymousIssue(30), anonymousIssue(27)];
  const staged = [anonymousIssue(79), anonymousIssue(30), anonymousIssue(23), anonymousIssue(27)];
  assert.deepEqual(classifyDeltaIssues(staged, baseline), []);
});

test("new anonymous arrow above all baseline arrows is reported", () => {
  const baseline = [anonymousIssue(23), anonymousIssue(30)];
  const staged = [anonymousIssue(23), anonymousIssue(30), anonymousIssue(50)];
  const delta = classifyDeltaIssues(staged, baseline);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].complexity, 50);
});

test("anonymous arrow that grew beyond every baseline arrow is reported", () => {
  const baseline = [anonymousIssue(30)];
  const staged = [anonymousIssue(50)];
  const delta = classifyDeltaIssues(staged, baseline);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].complexity, 50);
});

test("empty baseline marks every staged issue as new", () => {
  const staged = [namedIssue("alpha", 25), anonymousIssue(30)];
  const delta = classifyDeltaIssues(staged, []);
  assert.equal(delta.length, 2);
});
