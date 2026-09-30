-- Downloads and bytes of one asset by client type, from GCP HTTP(S) load-balancer request logs
-- exported to BigQuery. Replace PROJECT.DATASET.requests, then dry-run and cap bytes billed:
--   bq query --use_legacy_sql=false --dry_run \
--     --parameter=start:TIMESTAMP:'2026-01-01 00:00:00' --parameter=end:TIMESTAMP:'2026-01-08 00:00:00' \
--     --parameter=asset_regex::'/assets/vendor/lib\.module' --parameter=native_ua_regex::'MyApp Mobile' \
--     < asset-downloads-by-client.sql
-- native_ua_regex matches your native app's user agent; use a value that never matches if there is none.
WITH r AS (
  SELECT DATE(timestamp) AS day, httpRequest.requestUrl AS url, httpRequest.responseSize AS bytes, httpRequest.userAgent AS ua,
    CASE
      WHEN REGEXP_CONTAINS(IFNULL(httpRequest.userAgent,''), @native_ua_regex) THEN 'native_api'
      WHEN REGEXP_CONTAINS(IFNULL(httpRequest.userAgent,''), r'; wv\)') THEN 'android_webview'
      WHEN REGEXP_CONTAINS(IFNULL(httpRequest.userAgent,''), r'\((iPhone|iPad|iPod)') AND REGEXP_CONTAINS(httpRequest.userAgent, r'AppleWebKit')
           AND NOT REGEXP_CONTAINS(httpRequest.userAgent, r'Safari/') THEN 'ios_webview'
      WHEN REGEXP_CONTAINS(IFNULL(httpRequest.userAgent,''), r'(Android|iPhone|iPad|Mobile)') THEN 'mobile_browser'
      ELSE 'desktop' END AS ua_class
  FROM `PROJECT.DATASET.requests`
  WHERE timestamp >= @start AND timestamp < @end
    AND httpRequest.status < 400
    AND REGEXP_CONTAINS(httpRequest.requestUrl, @asset_regex)
)
SELECT ua_class, COUNT(*) AS reqs, SUM(bytes) AS bytes, ROUND(AVG(bytes)) AS avg_bytes, COUNT(DISTINCT day) AS days
FROM r GROUP BY ua_class ORDER BY reqs DESC
