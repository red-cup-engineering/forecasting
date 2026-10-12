import assert from "node:assert/strict";
import test from "node:test";
import { bracketProb, buildSheaf, dirichlet, fitCalibrationLink, fitLadder, harmonicExtension, sheafSpectrum } from "../src/kalshi-sheaf.mjs";

const I1 = [[1]];
const edge = (id, u, v, a = 1, w = 1) => ({ id, u, v, Fu: [[a]], Fv: I1, W: [[w]] });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("identity path sheaf: harmonic extension interpolates linearly, energy is minimal", () => {
  const vs = [0, 1, 2, 3].map((i) => ({ id: `v${i}`, dim: 1 }));
  const s = buildSheaf(vs, [edge("a", "v0", "v1"), edge("b", "v1", "v2"), edge("c", "v2", "v3")]);
  const x = harmonicExtension(s, [0, 9, 9, 3], [false, true, true, false]);
  near(x[1], 1); near(x[2], 2);
  near(dirichlet(s, x).energy, 3);
});

test("constants are global sections: kernel of L has dimension one on a connected identity sheaf", () => {
  const s = buildSheaf([{ id: "a", dim: 1 }, { id: "b", dim: 1 }, { id: "c", dim: 1 }], [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "c")]);
  const { values } = sheafSpectrum(s);
  near(values[0], 0, 1e-8); assert.ok(values[1] > 0.5);
  near(dirichlet(s, [2, 2, 2]).energy, 0);
});

test("a sign-twisted cycle has H^0 = 0: smallest eigenvalue > 0 (and here H^1 = 0)", () => {
  const s = buildSheaf([{ id: "a", dim: 1 }, { id: "b", dim: 1 }, { id: "c", dim: 1 }], [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a", -1)]);
  const { values } = sheafSpectrum(s);
  assert.ok(values[0] > 0.1);
});

test("restriction scale: clamping one end of v = 2u forces the other end", () => {
  const s = buildSheaf([{ id: "u", dim: 1 }, { id: "v", dim: 1 }], [edge("e", "u", "v", 2)]);
  const x = harmonicExtension(s, [1.5, 0], [false, true]);
  near(x[1], 3);
});

test("edge energy decomposition sums to the Dirichlet form", () => {
  const s = buildSheaf([{ id: "a", dim: 1 }, { id: "b", dim: 1 }, { id: "c", dim: 1 }], [edge("e1", "a", "b", 1, 2), edge("e2", "b", "c", 0.5, 3)]);
  const x = [1, 4, -2];
  const d = dirichlet(s, x);
  const quad = x.reduce((acc, xi, i) => acc + xi * s.L[i].reduce((t, l, j) => t + l * x[j], 0), 0);
  near(d.energy, quad, 1e-9);
});

test("fitCalibrationLink recovers a linear link and its noise precision", () => {
  const pairs = [];
  for (let i = 0; i < 200; i++) { const a = Math.sin(i) * 3, b = Math.cos(i * 1.7); pairs.push({ xu: [a, b], xv: [0.8 * a + 0.05 * Math.sin(i * 9), 0.5 * b + 0.3 * a + 0.05 * Math.cos(i * 11)] }); }
  const f = fitCalibrationLink(pairs, { ridge: 1e-6 });
  near(f.Fu[0][0], 0.8, 0.02); near(f.Fu[1][0], 0.3, 0.02); near(f.Fu[1][1], 0.5, 0.05);
});

test("fitLadder recovers Normal(mu, sigma) from its own bracket masses", () => {
  const edges = [[-Infinity, 79], [80, 81], [82, 83], [84, 85], [86, 87], [88, Infinity]];
  const brackets = edges.map(([lo, hi]) => ({ lo, hi, p: bracketProb(83.2, 2.4, lo, hi) }));
  const f = fitLadder(brackets);
  near(f.mu, 83.2, 0.01); near(f.sigma, 2.4, 0.02);
  near(brackets.reduce((s, b) => s + b.p, 0), 1, 1e-9);
});

test("an unanchored global section is non-identifiable, even with positive ridge", () => {
  const s = buildSheaf([{ id: "a", dim: 1 }, { id: "b", dim: 1 }],
    [edge("ab", "a", "b")]);
  for (const ridge of [0, 1e-9, 0.1, 10]) {
    assert.throws(
      () => harmonicExtension(s, [5, 10], [true, true], ridge),
      /not positive definite/,
      "regularization must not manufacture a uniquely observed section",
    );
  }
});

test("an isolated free coordinate cannot borrow identification from an anchored component", () => {
  const s = buildSheaf(
    [{ id: "anchor", dim: 1 }, { id: "linked", dim: 1 }, { id: "isolated", dim: 1 }],
    [edge("only", "anchor", "linked")],
  );
  assert.throws(
    () => harmonicExtension(s, [2, 99, 500], [false, true, true]),
    /not positive definite/,
  );
  const identified = harmonicExtension(s, [2, 99, 7], [false, true, false], 0);
  near(identified[1], 2);
  near(identified[2], 7);
});

test("twisted holonomy can identify the zero section with no clamped coordinates", () => {
  const s = buildSheaf(
    [{ id: "a", dim: 1 }, { id: "b", dim: 1 }, { id: "c", dim: 1 }],
    [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("twist", "c", "a", -1)],
  );
  const x = harmonicExtension(s, [3, 7, -2], [true, true, true], 0);
  x.forEach(v => near(v, 0));
  near(dirichlet(s, x).energy, 0);
});

test("invalid numerical masks and ridge values cannot be treated as evidence", () => {
  const s = buildSheaf([{ id: "a", dim: 1 }, { id: "b", dim: 1 }],
    [edge("e", "a", "b")]);
  assert.throws(() => harmonicExtension(s, [0, NaN], [false, true]), TypeError);
  assert.throws(() => harmonicExtension(s, [0, 1], [true]), TypeError);
  assert.throws(() => harmonicExtension(s, [0, 1], [false, true], -0.1), TypeError);
  assert.throws(() => harmonicExtension(s, [0, 1], [false, true], Infinity), TypeError);
});
