// Runtime config for the COSC deployment (issue #175). Copied to the demo root
// verbatim (no content hash) and served no-cache, so the API base can be
// re-pointed in place on S3 without a rebuild. The app reads
// window.__COSC_API_BASE__ and appends the route path.
window.__COSC_API_BASE__ = "https://byw8gzkae2.execute-api.us-west-2.amazonaws.com/prod";
