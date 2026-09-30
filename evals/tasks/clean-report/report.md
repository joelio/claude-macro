# Acoustic leak detection pilot: results

**Measured March to May 2026** in five district metered areas (DMAs), each 25 km² (125 km² in total), against 43 leaks confirmed by excavation. Data: `data.csv` in this folder.

## The number

| | Leaks found | Detections | Per km² |
|---|---:|---:|---:|
| Existing noise-logger method | 3/43 — 7.0% | 40,000 | 320 |
| **New acoustic model** | **38/43 — 88.4%** | **1,320** | **10.6** |

The 95% Wilson interval on 38/43 is 75.5% to 94.9%. The new model finds nearly thirteen times as many leaks on about a thirtieth of the detections.

## Per area

Each p-value compares the leaks found with 1,000 draws of a null model that moves the leaks to random pipe positions; p is (count of null draws at or above the observed + 1) / 1,001, so the smallest possible p is 0.001.

| DMA | Leaks | Found | Recall | Detections | p |
|---|---:|---:|---:|---:|---:|
| A | 14 | 11 | 78.6% | 414 | 0.001 |
| B | 11 | 9 | 81.8% | 297 | 0.001 |
| C | 15 | 15 | 100% | 267 | 0.001 |
| D | 2 | 2 | 100% | 130 | 0.110 |
| E | 1 | 1 | 100% | 212 | 0.121 |

The two small areas (D and E) do not reach significance on their own, which is expected with one or two leaks.

## Cost of review

Every detection has to be checked by an engineer at about 30 seconds each, so reviewing all 1,320 detections takes about 11.0 hours. The existing method's 40,000 detections would take about 333 hours.

## What this does not show

- Five areas and 43 leaks is a small sample; recall on new ground could be lower.
- The leaks were found by excavation after a reported loss, so quiet leaks are under-represented.
- Precision is not measured: most detections have not been dug.
