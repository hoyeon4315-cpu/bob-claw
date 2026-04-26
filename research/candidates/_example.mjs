export const metadata = {
  name: "ExampleMomentum",
  track: "A",
  family: "momentum",
  event: "create",
  notes: "tracked template candidate",
};

export function buildSignals({ panel, helpers }) {
  const close = panel.rows.map((row) => row.close);
  const fast = helpers.sma(close, 5);
  const slow = helpers.sma(close, 13);
  return panel.rows.map((_, index) => (fast[index] > slow[index] ? 1 : 0));
}
