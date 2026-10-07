---
name: forecasting-weather-markets
description: "Record the house forecast on each configured Kalshi weather market daily and score settled ones once."
closure-kind: process
requires-capabilities:
  - kalshi-weather-forecast
  - kalshi-weather-score
  - kalshi-market-read
---

# Forecasting weather markets

Run `kalshi-weather-forecast` daily before the markets move and `kalshi-weather-score` after they settle; each forecast is scored once.

The supplemental Cold Red Gate `weather_weather_cycle` collects a broader market census and competing models in its own archive; it does not replace these forecast/score operations. `weather_weather_station_evidence` collects scientific station evidence without a Kalshi listing. Research outputs and versioned experiments can support climate science and engineering as well as venue comparisons.
