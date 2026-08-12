import assert from "node:assert/strict";
import test from "node:test";

import { classifyInput, deriveOutcomeTitle } from "../src/core/classifier.ts";

test("detects direct work requests", () => {
  assert.equal(classifyInput("Implement organization switching", false), "outcome");
  assert.equal(classifyInput("Could you please fix the failing tests?", false), "outcome");
  assert.equal(classifyInput("I want you to redesign the settings screen", false), "outcome");
  assert.equal(classifyInput("Let's migrate the database", false), "outcome");
});

test("leaves explanatory conversation alone", () => {
  assert.equal(classifyInput("How does authentication work?", false), "conversation");
  assert.equal(classifyInput("What should we build first?", false), "conversation");
  assert.equal(classifyInput("thinking about the mobile client", false), "conversation");
  assert.equal(classifyInput("/model", false), "conversation");
});

test("routes ordinary input into an existing outcome", () => {
  assert.equal(classifyInput("Use the existing component instead", true), "continuation");
});

test("derives a compact title without conversational preamble", () => {
  assert.equal(deriveOutcomeTitle("Could you please fix the failing tests?"), "fix the failing tests");
});
