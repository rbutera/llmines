export function calculateSweepScore(
  deletedCells: number,
  distinctSquares: number,
) {
  if (deletedCells <= 0 || distinctSquares <= 0) return 0;
  return deletedCells * distinctSquares;
}
