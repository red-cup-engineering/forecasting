# Kalshi edge candidates, 2026-10-03

Window: settled non-combo markets closing 2026-09-26T20:40:52.000Z .. 2026-10-03T20:40:52.000Z (fit half to 2026-09-29T21:00:26.000Z, test half after). Paper research; nothing was traded.

Markets read 584364, with a usable quote at some horizon 39364, events 7438. Cells with >= 30 distinct test events: 989; candidates: 36; surviving a Bonferroni z of 4.05: 0.

A candidate lane is a (family, horizon, price bucket, side, mode) whose TEST-half lower confidence bound (Wilson on event-level win rate, z=1.96) of EV per contract after fee is above zero with >= 30 distinct events, and whose FIT-half EV was also positive. Taker fee: 0.07*P*(1-P) rounded up to the cent per order of 10. Maker trades are free on "quadratic" series and assume the resting order fills (an upper bound).

## Top 15 by test-half lower bound

1. **category:Economics** 1h YES maker 81-90c
   About 1h before close, in any Economics market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 81-90c. Held-out half: it paid 100.0% of the time over 35 distinct events (Wilson low 90.1%) against an average cost of 85.9c plus 0.01c fee -> EV +14.14c per contract, lower bound +4.24c. Fit half: EV +0.21c over 14 events.

2. **KXNCAA*** 1h NO maker 91-95c
   About 1h before close, in a market in the KXNCAA* family, buy NO by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 91-95c. Held-out half: it paid 99.1% of the time over 130 distinct events (Wilson low 95.6%) against an average cost of 92.7c plus 0.02c fee -> EV +6.44c per contract, lower bound +2.92c. Fit half: EV +5.04c over 123 events.

3. **category:Sports** 2h YES maker 81-90c
   About 2h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 81-90c. Held-out half: it paid 91.6% of the time over 394 distinct events (Wilson low 88.4%) against an average cost of 85.6c plus 0.02c fee -> EV +6.02c per contract, lower bound +2.86c. Fit half: EV +7.05c over 441 events.

4. **category:Sports** 24h YES maker 11-20c
   About 24h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 11-20c. Held-out half: it paid 20.8% of the time over 485 distinct events (Wilson low 17.4%) against an average cost of 15.4c plus 0.02c fee -> EV +5.39c per contract, lower bound +2.01c. Fit half: EV +0.30c over 708 events.

5. **category:Economics** 1h NO maker 66-80c
   About 1h before close, in any Economics market, buy NO by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 66-80c. Held-out half: it paid 91.7% of the time over 30 distinct events (Wilson low 76.5%) against an average cost of 74.5c plus 0.01c fee -> EV +17.17c per contract, lower bound +2.00c. Fit half: EV +27.14c over 13 events.

6. **category:Sports** 24h YES maker 21-35c
   About 24h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 21-35c. Held-out half: it paid 33.2% of the time over 643 distinct events (Wilson low 29.6%) against an average cost of 27.6c plus 0.03c fee -> EV +5.51c per contract, lower bound +1.98c. Fit half: EV +0.51c over 823 events.

7. **category:Financials** 1h NO maker 66-80c
   About 1h before close, in any Financials market, buy NO by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 66-80c. Held-out half: it paid 88.0% of the time over 46 distinct events (Wilson low 75.6%) against an average cost of 73.8c plus 0.00c fee -> EV +14.29c per contract, lower bound +1.89c. Fit half: EV +9.81c over 36 events.

8. **KXNCAA*** 1h YES maker 91-95c
   About 1h before close, in a market in the KXNCAA* family, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 91-95c. Held-out half: it paid 100.0% of the time over 70 distinct events (Wilson low 94.8%) against an average cost of 93.0c plus 0.03c fee -> EV +6.98c per contract, lower bound +1.78c. Fit half: EV +4.48c over 72 events.

9. **category:Financials** 1h NO maker 51-65c
   About 1h before close, in any Financials market, buy NO by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 51-65c. Held-out half: it paid 73.5% of the time over 49 distinct events (Wilson low 59.7%) against an average cost of 58.2c plus 0.00c fee -> EV +15.30c per contract, lower bound +1.57c. Fit half: EV +11.73c over 33 events.

10. **series:KXITFWMATCH** 1h YES maker 36-50c
   About 1h before close, in a KXITFWMATCH market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 36-50c. Held-out half: it paid 58.8% of the time over 34 distinct events (Wilson low 42.2%) against an average cost of 40.8c plus 0.00c fee -> EV +18.07c per contract, lower bound +1.47c. Fit half: EV +2.39c over 22 events.

11. **category:Sports** 1h YES maker 81-90c
   About 1h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 81-90c. Held-out half: it paid 90.1% of the time over 444 distinct events (Wilson low 86.9%) against an average cost of 85.4c plus 0.02c fee -> EV +4.59c per contract, lower bound +1.45c. Fit half: EV +3.22c over 429 events.

12. **KXNCAA*** 6h YES maker 91-95c
   About 6h before close, in a market in the KXNCAA* family, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 91-95c. Held-out half: it paid 100.0% of the time over 65 distinct events (Wilson low 94.4%) against an average cost of 93.1c plus 0.04c fee -> EV +6.84c per contract, lower bound +1.25c. Fit half: EV +1.01c over 94 events.

13. **category:Sports** 2h YES maker 66-80c
   About 2h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 66-80c. Held-out half: it paid 77.2% of the time over 710 distinct events (Wilson low 74.0%) against an average cost of 72.8c plus 0.03c fee -> EV +4.45c per contract, lower bound +1.23c. Fit half: EV +4.39c over 787 events.

14. **category:Sports** 6h YES maker 36-50c
   About 6h before close, in any Sports market, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 36-50c. Held-out half: it paid 46.6% of the time over 1264 distinct events (Wilson low 43.8%) against an average cost of 42.7c plus 0.03c fee -> EV +3.87c per contract, lower bound +1.13c. Fit half: EV +1.11c over 1578 events.

15. **KXUEFA*** 2h YES maker 1-5c
   About 2h before close, in a market in the KXUEFA* family, buy YES by resting an order at your own side of the spread (maker; assumes it fills) when the price you pay is 1-5c. Held-out half: it paid 9.4% of the time over 59 distinct events (Wilson low 4.2%) against an average cost of 3.1c plus 0.00c fee -> EV +6.24c per contract, lower bound +1.10c. Fit half: EV +0.60c over 61 events.

## Cautions

- One week is short: sports and crypto dominate the event counts; a lane that wins here may be a regime of this week.
- Quotes are hourly candle closes, not tradeable fills; a favourite at 99c may have no depth.
- Cells overlap (a series sits inside its prefix family and its category); the candidates are correlated, not independent.
- Admit a lane only by forward-testing it on markets that had not closed when it was named.
