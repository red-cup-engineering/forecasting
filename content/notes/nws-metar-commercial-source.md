---
title: NWS METAR commercial source and receiving contract
date-created: 2026-10-13
source-owner: red-cup-engineering/kalshi-engineering-services-section
consumer: causeway-services/market.561.group
status: source-candidate; production receiving required
---

# NWS METAR source

The existing station-observation provider now has a named bounded snapshot
operation, `readNwsMetarSnapshot`, and a pure preflight,
`admitNwsMetarSnapshot`, on its existing `forecasting/station-observations`
export. It sells source acquisition, byte identity and the existing parsed
temperature projection. The underlying NWS bulletin remains public information.
The merchant must not claim exclusive ownership of the original government
data, government endorsement, or that house parsing is an official NWS product.

The NWS [disclaimer](https://www.weather.gov/disclaimer) allows lawful reuse
of public information except content specifically marked otherwise. Its
[API documentation](https://www.weather.gov/documentation/services-web-api)
describes open data for any purpose, cache behavior and reasonable rate limits.
These were checked on 2026-10-13. Dataset-specific restrictions supersede a
generic agency notice. This source qualifies the fixed NOAA/NWS METAR bulletin
for a continental-US `Kxxx` station; it does not qualify foreign-station data,
arbitrary URLs, commercial weather-company feeds or a private forecast archive.
Unknown station names are not invented observations: upstream absence/mismatch
refuses the acquisition. US territories and Alaska are not covered by this
initial request grammar and require explicit source review before extension.

## Preserved information and effects

The HTTP provider performs bounded streaming acquisition with its deadline and
cancel behavior. The existing URI provider identifies the *original received
bytes* with an NI URI; the original text is retained including BOM and line
endings. The existing canonical JSON carrier bounds the delivered record to
16 KiB. Parsed temperature, reported precision, synoptic extrema and observation
time retain their original meanings. This is a source snapshot, not a forecast,
climate-report settlement, accuracy guarantee or permission to place an order.

The pure METAR parsing and request admission functions perform no network,
storage or payment effects. Acquisition stays in this existing effectful
system-service provider. The merchant's compute binding must not pass arbitrary
feed, credentials, host paths or receipt-time overrides from its request. Only
`{station}` is an admitted commercial request. A provider factory may inject
test dependencies internally; those inputs are not customer data.

Successful delivery explicitly names source URL, byte count, NI identity,
issue time, receipt time, measured observation/bulletin age, reuse authority,
house modifications and attribution. A current receipt alone does not prove a
fresh observation. Both observation and bulletin must be no older than two
hours and cannot lie after the receipt; equality at the age bound is admitted.
HTTP errors, redirects, excessive bytes, invalid UTF-8, station disagreement,
impossible calendar times, a future observation relative to bulletin, stale
data and absent reports refuse rather than creating a saleable empty record.

## Wider marine and weather participation

The official [CO-OPS API](https://api.tidesandcurrents.noaa.gov/api/prod/)
supports station water levels, tide predictions and meteorology. Requests must
carry the actual product, time interval, units, time zone and required vertical
datum. Coastal water levels in one datum cannot silently become Great Lakes
heights or a different datum; station support and API window limits govern
the request. The [NOS notice](https://oceanservice.noaa.gov/disclaimer.html)
allows copying/distribution unless specially noted and distinguishes agency
endorsement, identification and contributor responsibility. No CO-OPS provider
or live marine sale is claimed by this METAR source repair.

The official [MarineCadastre AIS FAQ](https://coast.noaa.gov/data/marinecadastre/ais/faq.pdf)
allows derived AIS products with attribution and preservation of public-domain
notice, subject to the linked NAVCEN terms. The
[NOAA AIS repository](https://github.com/ocm-marinecadastre/ais-vessel-traffic)
documents historical bulk GeoParquet products and CC0 content. Historical
vessel observations must retain their observation year, not be marketed as
live naval tracking. No permission follows for commercial AIS vendor feeds,
foreign protected data or private user location histories. A marine offer
needs the existing typed ingestion/geometry providers and actual source
receiving before it can be published as working compute.

## Required receiving

The source candidate enrolls the station-observation tests in both owning
package selections and declares its actual HTTP dependency. Targeted tests
exercise real `Response` streams plus canonical JSON, NI and bounded HTTP
providers. Synthetic bulletins verify parser/transport invariants; they do not
establish live NOAA acquisition, installed machine closure or paid delivery.
Publish through the existing market catalog compiler after provider inclusion;
then independently receive unsigned preflight/refusal and an authorized paid
source receipt. Freshness and source identity must survive that real delivery.
No production activation, full-package suite or closed-chain accounting receipt
is claimed from the targeted source tests alone.
