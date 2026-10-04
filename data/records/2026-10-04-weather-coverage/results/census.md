# Census of Kalshi Climate & Weather (public API, 2026-10-04 05:00Z)

417 series in the category, 145 with open markets. vol24h in contracts; depth columns are TOP-OF-BOOK only (sum of best-bid / best-ask sizes across a series' open markets), the full-ladder depth at policy prices is in saturation.md.

## By family

| family | series_open | markets | vol24h | oi |
|---|---|---|---|---|
| temperature, daily high/low | 49 | 577 | 1541689 | 1180726 |
| rain, daily | 3 | 88 | 882236 | 478493 |
| rain, weekend/weekly | 2 | 27 | 36567 | 59822 |
| rain, monthly/custom | 14 | 194 | 16432 | 36981 |
| temperature, hourly directional | 4 | 40 | 12905 | 10407 |
| snow | 14 | 86 | 10220 | 63564 |
| hurricane / tropical | 12 | 287 | 10133 | 747305 |
| climate / other | 15 | 83 | 7872 | 231543 |
| temperature, weekly average (consecutive hot days) | 10 | 50 | 7497 | 9179 |
| earthquake / volcano | 5 | 18 | 2076 | 284649 |
| ski-resort open/close dates | 17 | 86 | 195 | 34200 |
| temperature, other | 0 | 0 | 0 | 0 |
| temperature, weekly high | 0 | 0 | 0 | 0 |

### climate / other

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXGTEMP | annual | 2 | 2 | 4816 | 125275 | 61 | 496 | 0 |  | NASA Goddard Institute for Space Studies |
| KXHMONTH | monthly | 2 | 2 | 1326 | 15488 | 97 | 97 | 2 | 2026-08-14..2026-09-15 | NCEI |
| KXTORNADO | monthly | 11 | 1 | 750 | 1245 | 1787 | 286 | 33 | 2026-08-01..2026-10-01 | National Oceanic and Atmospheric Adminis |
| KXHMONTHRANGE | custom | 12 | 2 | 567 | 10481 | 539 | 13817 | 12 | 2026-08-16..2026-09-13 | National Oceanic and Atmospheric Adminis |
| KXRONI | one_off | 16 | 3 | 277 | 31870 | 2225 | 2975 | 0 |  |  San Francisco Unified School District |
| KXUSCLIMATE | one_off | 2 | 1 | 51 | 9178 | 531 | 523 | 0 |  | EPA |
| KXTXURI | one_off | 3 | 1 | 43 | 188 | 37 | 205 | 0 |  | National Weather Service |
| KXCO2LEVEL | custom | 5 | 1 | 30 | 4953 | 2043 | 2500 | 0 |  | with data provided by NOAA Global Monito |
| KXINDIACLIMATE | custom | 1 | 1 | 12 | 2816 | 10 | 15 | 0 |  | Indian government |
| KXWARMING | one_off | 1 | 1 | 0 | 4086 | 20 | 432 | 0 |  | Berkeley Earth; NASA Goddard Institute f |
| KXEUCLIMATE | one_off | 1 | 1 | 0 | 1574 | 5 | 24 | 0 |  | EU |
| KXSOCKEYERUN | annual | 6 | 1 | 0 | 4067 | 618 | 862 | 0 |  | Alaska Department of Fish and Game |
| KXEVSHARE | custom | 4 | 1 | 0 | 11802 | 41 | 1010 | 0 |  | Argonne National Laboratory |
| KXHDDCVG | custom | 9 | 1 | 0 | 1075 | 0 | 0 | 0 |  | The Weather Company |
| KXMEAD | monthly | 8 | 1 | 0 | 7445 | 233 | 438 | 0 |  | U.S. Bureau of Reclamation |

### earthquake / volcano

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXEARTHQUAKECALIFORNIA | custom | 3 | 3 | 1571 | 254041 | 4570 | 2225 | 0 |  | USGS |
| KXBIGGESTQUAKE | daily | 10 | 1 | 447 | 446 | 8710 | 4068 | 299 | 2026-09-02..2026-10-03 | the United States Geological Survey |
| KXVEI4 | one_off | 3 | 1 | 54 | 5879 | 140 | 108 | 0 |  | the U |
| KXERUPTSUPER | custom | 1 | 1 | 4 | 10898 | 8 | 20 | 0 |  | ABC; Axios; CBS; CNN; Fox News; MSNBC; N |
| KXEARTHQUAKEJAPAN | custom | 1 | 1 | 0 | 13385 | 340 | 146 | 0 |  | USGS |

### hurricane / tropical

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXHURCAT | custom | 145 | 29 | 3082 | 134046 | 221858 | 470722 | 68 | 2026-07-29..2026-10-01 | National Oceanic and Atmospheric Adminis |
| KXFIRSTHURRICANE | custom | 21 | 1 | 3005 | 343575 | 447 | 651366 | 0 |  | National Weather Service; National Ocean |
| KXHURCTOTMAJ | annual | 8 | 1 | 1250 | 53675 | 974 | 788 | 0 |  | National Oceanic and Atmospheric Adminis |
| KXHURRICANE | custom | 24 | 4 | 1181 | 16881 | 61072 | 3980 | 0 |  | National Oceanic and Atmospheric Adminis |
| KXHURPATHHAWAII | custom | 1 | 1 | 449 | 53228 | 86 | 58 | 0 |  | AccuWeather; NBC; Associated Press; Nati |
| KXHURCTOT | annual | 9 | 1 | 430 | 38461 | 2546 | 3001 | 0 |  | National Oceanic and Atmospheric Adminis |
| KXHURRICANENAMES | custom | 50 | 3 | 399 | 69773 | 114041 | 465442 | 8 | 2026-07-29..2026-09-10 | National Weather Service; National Ocean |
| KXNEXTHURDATE | custom | 4 | 1 | 155 | 7885 | 497 | 37 | 4 | 2026-08-15..2026-10-01 | National Oceanic and Atmospheric Adminis |
| KXTROPSTORM | annual | 8 | 1 | 106 | 16374 | 2073 | 643 | 0 |  | National Oceanic and Atmospheric Adminis |
| KXNEXTCAT5HURDATE | custom | 2 | 1 | 76 | 4786 | 8 | 26 | 2 | 2026-09-01..2026-10-01 | National Oceanic and Atmospheric Adminis |
| KXHURPATHNC | one_off | 1 | 1 | 0 | 1282 | 421 | 5 | 0 |  | AccuWeather; NBC; Associated Press; Nati |
| KXNAMEDSTORM | custom | 14 | 2 | 0 | 7339 | 234 | 354 | 0 |  | National Oceanic and Atmospheric Adminis |

### rain, daily

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXRAIN | daily | 60 | 2 | 880443 | 465498 | 1801138 | 144846 | 1529 | 2026-07-27..2026-10-03 | The Weather Company |
| KXRAINDALM | custom | 14 | 2 | 1688 | 3370 | 1919 | 1375 | 24 | 2026-08-01..2026-10-03 | The Weather Company |
| KXRAINDENM | monthly | 14 | 2 | 105 | 9625 | 8751 | 21784 | 24 | 2026-08-01..2026-10-01 | The Weather Company |

### rain, monthly/custom

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXRAINCLLM | custom | 13 | 2 | 5310 | 5312 | 3850 | 180 | 1 | 2026-10-03..2026-10-03 | The Weather Company |
| KXRAINLAXM | custom | 14 | 2 | 3902 | 13948 | 6689 | 27522 | 21 | 2026-08-01..2026-10-01 | The Weather Company |
| KXRAINSEAM | custom | 14 | 2 | 2956 | 4118 | 1679 | 2308 | 21 | 2026-08-01..2026-10-01 | The Weather Company |
| KXRAINMIAM | custom | 13 | 2 | 1299 | 2464 | 565 | 1656 | 34 | 2026-08-01..2026-10-03 | The Weather Company |
| KXRAINAUSM | custom | 13 | 2 | 1232 | 3724 | 1807 | 796 | 22 | 2026-08-01..2026-10-03 | The Weather Company |
| KXRAINCHIM | monthly | 13 | 2 | 906 | 2769 | 3494 | 938 | 28 | 2026-08-01..2026-10-03 | The Weather Company |
| KXRAINNYCM | monthly | 7 | 1 | 336 | 2847 | 258 | 229 | 33 | 2026-08-01..2026-10-01 | NWS Climatological Report NY |
| KXRAINHOUM | custom | 14 | 2 | 249 | 966 | 672 | 558 | 21 | 2026-08-01..2026-10-01 | The Weather Company |
| KXRAINPVDM | custom | 14 | 2 | 172 | 157 | 191 | 1039 | 0 |  | The Weather Company |
| KXRAINSFOM | custom | 14 | 2 | 67 | 506 | 1118 | 1144 | 21 | 2026-08-01..2026-10-01 | The Weather Company |
| KXRAINCMHM | custom | 14 | 2 | 3 | 31 | 3259 | 1202 | 0 |  | The Weather Company |
| KXRAINLEXM | custom | 14 | 2 | 0 | 87 | 314 | 141 | 0 |  | The Weather Company |
| KXRAINNAPAM | monthly | 24 | 4 | 0 | 22 | 6744 | 6774 | 0 |  | The Weather Company |
| KXRAINMKEM | custom | 13 | 2 | 0 | 30 | 1239 | 161 | 1 | 2026-10-03..2026-10-03 | The Weather Company |

### rain, weekend/weekly

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXRAINWKND | weekly | 23 | 1 | 36566 | 58988 | 1317844 | 23894 | 133 | 2026-08-24..2026-09-28 | The Weather Company |
| KXRAINNYCW | weekly | 4 | 1 | 1 | 834 | 491 | 199 | 0 |  | The Weather Company |

### ski-resort open/close dates

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXPARKCOPEN | annual | 5 | 1 | 97 | 791 | 1626 | 1213 | 0 |  | Park City Mountain Snow & Weather Report |
| KXBIGSKYOPEN | annual | 5 | 1 | 76 | 10281 | 22322 | 33319 | 0 |  | USA Today; Associated Press; The Wall St |
| KXSTOWEOPEN | annual | 5 | 1 | 22 | 1477 | 18 | 137 | 0 |  | Stowe Mountain Resort Snow & Weather Rep |
| KXBACHELOROPEN | annual | 5 | 1 | 0 | 340 | 1020 | 1105 | 0 |  | USA Today; Associated Press; Mt. Bachelo |
| KXASPENMTNOPEN | annual | 5 | 1 | 0 | 3723 | 28602 | 38392 | 0 |  | USA Today; Associated Press; Aspen Mount |
| KXKEYSTONEOPEN | annual | 5 | 1 | 0 | 420 | 515 | 508 | 0 |  | Keystone Resort Snow & Weather Report |
| KXJACKSONOPEN | annual | 5 | 1 | 0 | 108 | 5 | 172 | 0 |  | USA Today; Associated Press; Jackson Hol |
| KXKILLINGTONOPEN | annual | 5 | 1 | 0 | 736 | 610 | 1104 | 0 |  | USA Today; Killington Ski Resort; Associ |
| KXNORTHSTAROPEN | annual | 6 | 1 | 0 | 1958 | 1104 | 210 | 0 |  | Northstar California Resort Snow & Weath |
| KXBRECKOPEN | annual | 5 | 1 | 0 | 3179 | 140 | 1752 | 0 |  | Breckenridge Ski Resort Snow & Weather R |
| KXALTAOPEN | annual | 5 | 1 | 0 | 829 | 3010 | 6 | 0 |  | USA Today; Associated Press; Alta Ski Ar |
| KXBALDYOPEN | annual | 5 | 1 | 0 | 1439 | 1020 | 1103 | 0 |  | USA Today; Associated Press; Bald Mounta |
| KXCOPPEROPEN | annual | 5 | 1 | 0 | 3233 | 53 | 103 | 0 |  | Copper Mountain Resort; USA Today; Assoc |
| KXHEAVENLYOPEN | annual | 5 | 1 | 0 | 2140 | 109 | 122 | 0 |  | Heavenly Mountain Resort Snow & Weather  |
| KXALYOPEN | annual | 5 | 1 | 0 | 2257 | 1020 | 2979 | 0 |  | USA Today; Associated Press; Alyeska Res |
| KXBEAVEROPEN | annual | 5 | 1 | 0 | 1286 | 21 | 3404 | 0 |  | Beaver Creek Resort Snow & Weather Repor |
| KXSIERRAOPEN | annual | 5 | 1 | 0 | 3 | 1020 | 3100 | 0 |  | Sierra-at-Tahoe Resort; USA Today; Assoc |

### snow

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXBOSSNOWM | monthly | 6 | 1 | 3374 | 3319 | 552 | 499 | 0 |  | The Weather Company |
| KXTSNOWFALLBIGSKYM | monthly | 10 | 1 | 2760 | 49299 | 36518 | 70474 | 0 |  | OnTheSnow - Big Sky |
| KXNYCSNOWM | monthly | 6 | 1 | 1545 | 1545 | 1546 | 314 | 0 |  | The Weather Company |
| KXDCSNOWM | monthly | 6 | 1 | 1032 | 1045 | 4540 | 3180 | 0 |  | The Weather Company |
| KXDETSNOWM | monthly | 6 | 1 | 600 | 600 | 1722 | 829 | 0 |  | The Weather Company |
| KXPITSNOWM | monthly | 6 | 1 | 500 | 500 | 1608 | 390 | 0 |  | The Weather Company |
| KXMSPSNOWM | monthly | 6 | 1 | 402 | 402 | 2133 | 2048 | 0 |  | The Weather Company |
| KXDENSNOWM | monthly | 6 | 1 | 5 | 5 | 1502 | 808 | 0 |  | The Weather Company |
| KXSNOWCRABCATCH | annual | 6 | 1 | 2 | 3130 | 425 | 624 | 0 |  | Alaska Department of Fish and Game |
| KXPHILSNOWM | monthly | 6 | 1 | 0 | 0 | 3008 | 557 | 0 |  | The Weather Company |
| KXCHISNOWM | monthly | 6 | 1 | 0 | 0 | 31970 | 4145 | 0 |  | The Weather Company |
| KXMKESNOWM | monthly | 6 | 1 | 0 | 0 | 4000 | 364 | 0 |  | The Weather Company |
| KXSNOWBIRDOPEN | annual | 5 | 1 | 0 | 3674 | 17 | 305 | 0 |  | USA Today; Associated Press; The Wall St |
| KXSNOWBASINOPEN | annual | 5 | 1 | 0 | 45 | 10 | 172 | 0 |  | Snowbasin Resort; USA Today; Associated  |

### temperature, daily high/low

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXHIGHLAX | daily | 12 | 2 | 468888 | 322732 | 265692 | 1739912 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTSFO | daily | 12 | 2 | 143839 | 100208 | 32428 | 672295 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHMIA | daily | 12 | 2 | 133890 | 100423 | 70078 | 306418 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHNY | daily | 12 | 2 | 88793 | 69549 | 26481 | 451430 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTATL | daily | 12 | 2 | 84906 | 71491 | 11365 | 194562 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHCHI | daily | 12 | 2 | 73309 | 57614 | 9588 | 495947 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHAUS | daily | 12 | 2 | 59866 | 43892 | 53314 | 85845 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTHOU | daily | 12 | 2 | 49579 | 38824 | 40259 | 401758 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTMIN | daily | 12 | 2 | 42739 | 27791 | 6064 | 174608 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTSEA | daily | 12 | 2 | 33975 | 26126 | 14859 | 178048 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHPHIL | daily | 12 | 2 | 32224 | 25697 | 21266 | 223153 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTOKC | daily | 12 | 2 | 27584 | 21041 | 4419 | 35129 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHDEN | daily | 12 | 2 | 27493 | 22758 | 12039 | 82198 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTBOS | daily | 12 | 2 | 26920 | 19666 | 18539 | 157696 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTLV | daily | 12 | 2 | 22544 | 20856 | 7098 | 169087 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTDC | daily | 12 | 2 | 19730 | 19013 | 22843 | 98876 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTDAL | daily | 12 | 2 | 19058 | 15971 | 6021 | 76041 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTPHX | daily | 12 | 2 | 17544 | 17181 | 7093 | 230538 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTSATX | daily | 12 | 2 | 16276 | 15481 | 10649 | 39567 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTSAN | daily | 12 | 2 | 15991 | 12756 | 1471 | 24828 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTNOLA | daily | 12 | 2 | 14972 | 13869 | 3434 | 173196 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTLAX | daily | 12 | 2 | 12579 | 11773 | 525 | 97524 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTMIA | daily | 12 | 2 | 10992 | 9529 | 310 | 9593 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTNYC | daily | 12 | 2 | 9967 | 9972 | 381 | 15164 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTCHI | daily | 12 | 2 | 9103 | 9180 | 280 | 34921 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTDEN | daily | 12 | 2 | 8362 | 6820 | 267 | 11953 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTLV | daily | 12 | 2 | 6558 | 6575 | 929 | 48196 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTDAL | daily | 12 | 2 | 6519 | 6642 | 450 | 20616 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTPHX | daily | 12 | 2 | 6216 | 5600 | 718 | 36982 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTDC | daily | 12 | 2 | 5961 | 5703 | 825 | 60584 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTPHIL | daily | 12 | 2 | 4966 | 4128 | 21 | 18542 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTATL | daily | 12 | 2 | 3951 | 3976 | 1432 | 50677 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTNOLA | daily | 12 | 2 | 3521 | 2244 | 168 | 27120 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTSFO | daily | 12 | 2 | 3203 | 3499 | 1077 | 45393 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTMIN | daily | 12 | 2 | 3180 | 3409 | 365 | 1108 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTAUS | daily | 12 | 2 | 3018 | 3862 | 654 | 310 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTBOS | daily | 12 | 2 | 2920 | 2713 | 421 | 22047 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTTTN | daily | 12 | 2 | 2711 | 2824 | 47 | 20611 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTSAN | daily | 12 | 2 | 2465 | 2199 | 509 | 9898 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTHOU | daily | 12 | 2 | 2440 | 2437 | 448 | 44734 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTSDF | daily | 12 | 2 | 2080 | 1923 | 1679 | 5859 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTEWR | daily | 12 | 2 | 2075 | 1839 | 3176 | 41467 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTSEA | daily | 12 | 2 | 1701 | 1736 | 339 | 310 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTSDF | daily | 12 | 2 | 1613 | 1283 | 1012 | 4548 | (~400) | 2026-07-28.. | The Weather Company |
| KXHIGHTTTN | daily | 12 | 2 | 1535 | 1677 | 6011 | 36938 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTSATX | daily | 12 | 2 | 1406 | 1435 | 211 | 224 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTOKC | daily | 12 | 2 | 1311 | 1503 | 549 | 1596 | (~400) | 2026-07-28.. | The Weather Company |
| KXLOWTEWR | daily | 12 | 2 | 1176 | 1435 | 25 | 21426 | (~400) | 2026-07-28.. | The Weather Company |
| KXSJCLOWT | monthly | 1 | 1 | 40 | 1871 | 13 | 956 | 0 |  | The Weather Company |

### temperature, hourly directional

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXTEMPMIAH | hourly | 10 | 1 | 4349 | 3629 | 3317 | 1346 | 11770 | 2026-08-15..2026-10-04 | Synoptic Data |
| KXTEMPNYCHS | hourly | 10 | 1 | 3478 | 3462 | 651 | 400 | 5550 | 2026-09-10..2026-10-04 | Synoptic Data |
| KXTEMPCHIHS | hourly | 10 | 1 | 2672 | 1717 | 2751 | 2150 | 5590 | 2026-09-10..2026-10-04 | Kalshi |
| KXTEMPLAXHS | hourly | 10 | 1 | 2406 | 1599 | 1173 | 2073 | 5580 | 2026-09-10..2026-10-04 | Synoptic Data |

### temperature, weekly average (consecutive hot days)

| series | freq | markets | events | vol24h | oi | bid_top | ask_top | settled | span | source |
|---|---|---|---|---|---|---|---|---|---|---|
| KXAVGTKSAN | weekly | 5 | 1 | 5155 | 5303 | 0 | 10896 | 35 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKPHX | weekly | 5 | 1 | 1251 | 1867 | 0 | 7400 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKLAS | weekly | 5 | 1 | 935 | 1107 | 0 | 5175 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKIAH | weekly | 5 | 1 | 156 | 434 | 0 | 4498 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKSAT | weekly | 5 | 1 | 0 | 468 | 0 | 5688 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKDEN | weekly | 5 | 1 | 0 | 0 | 0 | 1501 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKDFW | weekly | 5 | 1 | 0 | 0 | 0 | 1991 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKMSY | weekly | 5 | 1 | 0 | 0 | 0 | 2249 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKOKC | weekly | 5 | 1 | 0 | 0 | 0 | 2317 | 30 | 2026-08-24..2026-09-28 | The Weather Company |
| KXAVGTKAUS | weekly | 5 | 1 | 0 | 0 | 0 | 2732 | 30 | 2026-08-24..2026-09-28 | The Weather Company |

### Series with no open market now but settled history

| series | family | freq | settled | span |
|---|---|---|---|---|
| KXTEMPDCH | temperature, hourly directional | hourly | 10823 | 2026-07-25..2026-09-10 |
| KXTEMPCHIH | temperature, hourly directional | hourly | 10808 | 2026-07-25..2026-09-10 |
| KXTEMPLAXH | temperature, hourly directional | hourly | 10796 | 2026-07-25..2026-09-10 |
| KXTEMPAUSH | temperature, hourly directional | hourly | 10772 | 2026-07-25..2026-09-10 |
| KXTEMPNYCH | temperature, hourly directional | hourly | 10719 | 2026-07-27..2026-09-10 |
| KXDROUGHTLEVEL | climate / other | one_off | 14 | 2026-07-31..2026-07-31 |
| KXEARTHQUAKEM | earthquake / volcano | one_off | 13 | 2026-08-10..2026-09-01 |
| KXRAINSNYC | rain, monthly/custom | custom | 10 | 2026-09-28..2026-09-28 |
| KXRAINSTPM | rain, monthly/custom | monthly | 10 | 2026-08-01..2026-08-01 |
| KXRAINSBOS | rain, monthly/custom | custom | 10 | 2026-09-28..2026-09-28 |
| KXAVGTATL | temperature, weekly average (consecutive hot days) | weekly | 5 | 2026-08-24..2026-08-24 |
| KXHOBBYTEMP | climate / other | one_off | 1 | 2026-09-01..2026-09-01 |
| KXRAINDNYC | rain, daily | daily | 1 | 2026-09-20..2026-09-20 |
| KXHEATAPHX | temperature, daily high/low | weekly | 1 | 2026-08-18..2026-08-18 |