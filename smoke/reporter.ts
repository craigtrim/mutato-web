import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'

// Binary pass/fail reporter. A test that fails an attempt and then passes on
// retry is classified as PASS — no "flaky" surface. Pre-retry failures are
// silent; only the final attempt of a test produces output.

export default class BinaryReporter implements Reporter {
  private results = new Map<string, { name: string; passed: boolean; error?: string }>()
  private start = 0

  onBegin() {
    this.start = Date.now()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const name = test.titlePath().slice(2).join(' › ')
    const isFinalAttempt = result.retry === test.retries

    if (result.status === 'passed') {
      this.results.set(test.id, { name, passed: true })
      process.stdout.write(`  ✓ ${name}\n`)
      return
    }
    if ((result.status === 'failed' || result.status === 'timedOut') && isFinalAttempt) {
      const error = (result.error?.message ?? 'unknown error').split('\n')[0]
      this.results.set(test.id, { name, passed: false, error })
      process.stdout.write(`  ✗ ${name}\n`)
    }
  }

  onEnd(_: FullResult) {
    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1)
    let passed = 0
    const failed: Array<{ name: string; error?: string }> = []
    for (const r of this.results.values()) {
      if (r.passed) passed++
      else failed.push({ name: r.name, error: r.error })
    }
    process.stdout.write('\n')
    if (failed.length === 0) {
      process.stdout.write(`  ${passed} passed (${elapsed}s)\n`)
    } else {
      process.stdout.write(`  ${failed.length} failed, ${passed} passed (${elapsed}s)\n`)
      for (const f of failed) {
        process.stdout.write(`    ✗ ${f.name}\n`)
        if (f.error) process.stdout.write(`        ${f.error}\n`)
      }
    }
  }
}
