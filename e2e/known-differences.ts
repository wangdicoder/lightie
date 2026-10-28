export const KNOWN_DIFFERENCES: Record<string, string> = {
  'pr_1632_1.json': 'lottie-web throws on keyframes with null easing handles and keeps showing a stale frame',
  'pr_1632_2.json': 'lottie-web throws on keyframes with null easing handles and keeps showing a stale frame',
  'pr_1930_rx.json': 'lottie-web throws when a layer has rx but no ry or or, and draws nothing',
  'pr_1930_all_axis.json': 'lottie-web throws when a layer has rx but no or, and draws nothing',
  'pr_1599.json': 'the anchor has one component; lottie-web builds a NaN matrix',
  'pr_2305.json': 'lottie-web jumps to the end of a curved motion path while the easing undershoots',
};
