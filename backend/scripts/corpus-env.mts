/**
 * ── THE SCORECARD DOES NOT SPEND THE MODEL'S QUOTA ──────────────────────────
 *
 * Imported before anything that reaches the pipeline, because
 * `services/llm/index.ts` picks its provider when the module is first
 * evaluated — after that the choice is made, and setting the variable in the
 * script body is too late.
 *
 * Two reasons the default is off, and the second is the one that matters.
 *
 * The free tier for `gemini-3.7-flash` is twenty requests a day. Scoring the
 * corpus costs one call per package, so a working session on the extractor —
 * run the scorecard, read the misses, change a pattern, run it again — spends
 * the whole day's allowance in ten minutes, and every inspection scanned
 * afterwards runs with the model skipped. That happened.
 *
 * And a score that includes a model is not a measurement of this stage. The
 * corpus exists to answer "did the extractor get better", against a fixed
 * recorded reading, with the same answer every time. A model gives a slightly
 * different answer on each call; averaged into the number, it turns the
 * ratchet in `tests/corpus.test.ts` into noise.
 *
 * `--llm` runs it with the model, for when the question really is what the
 * whole pipeline reads end to end.
 */
if (!process.argv.includes('--llm')) {
  process.env.LLM_PROVIDER = 'none';
}
