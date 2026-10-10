# KXRAIN mid-bin returns, 2026-10-10

What taking each side of a Kalshi daily-rain market returned, binned by the market's mid at the lane's day-before
decision times, on Kalshi's own settled results. Public data only: no account, no orders.

- Inputs: the 2026-10-04 weather-coverage record's public fetches (`scripts/fetch_settled.py KXRAIN`,
  `scripts/fetch_candles.py KXRAIN`, into its git-ignored `data/`), re-run 2026-10-10.
- Script: `scripts/mid_bins.py` (re-runnable; it imports that record's station map, date parser and fee rule).
- Record: `results/mid-bin-returns.json`. It cites its inputs and its script by sha256 (`provenance`) and carries
  `gameModels.takeYes` / `takeNo` in the market game's scenario-likelihood-model form: per bin, P(bin | yes) and
  P(bin | no), and the scored gross return with its effective sample (`trainingSamples` = distinct settlement
  dates; one date's markets share their weather). `results/mid-bin-returns.md` is the table.

Finding (2,798 rows, 1,435 markets, 68 dates, 2026-08-02..10-08): the market's long-shot bias pays on its own
price, before any weather model. Buying NO where the mid is at most 10c earned +0.9% to +3.0% of cost after the
taker fee, positive in both date halves for all three bins. Buying YES where the mid is 80c or more earned +0.9% to
+4.9%. Both sides lose after the fee between 10c and 60c. Taking at the touch assumes the displayed size;
depth is not read.
