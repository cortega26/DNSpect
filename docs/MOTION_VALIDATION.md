# Motion Validation Checklist

Use this checklist to validate motion accessibility and motion-budget behavior in DNSpect.

## 1. Reduced Motion Coverage

1. Enable OS/browser reduced-motion preference.
2. Open DNSpect and trigger:
   1. Guided apply modal open/close.
   2. Probe verification result rendering in the guided modal.
   3. Running benchmark progress bar shimmer.
3. Confirm:
   1. Modal transitions do not animate.
   2. Probe verification card does not animate in/out.
   3. Progress shimmer and current-sample pulse are disabled.

## 2. Live Ranking Motion Budget

1. Run with enough resolvers to exceed the row budget (default 30).
2. Observe the live ranking panel while rows are updating.
3. Confirm:
   1. Reorder transform animation is disabled.
   2. Delta movement animations are disabled.
   3. Active-row/leader highlighting is non-animated.

## 3. Normal Motion Regression Check

1. Disable reduced-motion preference.
2. Run with fewer rows than the motion budget.
3. Confirm:
   1. Live ranking reorder animation is active.
   2. Probe verification card animates once on render.
   3. Modal open animation is visible.
